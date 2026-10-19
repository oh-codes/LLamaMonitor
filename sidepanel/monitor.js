// monitor.js - Local LLM Monitor Core Engine for Chrome Side Panel
"use strict";

const $ = (id) => document.getElementById(id);

// -----------------------------------------------------------------------------
// Default Configuration & Storage
// -----------------------------------------------------------------------------
const DEFAULT_PROFILES = {
  activeProfileId: "unsloth",
  profiles: {
    unsloth: {
      id: "unsloth",
      name: "Unsloth (Auto-Detect)",
      baseUrl: "http://127.0.0.1:8888",
      logFile: "", // Empty = Auto-detect newest log from %USERPROFILE%\.unsloth\studio\logs\llama-server
      apiKey: "",  // Auto-populated via detect_unsloth
      pollIntervalMs: 1000
    },
    llama_default: {
      id: "llama_default",
      name: "llama.cpp (Port 8080)",
      baseUrl: "http://127.0.0.1:8080",
      logFile: "",
      apiKey: "",
      pollIntervalMs: 1000
    },
    llama_alt: {
      id: "llama_alt",
      name: "llama.cpp Custom (Port 9050)",
      baseUrl: "http://127.0.0.1:9050",
      logFile: "",
      apiKey: "",
      pollIntervalMs: 1000
    },
    custom: {
      id: "custom",
      name: "Custom Engine (Port 5001)",
      baseUrl: "http://127.0.0.1:5001",
      logFile: "",
      apiKey: "",
      pollIntervalMs: 1000
    }
  }
};

let currentConfig = null;
let activeProfile = null;
let nativePort = null;
let prevCpuTimes = null;
let detectedUnsloth = null;
let lastGpusData = [];

// Persistent request audit cache across polls (so logs never disappear when idle)
const auditTasksMap = new Map();

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------
async function init() {
  await loadConfig();
  setupTabNavigation();
  setupProfileUI();
  connectNativeHost();
  startPollingLoops();
}

async function loadConfig() {
  const data = await chrome.storage.local.get(["activeProfileId", "profiles"]);
  if (!data.profiles || Object.keys(data.profiles).length === 0) {
    currentConfig = DEFAULT_PROFILES;
    await chrome.storage.local.set(DEFAULT_PROFILES);
  } else {
    currentConfig = {
      activeProfileId: data.activeProfileId || "unsloth",
      profiles: data.profiles
    };
  }
  activeProfile = currentConfig.profiles[currentConfig.activeProfileId] || Object.values(currentConfig.profiles)[0];
  renderProfileDropdown();
}

function renderProfileDropdown() {
  const sel = $("profile-select");
  if (!sel) return;
  sel.innerHTML = "";
  for (const [id, prof] of Object.entries(currentConfig.profiles)) {
    const opt = document.createElement("option");
    opt.value = id;
    let label = prof.name;
    if (id === "unsloth" && prof.runtimePort) {
      label = `Unsloth (Port ${prof.runtimePort})`;
    }
    opt.textContent = label;
    if (id === currentConfig.activeProfileId) opt.selected = true;
    sel.appendChild(opt);
  }
}

// -----------------------------------------------------------------------------
// Native Messaging Host (NVIDIA SMI & System Bridge)
// -----------------------------------------------------------------------------
let connectingHost = false;

function connectNativeHost() {
  if (connectingHost || nativePort) return;
  connectingHost = true;
  try {
    console.log(`[MONITOR] Connecting Native Messaging host 'com.llama.smi_host' (Ext ID: ${chrome.runtime?.id})...`);
    nativePort = chrome.runtime.connectNative("com.llama.smi_host");
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message || "Disconnected";
      console.warn("[MONITOR] Native host disconnected:", err);
      $("footer-status").textContent = `Native Host: Disconnected (${err})`;
      const gpuContainer = $("gpu-cards-container");
      if (gpuContainer && lastGpusData.length === 0) {
        $("gpu-name").textContent = `Native Host: ${err}`;
      }
      nativePort = null;
      connectingHost = false;
    });
    $("footer-status").textContent = "Native Host: Connected";
    connectingHost = false;

    // Send initial probes
    nativePort.postMessage({ action: "get_gpu" });
    checkUnslothDetection();
  } catch (err) {
    console.error("[MONITOR] connectNative exception:", err);
    $("footer-status").textContent = "Native Host: Exception (" + err.message + ")";
    nativePort = null;
    connectingHost = false;
  }
}

