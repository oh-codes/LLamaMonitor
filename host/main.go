// Universal llama.cpp Monitor native messaging host.
// Speaks Chrome's stdio protocol: 4-byte little-endian length, then UTF-8 JSON.
// Actions: ping, get_gpu, detect_unsloth, get_log.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	maxPayloadBytes = 1024 * 1024
	maxLogLines     = 500
	smiTimeout      = 3 * time.Second
	version         = "2.0.0"
)

var portPattern = regexp.MustCompile(`port-(\d+)`)

type request struct {
	Action string `json:"action"`
	Path   string `json:"path"`
}

type gpu struct {
	Index       int     `json:"index"`
	Name        string  `json:"name"`
	UtilPct     float64 `json:"gpu_util_pct"`
	VramUsedMB  int64   `json:"vram_used_mb"`
	VramTotalMB int64   `json:"vram_total_mb"`
	TempC       float64 `json:"temperature_c"`
	PowerW      float64 `json:"power_w"`
}

func main() {
	in := bufio.NewReaderSize(os.Stdin, maxPayloadBytes)
	out := bufio.NewWriter(os.Stdout)
	lenBuf := make([]byte, 4)

	for {
		if _, err := io.ReadFull(in, lenBuf); err != nil {
			return
		}
		size := binary.LittleEndian.Uint32(lenBuf)
		if size == 0 || size > maxPayloadBytes {
			return
		}
		body := make([]byte, size)
		if _, err := io.ReadFull(in, body); err != nil {
			return
		}

		payload, err := json.Marshal(handle(body))
		if err != nil {
			payload = []byte(`{"status":"error","error":"failed to encode response"}`)
		}
		binary.LittleEndian.PutUint32(lenBuf, uint32(len(payload)))
		out.Write(lenBuf)
		out.Write(payload)
		out.Flush()
	}
}

func handle(body []byte) any {
	var req request
	if err := json.Unmarshal(body, &req); err != nil {
		return errorReply("Invalid request JSON")
	}

	switch req.Action {
	case "ping":
		return map[string]any{"status": "ok", "action": "ping", "message": "pong", "version": version}
	case "get_gpu":
		return queryNvidiaSmi()
	case "detect_unsloth":
		return detectUnsloth()
	case "get_log", "read_log":
		return getLog(req.Path)
	default:
		return map[string]any{"status": "error", "error": "Unknown action requested"}
	}
}

func errorReply(msg string) map[string]any {
	return map[string]any{"status": "error", "error": msg}
}

func homeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

func studioDir() string {
	home := homeDir()
	if home == "" {
		return ""
	}
	return filepath.Join(home, ".unsloth", "studio")
}

// detectUnsloth finds the live llama-server port in the newest Unsloth log name
// and reads the newest rotated API key next to it.
func detectUnsloth() any {
	studio := studioDir()
	if studio == "" {
		return map[string]any{"status": "not_found", "action": "detect_unsloth", "error": "User home directory not found"}
	}
	if info, err := os.Stat(studio); err != nil || !info.IsDir() {
		return map[string]any{"status": "not_found", "action": "detect_unsloth", "error": "Unsloth studio directory not found at " + studio}
	}

	port := 0
	latestLog := newestByModTime(glob(filepath.Join(studio, "logs", "llama-server"), "llama-*.log"))
	if latestLog != "" {
		if match := portPattern.FindStringSubmatch(filepath.Base(latestLog)); match != nil {
			port, _ = strconv.Atoi(match[1])
		}
	}

	apiKey := ""
	if keyFile := newestByModTime(glob(filepath.Join(studio, "auth"), "llama_api_key_*")); keyFile != "" {
		if data, err := os.ReadFile(keyFile); err == nil {
			apiKey = strings.TrimSpace(string(data))
		}
	}

	if port == 0 {
		return map[string]any{"status": "ok", "action": "detect_unsloth", "detected": false, "message": "No active llama-server port found in Unsloth logs"}
	}

	return map[string]any{
		"status":    "ok",
		"action":    "detect_unsloth",
		"detected":  true,
		"port":      port,
		"baseUrl":   fmt.Sprintf("http://127.0.0.1:%d", port),
		"apiKey":    apiKey,
		"latestLog": latestLog,
	}
}

