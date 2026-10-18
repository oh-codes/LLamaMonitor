using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace LlamaMonitorHost
{
    class Program
    {
        private const int MaxPayloadBytes = 1024 * 1024; // 1MB limit

        static void Main(string[] args)
        {
            using (var stdin = Console.OpenStandardInput())
            using (var stdout = Console.OpenStandardOutput())
            {
                byte[] lengthBuffer = new byte[4];

                while (true)
                {
                    int bytesRead = ReadExact(stdin, lengthBuffer, 0, 4);
                    if (bytesRead < 4)
                        break; // EOF or disconnect

                    uint messageLength = BitConverter.ToUInt32(lengthBuffer, 0);
                    if (messageLength == 0 || messageLength > MaxPayloadBytes)
                        break;

                    byte[] messageBuffer = new byte[messageLength];
                    int messageBytesRead = ReadExact(stdin, messageBuffer, 0, (int)messageLength);
                    if (messageBytesRead < messageLength)
                        break;

                    string requestJson = Encoding.UTF8.GetString(messageBuffer);
                    string responseJson = HandleRequest(requestJson);

                    byte[] responseBytes = Encoding.UTF8.GetBytes(responseJson);
                    byte[] responseLengthBytes = BitConverter.GetBytes((uint)responseBytes.Length);

                    stdout.Write(responseLengthBytes, 0, 4);
                    stdout.Write(responseBytes, 0, responseBytes.Length);
                    stdout.Flush();
                }
            }
        }

        private static int ReadExact(Stream stream, byte[] buffer, int offset, int count)
        {
            int total = 0;
            while (total < count)
            {
                int read = stream.Read(buffer, offset + total, count - total);
                if (read <= 0)
                    break;
                total += read;
            }
            return total;
        }

        private static string HandleRequest(string json)
        {
            if (json.Contains("\"ping\""))
            {
                return "{\"status\":\"ok\",\"action\":\"ping\",\"message\":\"pong\",\"version\":\"1.2.0\"}";
            }

            if (json.Contains("\"get_gpu\""))
            {
                return QueryNvidiaSmi();
            }

            if (json.Contains("\"detect_unsloth\""))
            {
                return DetectUnsloth();
            }

            if (json.Contains("\"get_log\""))
            {
                string path = ExtractJsonField(json, "path");
                return GetLatestLog(path, 500);
            }

            return "{\"status\":\"error\",\"error\":\"Unknown action requested\"}";
        }

        private static string ExtractJsonField(string json, string key)
        {
            var match = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]*)\"");
            return match.Success ? match.Groups[1].Value.Replace("\\\\", "\\") : "";
        }

        private static string DetectUnsloth()
        {
            try
            {
                string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                string studioDir = Path.Combine(userProfile, ".unsloth", "studio");

                if (!Directory.Exists(studioDir))
                {
                    return "{\"status\":\"not_found\",\"action\":\"detect_unsloth\",\"error\":\"Unsloth studio directory not found at " + EscapeJson(studioDir) + "\"}";
                }

                // 1. Find newest log in logs\llama-server to determine the active port
                string logsDir = Path.Combine(studioDir, "logs", "llama-server");
                string latestLog = "";
                int port = 0;

                if (Directory.Exists(logsDir))
                {
                    var logFiles = Directory.GetFiles(logsDir, "llama-*.log");
                    DateTime newestTime = DateTime.MinValue;

                    foreach (var file in logFiles)
                    {
                        var writeTime = File.GetLastWriteTimeUtc(file);
                        if (writeTime > newestTime)
                        {
                            newestTime = writeTime;
                            latestLog = file;
                        }
                    }

                    if (!string.IsNullOrEmpty(latestLog))
                    {
                        var match = Regex.Match(Path.GetFileName(latestLog), @"port-(\d+)");
                        if (match.Success)
                        {
                            int.TryParse(match.Groups[1].Value, out port);
                        }
                    }
                }

                // 2. Find newest API key in auth\llama_api_key_*
                string authDir = Path.Combine(studioDir, "auth");
                string apiKey = "";

                if (Directory.Exists(authDir))
                {
                    var keyFiles = Directory.GetFiles(authDir, "llama_api_key_*");
                    DateTime newestKeyTime = DateTime.MinValue;
                    string latestKeyFile = "";

                    foreach (var kf in keyFiles)
                    {
                        var writeTime = File.GetLastWriteTimeUtc(kf);
                        if (writeTime > newestKeyTime)
                        {
                            newestKeyTime = writeTime;
                            latestKeyFile = kf;
                        }
                    }

                    if (!string.IsNullOrEmpty(latestKeyFile) && File.Exists(latestKeyFile))
                    {
                        apiKey = File.ReadAllText(latestKeyFile).Trim();
                    }
                }

                if (port == 0)
                {
                    return "{\"status\":\"ok\",\"action\":\"detect_unsloth\",\"detected\":false,\"message\":\"No active llama-server port found in Unsloth logs\"}";
                }

                return string.Format(
                    CultureInfo.InvariantCulture,
                    "{{\"status\":\"ok\",\"action\":\"detect_unsloth\",\"detected\":true,\"port\":{0},\"baseUrl\":\"http://127.0.0.1:{0}\",\"apiKey\":\"{1}\",\"latestLog\":\"{2}\"}}",
                    port, EscapeJson(apiKey), EscapeJson(latestLog)
                );
            }
            catch (Exception ex)
            {
                return "{\"status\":\"error\",\"action\":\"detect_unsloth\",\"error\":\"" + EscapeJson(ex.Message) + "\"}";
            }
        }

        private static string GetLatestLog(string targetPath, int maxLines)
        {
            try
            {
                string resolvedFile = "";

                targetPath = (targetPath ?? "").Trim().Trim('"', '\'');

                // If path is empty, default to Unsloth studio logs
                if (string.IsNullOrEmpty(targetPath))
                {
                    string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                    targetPath = Path.Combine(userProfile, ".unsloth", "studio", "logs", "llama-server");
                }
                else
                {
                    targetPath = targetPath.TrimEnd('\\', '/');
                }

                if (Directory.Exists(targetPath))
                {
                    var files = new List<string>();
                    files.AddRange(Directory.GetFiles(targetPath, "*.log"));
                    files.AddRange(Directory.GetFiles(targetPath, "*.jsonl"));
                    files.AddRange(Directory.GetFiles(targetPath, "*.txt"));
                    if (files.Count == 0)
                    {
                        files.AddRange(Directory.GetFiles(targetPath));
                    }

                    DateTime newestTime = DateTime.MinValue;
                    foreach (var f in files)
                    {
                        var wt = File.GetLastWriteTimeUtc(f);
                        if (wt > newestTime)
                        {
                            newestTime = wt;
                            resolvedFile = f;
                        }
                    }

                    if (string.IsNullOrEmpty(resolvedFile))
                    {
                        return "{\"status\":\"empty\",\"action\":\"get_log\",\"error\":\"No log files found in directory\",\"path\":\"" + EscapeJson(targetPath) + "\"}";
                    }
                }
                else if (File.Exists(targetPath))
                {
                    resolvedFile = targetPath;
                }
                else
                {
                    return "{\"status\":\"error\",\"action\":\"get_log\",\"error\":\"Specified log path or directory does not exist: " + EscapeJson(targetPath) + "\"}";
                }

                // Read last N lines safely (with FileShare.ReadWrite | Delete so active writers are never blocked)
                var linesQueue = new Queue<string>();
                using (var fs = new FileStream(resolvedFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var reader = new StreamReader(fs, Encoding.UTF8))
                {
                    string line;
                    while ((line = reader.ReadLine()) != null)
                    {
                        if (string.IsNullOrWhiteSpace(line)) continue;
                        linesQueue.Enqueue(line);
                        if (linesQueue.Count > maxLines)
                        {
                            linesQueue.Dequeue();
                        }
                    }
                }

                var jsonLines = new List<string>();
                foreach (var l in linesQueue)
                {
                    jsonLines.Add("\"" + EscapeJson(l) + "\"");
                }

                return string.Format(
                    CultureInfo.InvariantCulture,
                    "{{\"status\":\"ok\",\"action\":\"get_log\",\"file\":\"{0}\",\"lines\":[{1}]}}",
                    EscapeJson(resolvedFile), string.Join(",", jsonLines.ToArray())
                );
            }
            catch (Exception ex)
            {
                return "{\"status\":\"error\",\"action\":\"get_log\",\"error\":\"" + EscapeJson(ex.Message) + "\"}";
            }
        }

        private static string QueryNvidiaSmi()
        {
            try
            {
                string smiExe = "nvidia-smi";
                string sys32 = Path.Combine(Environment.SystemDirectory, "nvidia-smi.exe");
                string progFiles = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe");
                if (File.Exists(sys32)) smiExe = sys32;
                else if (File.Exists(progFiles)) smiExe = progFiles;

                var psi = new ProcessStartInfo
                {
                    FileName = smiExe,
                    Arguments = "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };

                using (var proc = Process.Start(psi))
                {
                    if (proc == null)
                        return "{\"status\":\"error\",\"error\":\"Failed to start nvidia-smi process\"}";

                    string output = proc.StandardOutput.ReadToEnd();
                    string error = proc.StandardError.ReadToEnd();
                    proc.WaitForExit(3000);

                    if (!string.IsNullOrEmpty(error) && string.IsNullOrEmpty(output))
                    {
                        return "{\"status\":\"error\",\"error\":\"" + EscapeJson(error.Trim()) + "\"}";
                    }

                    return ParseSmiOutput(output);
                }
            }
            catch (Exception ex)
            {
                return "{\"status\":\"error\",\"error\":\"" + EscapeJson(ex.Message) + "\"}";
            }
        }

        private static string ParseSmiOutput(string output)
        {
            var lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            if (lines.Length == 0)
                return "{\"status\":\"empty\",\"error\":\"No GPU telemetry reported by nvidia-smi\"}";

            var gpuJsonList = new List<string>();

            foreach (var line in lines)
            {
                var parts = line.Split(',');
                if (parts.Length >= 7)
                {
                    string index = parts[0].Trim();
                    string name = parts[1].Trim();
                    string util = parts[2].Trim();
                    string vramUsed = parts[3].Trim();
                    string vramTotal = parts[4].Trim();
                    string temp = parts[5].Trim();
                    string power = parts[6].Trim();

                    string gpuEntry = string.Format(
                        CultureInfo.InvariantCulture,
                        "{{\"index\":{0},\"name\":\"{1}\",\"gpu_util_pct\":{2},\"vram_used_mb\":{3},\"vram_total_mb\":{4},\"temperature_c\":{5},\"power_w\":{6}}}",
                        index, EscapeJson(name), util, vramUsed, vramTotal, temp, power
                    );
                    gpuJsonList.Add(gpuEntry);
                }
            }

            if (gpuJsonList.Count == 0)
                return "{\"status\":\"parse_error\",\"error\":\"Could not parse GPU output format\"}";

            string primaryGpu = gpuJsonList[0];
            string allGpusArray = "[" + string.Join(",", gpuJsonList.ToArray()) + "]";

            return string.Format(
                CultureInfo.InvariantCulture,
                "{{\"status\":\"ok\",\"gpu\":{0},\"all_gpus\":{1},\"count\":{2}}}",
                primaryGpu, allGpusArray, gpuJsonList.Count
            );
        }

        private static string EscapeJson(string str)
        {
            if (string.IsNullOrEmpty(str)) return "";
            var sb = new StringBuilder(str.Length + 16);
            foreach (char c in str)
            {
                switch (c)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\r': break;
                    case '\n': sb.Append("\\n"); break;
                    // Raw tabs and control chars make the frame invalid JSON, so Chrome drops it.
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }
    }
}