function handleNativeMessage(msg) {
  if (!msg) return;

  // 1. Unsloth detection
  if (msg.action === "detect_unsloth" || msg.detected !== undefined) {
    handleUnslothDetection(msg);
    return;
  }

  // 2. Log polling
  if (msg.action === "get_log" || msg.lines !== undefined) {
    handleLogResponse(msg);
    return;
  }

  // 3. GPU Telemetry
  if (msg.status === "ok" && (msg.gpu || msg.all_gpus)) {
    lastGpusData = msg.all_gpus || [msg.gpu];
    renderAllGpus(lastGpusData);
    return;
  }

  // 4. Error response
  if (msg.error && !msg.action) {
    console.warn("[MONITOR] Native host error payload:", msg.error);
    const container = $("gpu-cards-container");
    if (container) {
      container.innerHTML = `
        <div class="card hardware-card">
          <div class="card-header">
            <h3>NVIDIA GPU Telemetry</h3>
            <span class="card-tag">Error</span>
          </div>
          <div class="empty-state" style="color:var(--danger)">${escapeHtml(msg.error)}</div>
        </div>
      `;
    }
    $("footer-status").textContent = `Native Host: ${msg.error}`;
  }
}

// -----------------------------------------------------------------------------
// Unsloth Auto-Discovery
// -----------------------------------------------------------------------------
function checkUnslothDetection() {
  if (!nativePort) return;
  try {
    nativePort.postMessage({ action: "detect_unsloth" });
  } catch (err) {
    console.warn("[MONITOR] detect_unsloth postMessage failed:", err);
  }
}

function handleUnslothDetection(msg) {
  if (msg.status === "ok" && msg.detected) {
    detectedUnsloth = msg;
    const isUnslothActive = activeProfile && (activeProfile.id === "unsloth" || activeProfile.baseUrl.includes(":8888"));

    if (isUnslothActive) {
      activeProfile.runtimeBaseUrl = msg.baseUrl;
      activeProfile.runtimeApiKey = msg.apiKey;
      activeProfile.runtimeLogFile = msg.latestLog;
      activeProfile.runtimePort = msg.port;
      renderProfileDropdown();
    }

    const statusEl = $("detect-unsloth-status");
    if (statusEl) {
      statusEl.textContent = `Detected port ${msg.port}`;
      statusEl.style.color = "var(--success)";
    }
  } else if (msg.message || msg.error) {
    const statusEl = $("detect-unsloth-status");
    if (statusEl) {
      statusEl.textContent = msg.message || msg.error;
      statusEl.style.color = "var(--text-muted)";
    }
  }
}