// getLog returns the last maxLogLines non-blank lines of the newest matching log.
// The target may be a file, a directory, or empty for the Unsloth log directory.
func getLog(target string) any {
	target = strings.TrimSpace(target)
	target = strings.Trim(target, `"'`)

	if target == "" {
		studio := studioDir()
		if studio == "" {
			return errorReply("User home directory not found")
		}
		target = filepath.Join(studio, "logs", "llama-server")
	} else {
		target = strings.TrimRight(target, `\/`)
	}

	file := ""
	info, err := os.Stat(target)
	if err != nil {
		return map[string]any{"status": "error", "action": "get_log", "error": "Specified log path or directory does not exist: " + target}
	}

	if info.IsDir() {
		var files []string
		for _, pattern := range []string{"*.log", "*.jsonl", "*.txt"} {
			files = append(files, glob(target, pattern)...)
		}
		if len(files) == 0 {
			entries, _ := os.ReadDir(target)
			for _, entry := range entries {
				if !entry.IsDir() {
					files = append(files, filepath.Join(target, entry.Name()))
				}
			}
		}
		file = newestByModTime(files)
		if file == "" {
			return map[string]any{"status": "empty", "action": "get_log", "error": "No log files found in directory", "path": target}
		}
	} else {
		file = target
	}

	lines, err := tailLines(file, maxLogLines)
	if err != nil {
		return map[string]any{"status": "error", "action": "get_log", "error": err.Error()}
	}

	return map[string]any{"status": "ok", "action": "get_log", "file": file, "lines": lines}
}

// tailLines keeps only the last max non-blank lines so a growing log stays cheap.
func tailLines(path string, max int) ([]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)

	lines := make([]string, 0, max)
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		if len(lines) == max {
			lines = lines[1:]
		}
		lines = append(lines, line)
	}
	if err := scanner.Err(); err != nil && len(lines) == 0 {
		return nil, err
	}
	return lines, nil
}

func glob(dir, pattern string) []string {
	matches, err := filepath.Glob(filepath.Join(dir, pattern))
	if err != nil {
		return nil
	}
	return matches
}

func newestByModTime(files []string) string {
	newest := ""
	var newestTime time.Time
	for _, file := range files {
		info, err := os.Stat(file)
		if err != nil || info.IsDir() {
			continue
		}
		if newest == "" || info.ModTime().After(newestTime) {
			newest = file
			newestTime = info.ModTime()
		}
	}
	return newest
}

func smiPath() string {
	if runtime.GOOS == "windows" {
		candidates := []string{
			filepath.Join(os.Getenv("SystemRoot"), "System32", "nvidia-smi.exe"),
			filepath.Join(os.Getenv("ProgramFiles"), "NVIDIA Corporation", "NVSMI", "nvidia-smi.exe"),
		}
		for _, candidate := range candidates {
			if _, err := os.Stat(candidate); err == nil {
				return candidate
			}
		}
	}
	return "nvidia-smi"
}

func queryNvidiaSmi() any {
	ctx, cancel := context.WithTimeout(context.Background(), smiTimeout)
	defer cancel()

	args := []string{"--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
		"--format=csv,noheader,nounits"}
	cmd := exec.CommandContext(ctx, smiPath(), args...)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil && len(output) == 0 {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return errorReply(message)
	}
	return parseSmiOutput(string(output))
}

func parseSmiOutput(output string) any {
	gpus := make([]gpu, 0, 8)
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(strings.TrimRight(line, "\r"))
		if line == "" {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) < 7 {
			continue
		}
		gpus = append(gpus, gpu{
			Index:       int(number(parts[0])),
			Name:        strings.TrimSpace(parts[1]),
			UtilPct:     number(parts[2]),
			VramUsedMB:  int64(number(parts[3])),
			VramTotalMB: int64(number(parts[4])),
			TempC:       number(parts[5]),
			PowerW:      number(parts[6]),
		})
	}

	if len(gpus) == 0 {
		return map[string]any{"status": "parse_error", "error": "Could not parse GPU output format"}
	}
	return map[string]any{"status": "ok", "gpu": gpus[0], "all_gpus": gpus, "count": len(gpus)}
}

// number tolerates nvidia-smi placeholders such as [N/A] and returns 0 for them.
func number(raw string) float64 {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return 0
	}
	return value
}