// -----------------------------------------------------------------------------
// Hardware Telemetry Rendering (NVIDIA SMI)
// -----------------------------------------------------------------------------
function renderAllGpus(gpus) {
  const container = $("gpu-cards-container");
  if (!container || !Array.isArray(gpus) || gpus.length === 0) return;

  // 1. Compute Totals across all GPUs
  let totalUsedMb = 0;
  let totalMaxMb = 0;
  let splitParts = [];

  for (const g of gpus) {
    totalUsedMb += g.vram_used_mb || 0;
    totalMaxMb += g.vram_total_mb || 0;
    const gbUsed = ((g.vram_used_mb || 0) / 1024).toFixed(1);
    splitParts.push(`GPU ${g.index}: ${gbUsed}G`);
  }

  // Update Top KPI Cards
  const totalGbUsed = (totalUsedMb / 1024).toFixed(1);
  const totalGbMax = (totalMaxMb / 1024).toFixed(1);
  $("vram-val").textContent = totalGbUsed;
  $("vram-sub").textContent = gpus.length > 1
    ? `${splitParts.join(" · ")} (of ${totalGbMax}G)`
    : `GPU: ${gpus[0].temperature_c?.toFixed(0)}°C · ${gpus[0].power_w?.toFixed(0)}W`;

  // 2. Clear & Render Container
  container.innerHTML = "";

  // If Multi-GPU, render a Combined Pool Summary Card first
  if (gpus.length > 1) {
    const poolCard = document.createElement("div");
    poolCard.className = "card hardware-card gpu-pool-card";

    const poolPct = totalMaxMb > 0 ? (totalUsedMb / totalMaxMb) * 100 : 0;
    poolCard.innerHTML = `
      <div class="card-header">
        <h3>Combined VRAM Pool (${gpus.length} GPUs)</h3>
        <span class="card-tag">${totalGbUsed} / ${totalGbMax} GB (${poolPct.toFixed(1)}%)</span>
      </div>
      <div class="meter-group">
        <div class="meter-row">
          <div class="meter-info">
            <span>Combined Allocation</span>
            <b>${totalUsedMb.toFixed(0)} / ${totalMaxMb.toFixed(0)} MB</b>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, poolPct)}%"></div></div>
        </div>
      </div>
    `;
    container.appendChild(poolCard);
  }

  // 3. Render Dedicated Card for Each Detected GPU
  for (const g of gpus) {
    const card = document.createElement("div");
    card.className = "card hardware-card";

    const vramPct = g.vram_total_mb > 0 ? (g.vram_used_mb / g.vram_total_mb) * 100 : 0;
    const tempPct = Math.min(100, (g.temperature_c / 100) * 100);

    card.innerHTML = `
      <div class="card-header">
        <h3>GPU ${g.index}: ${escapeHtml(g.name || "NVIDIA GPU")}</h3>
        <span class="card-tag">${(g.vram_total_mb / 1024).toFixed(0)} GB</span>
      </div>
      <div class="meter-group">
        <div class="meter-row">
          <div class="meter-info">
            <span>GPU Load</span>
            <b>${g.gpu_util_pct.toFixed(0)}%</b>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, g.gpu_util_pct)}%"></div></div>
        </div>
        <div class="meter-row">
          <div class="meter-info">
            <span>VRAM Allocation</span>
            <b>${g.vram_used_mb.toFixed(0)} / ${g.vram_total_mb.toFixed(0)} MB</b>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, vramPct)}%"></div></div>
        </div>
        <div class="meter-row">
          <div class="meter-info">
            <span>Temperature & Power</span>
            <b>${g.temperature_c.toFixed(0)}°C · ${g.power_w.toFixed(1)} W</b>
          </div>
          <div class="progress-bar warn"><div class="progress-fill" style="width:${tempPct}%"></div></div>
        </div>
      </div>
    `;
    container.appendChild(card);
  }

  $("footer-status").textContent = `Native Host: Active (${gpus.length} GPUs Online)`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pollGpuHardware() {
  if (!nativePort) {
    connectNativeHost();
  }
  if (nativePort) {
    try {
      nativePort.postMessage({ action: "get_gpu" });
    } catch (err) {
      console.warn("[MONITOR] postMessage error, resetting port:", err);
      nativePort = null;
    }
  }
}

// -----------------------------------------------------------------------------
// Chrome System Telemetry (CPU & RAM)
// -----------------------------------------------------------------------------
async function pollHostSystem() {
  // 1. CPU
  if (chrome.system && chrome.system.cpu) {
    chrome.system.cpu.getInfo((info) => {
      if (!info || !info.processors) return;
      let totalUsage = 0;
      let processors = info.processors;
      if (prevCpuTimes && prevCpuTimes.length === processors.length) {
        let sumPct = 0;
        for (let i = 0; i < processors.length; i++) {
          const prev = prevCpuTimes[i];
          const curr = processors[i].usage;
          const userDiff = curr.user - prev.user;
          const kernelDiff = curr.kernel - prev.kernel;
          const idleDiff = curr.idle - prev.idle;
          const totalDiff = userDiff + kernelDiff + idleDiff;
          if (totalDiff > 0) {
            sumPct += ((userDiff + kernelDiff) / totalDiff) * 100;
          }
        }
        totalUsage = sumPct / processors.length;
        $("hw-cpu-util").textContent = `${totalUsage.toFixed(0)}%`;
        $("bar-cpu").style.width = `${Math.min(100, totalUsage)}%`;
      }
      prevCpuTimes = processors.map((p) => ({ ...p.usage }));
    });
  }

  // 2. RAM
  if (chrome.system && chrome.system.memory) {
    chrome.system.memory.getInfo((mem) => {
      if (!mem) return;
      const totalGb = mem.capacity / 1073741824;
      const usedGb = (mem.capacity - mem.availableCapacity) / 1073741824;
      const pct = (usedGb / totalGb) * 100;
      $("hw-ram-text").textContent = `${usedGb.toFixed(1)} / ${totalGb.toFixed(1)} GB`;
      $("bar-ram").style.width = `${Math.min(100, pct)}%`;
    });
  }
}

// -----------------------------------------------------------------------------
// Server Polling (/slots & /metrics)
// -----------------------------------------------------------------------------
async function pollServer() {
  if (!activeProfile) return;

  const isUnsloth = activeProfile.id === "unsloth" || activeProfile.baseUrl.includes(":8888");

  // Determine effective URL and Key
  let baseUrl = activeProfile.runtimeBaseUrl || activeProfile.baseUrl || "http://127.0.0.1:8080";
  baseUrl = baseUrl.replace(/\/+$/, "");

  let apiKey = activeProfile.runtimeApiKey || activeProfile.apiKey || "";

  // If Unsloth is selected but we don't have dynamic port yet, trigger detection
  if (isUnsloth && (!activeProfile.runtimeBaseUrl || baseUrl.includes(":8888"))) {
    checkUnslothDetection();
    if (detectedUnsloth && detectedUnsloth.baseUrl) {
      baseUrl = detectedUnsloth.baseUrl;
      apiKey = detectedUnsloth.apiKey;
      activeProfile.runtimeBaseUrl = baseUrl;
      activeProfile.runtimeApiKey = apiKey;
      activeProfile.runtimePort = detectedUnsloth.port;
    }
  }

  const headers = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const slotsResp = await fetch(`${baseUrl}/slots`, { cache: "no-store", headers });
    if (!slotsResp.ok) throw new Error(`HTTP ${slotsResp.status}`);

    const slots = await slotsResp.json();
    const portLabel = baseUrl.split(":").pop();
    setConnectionState("online", `Online (Port ${portLabel})`);
    renderSlots(slots);
  } catch (err) {
    // If unreachable and it's Unsloth, trigger re-detection immediately
    if (isUnsloth) {
      checkUnslothDetection();
    }
    setConnectionState("offline", "Unreachable");
    renderEmptySlots();
  }

  // Query Prometheus metrics if available
  try {
    const metResp = await fetch(`${baseUrl}/metrics`, { cache: "no-store", headers });
    if (metResp.ok) {
      const text = await metResp.text();
      parsePrometheusMetrics(text);
    }
  } catch (_) {
    // Metrics endpoint optional
  }

  // Query log file or folder
  pollLogFile();
}

function setConnectionState(state, text) {
  const pill = $("status-pill");
  pill.className = `pill pill-${state}`;
  $("status-text").textContent = text;
}

// Accurate context fill tracking supporting Unsloth, llama.cpp, and speculative engines
function renderSlots(slots) {
  if (!Array.isArray(slots) || slots.length === 0) {
    renderEmptySlots();
    return;
  }

  const container = $("slots-container");
  container.innerHTML = "";

  let busyCount = 0;
  let ctxUsed = 0;
  let ctxTotal = 0;

  for (const s of slots) {
    const isBusy = s.state === "processing" || s.is_processing === true;
    if (isBusy) busyCount++;

    const nCtx = s.n_ctx || 0;
    if (!ctxTotal) ctxTotal = nCtx;
    const promptTokens = s.n_prompt_tokens || 0;
    const decodedTokens = (Array.isArray(s.next_token) && s.next_token[0]?.n_decoded) || 0;

    // Calculate actual active context tokens
    const tokensUsed = promptTokens > 0 ? promptTokens + decodedTokens : 0;
    if (tokensUsed > ctxUsed) ctxUsed = tokensUsed;

    const div = document.createElement("div");
    div.className = "slot-item";

    const header = document.createElement("div");
    header.className = "slot-header";

    const title = document.createElement("b");
    const taskTag = s.id_task ? ` · Task #${s.id_task}` : "";
    title.textContent = `Slot #${s.id} (${isBusy ? "busy" : "idle"}${taskTag})`;

    const slotPct = nCtx > 0 ? ((tokensUsed / nCtx) * 100).toFixed(1) : "0.0";
    const stat = document.createElement("span");
    stat.textContent = `${tokensUsed.toLocaleString()} / ${nCtx.toLocaleString()} tokens (${slotPct}%)`;

    header.appendChild(title);
    header.appendChild(stat);
    div.appendChild(header);

    // Progress bar for the slot
    const barWrap = document.createElement("div");
    barWrap.className = "progress-bar";
    const barFill = document.createElement("div");
    barFill.className = "progress-fill";
    barFill.style.width = `${Math.min(100, parseFloat(slotPct))}%`;
    barWrap.appendChild(barFill);
    div.appendChild(barWrap);

    if (s.prompt) {
      const p = document.createElement("div");
      p.className = "slot-prompt";
      p.textContent = s.prompt.slice(0, 120);
      div.appendChild(p);
    }

    container.appendChild(div);
  }

  $("slots-val").textContent = busyCount;
  $("slots-total").textContent = `/ ${slots.length}`;
  $("slots-sub").textContent = `Idle: ${slots.length - busyCount}`;

  if (ctxTotal > 0) {
    const fillPct = (ctxUsed / ctxTotal) * 100;
    $("ctx-pct").textContent = `${fillPct.toFixed(1)}%`;
    $("ctx-sub").textContent = `${ctxUsed.toLocaleString()} / ${ctxTotal.toLocaleString()} tokens`;
  }
}

function renderEmptySlots() {
  $("slots-val").textContent = "0";
  $("slots-total").textContent = "/ 0";
  $("slots-sub").textContent = "Server idle or offline";
}

function parsePrometheusMetrics(text) {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("llamacpp:predicted_tokens_seconds")) {
      const val = parseFloat(line.split(/\s+/)[1]);
      if (!isNaN(val)) $("speed-val").textContent = val.toFixed(1);
    }
    if (line.startsWith("llamacpp:prompt_tokens_seconds")) {
      const val = parseFloat(line.split(/\s+/)[1]);
      if (!isNaN(val)) $("speed-sub").textContent = `Prefill: ${val.toFixed(1)} tok/s`;
    }
  }
}

// -----------------------------------------------------------------------------
// Log Audit Polling (Directory & File Support via Native Bridge)
// -----------------------------------------------------------------------------
function pollLogFile() {
  if (!nativePort) return;

  const targetPath = (activeProfile && (activeProfile.logFile || activeProfile.runtimeLogFile)) || "";
  try {
    nativePort.postMessage({ action: "get_log", path: targetPath });
  } catch (err) {
    console.warn("[MONITOR] get_log postMessage error:", err);
  }
}

function handleLogResponse(msg) {
  const statusEl = $("log-status");
  if (!msg || msg.status !== "ok") {
    if (statusEl) {
      statusEl.textContent = msg?.error || "Log unavailable";
      statusEl.title = msg?.path || "";
    }
    return;
  }

  if (msg.file && statusEl) {
    const fileName = msg.file.split(/[\\/]/).pop();
    statusEl.textContent = fileName;
    statusEl.title = msg.file;
  }

  if (Array.isArray(msg.lines)) {
    parseMultiFormatLogs(msg.lines, msg.file || "");
  }
}

// -----------------------------------------------------------------------------
// Multi-Format Log Parser (Task-based Aggregation with Exact Wall Timestamps)
// -----------------------------------------------------------------------------
function parseMultiFormatLogs(rawLines, fileName) {
  if (!rawLines || rawLines.length === 0) return;

  // Extract process launch Unix epoch seconds from filename if available (e.g. llama-1791721767-port-...)
  const epochMatch = (fileName || "").match(/llama-(\d+)-port/);
  const startEpochSec = epochMatch ? parseInt(epochMatch[1], 10) : (Date.now() / 1000);

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i].trim();
    if (!rawLine) continue;

    // Skip recurring heartbeat lines
    if (rawLine.includes("update_slots: all slots are idle") || rawLine.includes("srv  llama_server: initializing")) {
      continue;
    }

    let msgText = rawLine;
    let timeStr = "";
    let timeMs = Date.now();

    // Check for JSON wrapper (Unsloth {"type":"log","time":...,"msg":"..."})
    if (rawLine.startsWith("{") && rawLine.endsWith("}")) {
      try {
        const obj = JSON.parse(rawLine);
        if (obj.msg || obj.message) {
          msgText = obj.msg || obj.message;
        }
        if (obj.time !== undefined) {
          // obj.time is microseconds since process start
          timeMs = (startEpochSec + obj.time / 1000000) * 1000;
          timeStr = new Date(timeMs).toLocaleTimeString();
        } else if (obj.timestamp !== undefined) {
          timeMs = obj.timestamp * 1000;
          timeStr = new Date(timeMs).toLocaleTimeString();
        }
      } catch (_) {}
    }

    if (!timeStr) {
      timeStr = new Date().toLocaleTimeString();
    }

    // Match task ID and slot ID
    const taskMatch = msgText.match(/task\s+(\d+)/i);
    const slotMatch = msgText.match(/id\s+(\d+)/i);
    const taskId = taskMatch ? taskMatch[1] : null;
    const slotId = slotMatch ? slotMatch[1] : "0";

    if (taskId) {
      if (!auditTasksMap.has(taskId)) {
        auditTasksMap.set(taskId, {
          id: taskId,
          slot: slotId,
          time: timeStr,
          timestampMs: timeMs,
          prefill: null,
          prefillProg: null,
          gen: null,
          liveGen: null,
          total: null
        });
      }
      const t = auditTasksMap.get(taskId);
      if (timeStr && (!t.time || t.time === "—")) {
        t.time = timeStr;
        t.timestampMs = timeMs;
      }

      // 1. Prompt eval completed: "prompt eval time = 429.01 ms / 161 tokens ( 2.66 ms per token, 375.28 tokens per second)"
      const pm = msgText.match(/prompt eval time\s*=\s*([\d\.]+)\s*ms\s*\/\s*(\d+)\s*tokens.*?([\d\.]+)\s*tokens per second/i);
      if (pm) {
        t.prefill = { ms: parseFloat(pm[1]), tokens: parseInt(pm[2], 10), speed: parseFloat(pm[3]) };
        t.prefillProg = null;
        if (t.prefill.speed > 0) {
          $("speed-sub").textContent = `Prefill: ${t.prefill.speed.toFixed(1)} tok/s`;
        }
      }

      // 2. Decode eval completed: "eval time = 8819.12 ms / 612 tokens ( 14.43 ms per token, 69.28 tokens per second)"
      const gm = msgText.match(/(?<!prompt\s+)eval time\s*=\s*([\d\.]+)\s*ms\s*\/\s*(\d+)\s*tokens.*?([\d\.]+)\s*tokens per second/i);
      if (gm) {
        t.gen = { ms: parseFloat(gm[1]), tokens: parseInt(gm[2], 10), speed: parseFloat(gm[3]) };
        t.liveGen = null;
        if (t.gen.speed > 0) {
          $("speed-val").textContent = t.gen.speed.toFixed(1);
        }
      }

      // 3. Live generation update: "n_gen = 422, tg = 69.54 t/s"
      const lm = msgText.match(/n_gen\s*=\s*(\d+),\s*tg\s*=\s*([\d\.]+)\s*t\/s/i);
      if (lm && !t.gen) {
        t.liveGen = { tokens: parseInt(lm[1], 10), speed: parseFloat(lm[2]) };
        if (t.liveGen.speed > 0) {
          $("speed-val").textContent = t.liveGen.speed.toFixed(1);
        }
      }

      // 4. Prefill progress: "prompt processing, n_tokens = 6144, progress = 0.04, t = 4.22 s / 1455.51 tokens per second"
      const progM = msgText.match(/prompt processing,\s*n_tokens\s*=\s*(\d+).*?t\s*=\s*([\d\.]+)\s*s\s*\/\s*([\d\.]+)\s*tokens per second/i);
      if (progM && !t.prefill) {
        t.prefillProg = { tokens: parseInt(progM[1], 10), duration: parseFloat(progM[2]), speed: parseFloat(progM[3]) };
        if (t.prefillProg.speed > 0) {
          $("speed-sub").textContent = `Prefill: ${t.prefillProg.speed.toFixed(1)} tok/s`;
        }
      }

      // 5. Total request latency: "total time = 9248.13 ms / 773 tokens"
      const tm = msgText.match(/total time\s*=\s*([\d\.]+)\s*ms\s*\/\s*(\d+)\s*tokens/i);
      if (tm) {
        t.total = { ms: parseFloat(tm[1]), tokens: parseInt(tm[2], 10) };
      }
    } else {
      // Fallback for logs without task IDs (classic llama.cpp or custom JSONL)
      const pm = msgText.match(/(?:slot print_timing:\s*id\s*(\d+).*?)?prompt eval time\s*=\s*([\d\.]+)\s*ms\s*\/\s*(\d+)\s*tokens.*?([\d\.]+)\s*tokens per second/i);
      if (pm) {
        const key = `prompt_${timeStr}_${pm[2]}`;
        if (!auditTasksMap.has(key)) {
          auditTasksMap.set(key, {
            id: "Legacy",
            slot: pm[1] || "0",
            time: timeStr,
            timestampMs: timeMs,
            prefill: { ms: parseFloat(pm[2]), tokens: parseInt(pm[3], 10), speed: parseFloat(pm[4]) },
            gen: null,
            total: null
          });
        }
      }
      const gm = msgText.match(/(?:slot print_timing:\s*id\s*(\d+).*?)?(?<!prompt\s+)eval time\s*=\s*([\d\.]+)\s*ms\s*\/\s*(\d+)\s*tokens.*?([\d\.]+)\s*tokens per second/i);
      if (gm) {
        const key = `gen_${timeStr}_${gm[2]}`;
        if (!auditTasksMap.has(key)) {
          auditTasksMap.set(key, {
            id: "Legacy",
            slot: gm[1] || "0",
            time: timeStr,
            timestampMs: timeMs,
            prefill: null,
            gen: { ms: parseFloat(gm[2]), tokens: parseInt(gm[3], 10), speed: parseFloat(gm[4]) },
            total: null
          });
        }
      }
    }
  }

  renderAuditTable();
}

function renderAuditTable() {
  const tbody = $("logs-body");
  if (!tbody) return;

  if (auditTasksMap.size === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Waiting for request completions...</td></tr>';
    return;
  }

  // Convert map to array and sort descending by timestamp (newest first)
  const tasksList = Array.from(auditTasksMap.values());
  tasksList.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));

  // Prune history to 50 max
  while (auditTasksMap.size > 50) {
    const oldestKey = tasksList[tasksList.length - 1].id;
    auditTasksMap.delete(oldestKey);
    tasksList.pop();
  }

  tbody.innerHTML = "";
  for (const t of tasksList.slice(0, 20)) {
    const tr = document.createElement("tr");

    // 1. Time (Exact wall clock)
    const timeTd = document.createElement("td");
    timeTd.textContent = t.time || "—";

    // 2. Task / Slot
    const taskTd = document.createElement("td");
    taskTd.textContent = t.id !== "Legacy" ? `Task #${t.id} · Slot ${t.slot}` : `Slot #${t.slot}`;

    // 3. Prefill
    const prefillTd = document.createElement("td");
    if (t.prefill) {
      prefillTd.innerHTML = `<b>${t.prefill.tokens} tok</b> <small class="muted">(${t.prefill.speed.toFixed(1)} t/s · ${t.prefill.ms.toFixed(0)}ms)</small>`;
    } else if (t.prefillProg) {
      prefillTd.innerHTML = `<span style="color:var(--warn)">${t.prefillProg.tokens} tok (${t.prefillProg.speed.toFixed(1)} t/s)</span>`;
    } else {
      prefillTd.innerHTML = `<span class="muted">Cached</span>`;
    }

    // 4. Generation
    const genTd = document.createElement("td");
    if (t.gen) {
      genTd.innerHTML = `<b>${t.gen.tokens} tok</b> <small class="muted">(${t.gen.speed.toFixed(1)} t/s)</small>`;
    } else if (t.liveGen) {
      genTd.innerHTML = `<span style="color:var(--accent)">${t.liveGen.tokens} gen (${t.liveGen.speed.toFixed(1)} t/s)</span>`;
    } else {
      genTd.innerHTML = `<span class="muted">—</span>`;
    }

    // 5. Total Tokens
    const tokTd = document.createElement("td");
    const totalTokens = t.total?.tokens || ((t.gen?.tokens || 0) + (t.prefill?.tokens || 0)) || t.liveGen?.tokens || "—";
    tokTd.textContent = totalTokens !== "—" ? `${totalTokens} tok` : "—";

    // 6. Duration
    const durTd = document.createElement("td");
    if (t.total?.ms) {
      durTd.textContent = `${(t.total.ms / 1000).toFixed(1)} s`;
    } else if (t.gen?.ms) {
      durTd.textContent = `${(t.gen.ms / 1000).toFixed(1)} s`;
    } else if (t.liveGen) {
      durTd.innerHTML = `<span class="card-tag" style="color:var(--accent)">Generating...</span>`;
    } else {
      durTd.textContent = "—";
    }

    tr.appendChild(timeTd);
    tr.appendChild(taskTd);
    tr.appendChild(prefillTd);
    tr.appendChild(genTd);
    tr.appendChild(tokTd);
    tr.appendChild(durTd);
    tbody.appendChild(tr);
  }
}

// -----------------------------------------------------------------------------
// Profile UI & Event Listeners
// -----------------------------------------------------------------------------
function setupProfileUI() {
  $("profile-select").addEventListener("change", async (e) => {
    const newId = e.target.value;
    currentConfig.activeProfileId = newId;
    activeProfile = currentConfig.profiles[newId];
    await chrome.storage.local.set({ activeProfileId: newId });
    populateEditor(activeProfile);

    // If switching to Unsloth, trigger immediate discovery
    if (newId === "unsloth") {
      checkUnslothDetection();
    }
    pollServer();
  });

  $("btn-settings").addEventListener("click", () => {
    switchTab("config");
    populateEditor(activeProfile);
  });

  $("btn-fullscreen")?.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      const targetUrl = chrome.runtime.getURL("dashboard.html");
      if (tabId) {
        chrome.tabs.update(tabId, { url: targetUrl });
      } else {
        chrome.tabs.create({ url: targetUrl });
      }
    });
  });

  $("btn-add-profile").addEventListener("click", () => {
    const newId = "profile_" + Date.now();
    const newProf = {
      id: newId,
      name: "New Profile",
      baseUrl: "http://127.0.0.1:8080",
      logFile: "",
      apiKey: "",
      pollIntervalMs: 1000
    };
    currentConfig.profiles[newId] = newProf;
    currentConfig.activeProfileId = newId;
    activeProfile = newProf;
    saveConfig();
    renderProfileDropdown();
    populateEditor(newProf);
  });

  $("btn-save-profile").addEventListener("click", () => {
    if (!activeProfile) return;
    activeProfile.name = $("cfg-name").value.trim() || "Server";
    activeProfile.baseUrl = $("cfg-url").value.trim();
    activeProfile.logFile = $("cfg-log").value.trim();
    activeProfile.apiKey = $("cfg-key").value.trim();
    // Clear dynamic overrides so manual config takes effect
    delete activeProfile.runtimeBaseUrl;
    delete activeProfile.runtimeApiKey;
    delete activeProfile.runtimeLogFile;
    delete activeProfile.runtimePort;
    saveConfig();
    renderProfileDropdown();
    alert("Profile saved!");
    pollServer();
  });

  $("btn-delete-profile").addEventListener("click", () => {
    if (!activeProfile) return;
    const keys = Object.keys(currentConfig.profiles);
    if (keys.length <= 1) {
      alert("Cannot delete the only remaining profile.");
      return;
    }
    delete currentConfig.profiles[activeProfile.id];
    currentConfig.activeProfileId = Object.keys(currentConfig.profiles)[0];
    activeProfile = currentConfig.profiles[currentConfig.activeProfileId];
    saveConfig();
    renderProfileDropdown();
    populateEditor(activeProfile);
  });

  const btnDetect = $("btn-detect-unsloth");
  if (btnDetect) {
    btnDetect.addEventListener("click", () => {
      const statusEl = $("detect-unsloth-status");
      if (statusEl) statusEl.textContent = "Scanning...";
      if (!nativePort) connectNativeHost();
      if (nativePort) {
        nativePort.postMessage({ action: "detect_unsloth" });
        setTimeout(() => {
          if (detectedUnsloth && detectedUnsloth.detected) {
            $("cfg-url").value = detectedUnsloth.baseUrl;
            $("cfg-key").value = detectedUnsloth.apiKey;
            if (!$("cfg-log").value) {
              $("cfg-log").value = detectedUnsloth.latestLog;
            }
            if (statusEl) statusEl.textContent = `Applied Port ${detectedUnsloth.port}! Remember to save.`;
          }
        }, 500);
      }
    });
  }
}

function populateEditor(p) {
  if (!p) return;
  $("cfg-name").value = p.name || "";
  $("cfg-url").value = p.baseUrl || "";
  $("cfg-log").value = p.logFile || "";
  $("cfg-key").value = p.apiKey || "";
}

async function saveConfig() {
  await chrome.storage.local.set(currentConfig);
}

// -----------------------------------------------------------------------------
// Tabs Navigation
// -----------------------------------------------------------------------------
function setupTabNavigation() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const isTarget = b.dataset.tab === tabId;
    b.classList.toggle("active", isTarget);
    b.setAttribute("aria-selected", String(isTarget));
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabId}`);
  });
}

// -----------------------------------------------------------------------------
// Main Polling Loop
// -----------------------------------------------------------------------------
function startPollingLoops() {
  // Telemetry intervals
  setInterval(pollGpuHardware, 1000);
  setInterval(pollHostSystem, 1000);
  setInterval(pollServer, 1000);

  // Periodic Unsloth port verification (every 5 seconds)
  setInterval(() => {
    if (activeProfile && (activeProfile.id === "unsloth" || activeProfile.baseUrl.includes(":8888"))) {
      checkUnslothDetection();
    }
  }, 5000);

  // Initial runs
  pollGpuHardware();
  pollHostSystem();
  pollServer();
}

// Run when DOM ready
document.addEventListener("DOMContentLoaded", init);
