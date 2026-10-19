// dashboard.js - Universal llama.cpp Full-Browser Telemetry & Request Inspector Engine
"use strict";

const $ = (id) => document.getElementById(id);

// -----------------------------------------------------------------------------
// State & Configuration
// -----------------------------------------------------------------------------
let selectedId = null;
let detailRecord = null;
let activePane = "input";
let records = [];
let stamp = "";
let nativePort = null;
let detectedUnsloth = null;
let lastGpusData = [];
let prevCpuTimes = null;
let lastHostCpuText = "—%";
let lastHostCpuPct = 0;
let lastHostRamText = "— / — GB";
let lastHostRamPct = 0;

function formatDuration(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatDurationShort(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const DEFAULT_PROFILES = {
  activeProfileId: "unsloth",
  profiles: {
    unsloth: {
      id: "unsloth",
      name: "Unsloth (Auto-Detect)",
      baseUrl: "http://127.0.0.1:8888",
      logFile: "",
      apiKey: ""
    },
    llama_default: {
      id: "llama_default",
      name: "llama.cpp (Port 8080)",
      baseUrl: "http://127.0.0.1:8080",
      logFile: "",
      apiKey: ""
    },
    custom: {
      id: "custom",
      name: "Custom Engine (Port 5001)",
      baseUrl: "http://127.0.0.1:5001",
      logFile: "",
      apiKey: ""
    }
  }
};

let currentConfig = null;
let activeProfile = null;
const auditTasksMap = new Map();

// Helper formatting
const seconds = (n) => typeof n === "number" ? `${n.toFixed(2)} s` : "—";
const speedFmt = (n) => typeof n === "number" ? n.toFixed(1) : "—";
function setText(id, val) { const el = $(id); if (el && el.textContent !== String(val)) el.textContent = val; }
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------
async function init() {
  // Theme init
  document.documentElement.dataset.theme = localStorage.getItem("llama_monitor.theme") || "dark";

  await loadConfig();
  setupUIEventListeners();
  connectNativeHost();
  startPolling();
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
// Native Host IPC (NVIDIA SMI & Unsloth Bridge)
// -----------------------------------------------------------------------------
let connectingHost = false;

function connectNativeHost() {
  if (connectingHost || nativePort) return;
  connectingHost = true;
  try {
    nativePort = chrome.runtime.connectNative("com.llama.smi_host");
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message || "Disconnected";
      setText("updated", `Native Bridge: Disconnected (${err})`);
      nativePort = null;
      connectingHost = false;
    });
    connectingHost = false;
    nativePort.postMessage({ action: "get_gpu" });
    checkUnslothDetection();
  } catch (err) {
    nativePort = null;
    connectingHost = false;
  }
}

function handleNativeMessage(msg) {
  if (!msg) return;

  if (msg.action === "detect_unsloth" || msg.detected !== undefined) {
    handleUnslothDetection(msg);
    return;
  }

  if (msg.action === "get_log" || msg.lines !== undefined) {
    handleLogResponse(msg);
    return;
  }

  if (msg.status === "ok" && (msg.gpu || msg.all_gpus)) {
    lastGpusData = msg.all_gpus || [msg.gpu];
    renderAllGpus(lastGpusData);
  }
}

function checkUnslothDetection() {
  if (!nativePort) return;
  try {
    nativePort.postMessage({ action: "detect_unsloth" });
  } catch (_) {}
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
    const statusEl = $("cfg-status");
    if (statusEl) {
      statusEl.textContent = `Auto-detected active engine port ${msg.port}!`;
      statusEl.style.color = "var(--st-accent)";
    }
  }
}

// -----------------------------------------------------------------------------
// Hardware Telemetry Rendering
// -----------------------------------------------------------------------------
function renderAllGpus(gpus) {
  const container = $("hw-cards-container");
  if (!container || !Array.isArray(gpus) || gpus.length === 0) return;

  let totalUsedMb = 0;
  let totalMaxMb = 0;

  for (const g of gpus) {
    totalUsedMb += g.vram_used_mb || 0;
    totalMaxMb += g.vram_total_mb || 0;
  }

  const totalGbUsed = (totalUsedMb / 1024).toFixed(1);
  const totalGbMax = (totalMaxMb / 1024).toFixed(1);
  const poolPct = totalMaxMb > 0 ? (totalUsedMb / totalMaxMb) * 100 : 0;

  container.innerHTML = "";

  // 1. Dual-GPU / Multi-GPU Combined Pool Card
  if (gpus.length > 1) {
    const poolCard = document.createElement("div");
    poolCard.className = "hw-card";
    poolCard.style.borderLeft = "3px solid var(--st-accent)";
    poolCard.innerHTML = `
      <div class="hw-header">
        <h3>Combined VRAM Pool (${gpus.length} GPUs)</h3>
        <span class="tag completed">${totalGbUsed} / ${totalGbMax} GB (${poolPct.toFixed(1)}%)</span>
      </div>
      <div class="meter-group">
        <div class="meter-row">
          <div class="meter-info">
            <span>Pool Allocation</span>
            <b>${totalUsedMb.toFixed(0)} / ${totalMaxMb.toFixed(0)} MB</b>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, poolPct)}%"></div></div>
        </div>
      </div>
    `;
    container.appendChild(poolCard);
  }

  // 2. Individual GPU Cards
  for (const g of gpus) {
    const card = document.createElement("div");
    card.className = "hw-card";

    const vramPct = g.vram_total_mb > 0 ? (g.vram_used_mb / g.vram_total_mb) * 100 : 0;
    const tempPct = Math.min(100, (g.temperature_c / 100) * 100);

    card.innerHTML = `
      <div class="hw-header">
        <h3>GPU ${g.index}: ${escapeHtml(g.name || "NVIDIA GPU")}</h3>
        <span class="tag">${(g.vram_total_mb / 1024).toFixed(0)} GB</span>
      </div>
      <div class="meter-group">
        <div class="meter-row">
          <div class="meter-info">
            <span>GPU Utilization</span>
            <b>${g.gpu_util_pct.toFixed(0)}%</b>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, g.gpu_util_pct)}%"></div></div>
        </div>
        <div class="meter-row">
          <div class="meter-info">
            <span>VRAM Allocation</span>
            <b>${g.vram_used_mb.toFixed(0)} / ${g.vram_total_mb.toFixed(0)} MB (${vramPct.toFixed(1)}%)</b>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, vramPct)}%"></div></div>
        </div>
        <div class="meter-row">
          <div class="meter-info">
            <span>Thermals & Power</span>
            <b>${g.temperature_c.toFixed(0)}°C · ${g.power_w.toFixed(1)} W</b>
          </div>
          <div class="progress-bar warn"><div class="progress-fill" style="width:${tempPct}%"></div></div>
        </div>
      </div>
    `;
    container.appendChild(card);
  }

  // 3. Host System (CPU & Memory)
  const hostCard = document.createElement("div");
  hostCard.className = "hw-card";
  hostCard.innerHTML = `
    <div class="hw-header">
      <h3>Host System</h3>
      <span class="tag">chrome.system</span>
    </div>
    <div class="meter-group">
      <div class="meter-row">
        <div class="meter-info">
          <span>Host CPU Load</span>
          <b id="hw-cpu-val">${lastHostCpuText}</b>
        </div>
        <div class="progress-bar info"><div id="bar-cpu" class="progress-fill" style="width:${lastHostCpuPct}%"></div></div>
      </div>
      <div class="meter-row">
        <div class="meter-info">
          <span>Host Memory (RAM)</span>
          <b id="hw-ram-val">${lastHostRamText}</b>
        </div>
        <div class="progress-bar info"><div id="bar-ram" class="progress-fill" style="width:${lastHostRamPct}%"></div></div>
      </div>
    </div>
  `;
  container.appendChild(hostCard);
}

// Host CPU & RAM Telemetry
function pollHostMetrics() {
  if (chrome.system?.cpu) {
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
          if (totalDiff > 0) sumPct += ((userDiff + kernelDiff) / totalDiff) * 100;
        }
        totalUsage = sumPct / processors.length;
        lastHostCpuText = `${totalUsage.toFixed(0)}%`;
        lastHostCpuPct = Math.min(100, totalUsage);
        setText("hw-cpu-val", lastHostCpuText);
        const bar = $("bar-cpu");
        if (bar) bar.style.width = `${lastHostCpuPct}%`;
      }
      prevCpuTimes = processors.map((p) => ({ ...p.usage }));
    });
  }

  if (chrome.system?.memory) {
    chrome.system.memory.getInfo((mem) => {
      if (!mem) return;
      const totalGb = mem.capacity / 1073741824;
      const usedGb = (mem.capacity - mem.availableCapacity) / 1073741824;
      const pct = (usedGb / totalGb) * 100;
      lastHostRamText = `${usedGb.toFixed(1)} / ${totalGb.toFixed(1)} GB`;
      lastHostRamPct = Math.min(100, pct);
      setText("hw-ram-val", lastHostRamText);
      const bar = $("bar-ram");
      if (bar) bar.style.width = `${lastHostRamPct}%`;
    });
  }
}

// -----------------------------------------------------------------------------
// Engine Polling (/slots & /v1/models & Log Stream)
// -----------------------------------------------------------------------------
async function pollServer() {
  if (!activeProfile) return;

  const isUnsloth = activeProfile.id === "unsloth" || activeProfile.baseUrl.includes(":8888");
  let baseUrl = activeProfile.runtimeBaseUrl || activeProfile.baseUrl || "http://127.0.0.1:8080";
  baseUrl = baseUrl.replace(/\/+$/, "");
  let apiKey = activeProfile.runtimeApiKey || activeProfile.apiKey || "";

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
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const slotsResp = await fetch(`${baseUrl}/slots`, { cache: "no-store", headers });
    if (!slotsResp.ok) throw new Error(`HTTP ${slotsResp.status}`);

    const slots = await slotsResp.json();
    const portLabel = baseUrl.split(":").pop();

    setText("loaded", `Online (Port ${portLabel})`);
    $("model-state").className = "value loaded";

    // Model name from the always-on OpenAI endpoint; no --props needed.
    let modelName = `${baseUrl}/v1`;
    try {
      const modelsResp = await fetch(`${baseUrl}/v1/models`, { cache: "no-store", headers });
      if (modelsResp.ok) {
        const models = await modelsResp.json();
        modelName = models?.data?.[0]?.id || modelName;
      }
    } catch (_) {
      // Model name is optional; keep the base URL fallback.
    }
    setText("model", modelName);

    // Context fill: the fullest slot's usage of its own context window.
    let ctxUsed = 0;
    let ctxTotal = 0;
    let busyCount = 0;

    for (const s of slots) {
      const isBusy = s.state === "processing" || s.is_processing === true;
      if (isBusy) busyCount++;

      const nCtx = s.n_ctx || 0;
      if (!ctxTotal) ctxTotal = nCtx;

      const promptTokens = s.n_prompt_tokens || 0;
      const decodedTokens = (Array.isArray(s.next_token) && s.next_token[0]?.n_decoded) || 0;
      const tokensUsed = promptTokens > 0 ? promptTokens + decodedTokens : 0;
      if (tokensUsed > ctxUsed) ctxUsed = tokensUsed;

      // Inject active slot prompt and context size into task record if active
      if (s.id_task) {
        const t = auditTasksMap.get(String(s.id_task));
        if (t) {
          if (s.prompt && !t.prompt) t.prompt = s.prompt;
          if (s.n_ctx) t.slotCtx = s.n_ctx;
        }
      }
    }

    if (ctxTotal > 0) {
      const fillPct = (ctxUsed / ctxTotal) * 100;
      const usedStr = ctxUsed >= 1000 ? `${(ctxUsed / 1000).toFixed(1)}k` : String(ctxUsed);
      const totalStr = ctxTotal >= 1000 ? `${Math.round(ctxTotal / 1000)}k` : String(ctxTotal);
      setText("ctx-fill", `${usedStr} / ${totalStr} · ${fillPct.toFixed(1)}%`);
    }

    setText("active", busyCount > 0 ? `${busyCount} active slot${busyCount > 1 ? "s" : ""}` : `Idle: ${slots.length} slot${slots.length > 1 ? "s" : ""}`);
    $("notice-error").hidden = true;
  } catch (err) {
    if (isUnsloth) checkUnslothDetection();
    setText("loaded", "Unreachable");
    $("model-state").className = "value error";
    setText("active", "Server offline or loading");
  }

  // Poll log stream via Native Bridge
  pollLogs();
}

function pollLogs() {
  if (!nativePort) return;
  const targetPath = (activeProfile && (activeProfile.logFile || activeProfile.runtimeLogFile)) || "";
  try {
    nativePort.postMessage({ action: "get_log", path: targetPath });
  } catch (_) {}
}

function handleLogResponse(msg) {
  if (!msg || msg.status !== "ok" || !Array.isArray(msg.lines)) return;
  parseMultiFormatLogs(msg.lines, msg.file || "");
}

// -----------------------------------------------------------------------------
// Multi-Format Log Parser with Task Registry (Never wipes on idle)
// -----------------------------------------------------------------------------
function parseMultiFormatLogs(rawLines, fileName) {
  if (!rawLines || rawLines.length === 0) return;

  const epochMatch = (fileName || "").match(/llama-(\d+)-port/);
  const startEpochSec = epochMatch ? parseInt(epochMatch[1], 10) : (Date.now() / 1000);

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i].trim();
    if (!rawLine || rawLine.includes("update_slots: all slots are idle") || rawLine.includes("srv  llama_server: initializing")) continue;

    let msgText = rawLine;
    let timeStr = "";
    let timeMs = Date.now();

    if (rawLine.startsWith("{") && rawLine.endsWith("}")) {
      try {
        const obj = JSON.parse(rawLine);
        if (obj.msg || obj.message) msgText = obj.msg || obj.message;
        if (obj.time !== undefined) {
          timeMs = (startEpochSec + obj.time / 1000000) * 1000;
          timeStr = new Date(timeMs).toLocaleTimeString();
        } else if (obj.timestamp !== undefined) {
          timeMs = obj.timestamp * 1000;
          timeStr = new Date(timeMs).toLocaleTimeString();
        }
      } catch (_) {}
    }

    if (!timeStr) timeStr = new Date().toLocaleTimeString();

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
          total: null,
          state: "loading",
          path: "/v1/chat/completions"
        });
      }
      const t = auditTasksMap.get(taskId);
      if (timeStr && (!t.time || t.time === "—")) {
        t.time = timeStr;
        t.timestampMs = timeMs;
      }

      // Prefill timing
      const pm = msgText.match(/prompt eval time\s*=\s*([\d\.]+)\s*ms\s*\/\s*(\d+)\s*tokens.*?([\d\.]+)\s*tokens per second/i);
      if (pm) {
        t.prefill = { ms: parseFloat(pm[1]), tokens: parseInt(pm[2], 10), speed: parseFloat(pm[3]) };
        t.prefillProg = null;
        if (t.prefill.speed > 0) setText("speed-sub", `Prefill: ${t.prefill.speed.toFixed(1)} tok/s · ${formatDurationShort(t.prefill.ms)}`);
      }

      // Generation timing
      const gm = msgText.match(/(?<!prompt\s+)eval time\s*=\s*([\d\.]+)\s*ms\s*\/\s*(\d+)\s*tokens.*?([\d\.]+)\s*tokens per second/i);
      if (gm) {
        t.gen = { ms: parseFloat(gm[1]), tokens: parseInt(gm[2], 10), speed: parseFloat(gm[3]) };
        t.liveGen = null;
        t.state = "completed";
        if (t.gen.speed > 0) setText("speed", t.gen.speed.toFixed(1));
      }

      // Live generation update
      const lm = msgText.match(/n_gen\s*=\s*(\d+),\s*tg\s*=\s*([\d\.]+)\s*t\/s/i);
      if (lm && !t.gen) {
        t.liveGen = { tokens: parseInt(lm[1], 10), speed: parseFloat(lm[2]) };
        t.state = "generating";
        if (t.liveGen.speed > 0) setText("speed", t.liveGen.speed.toFixed(1));
      }

      // Total time
      const tm = msgText.match(/total time\s*=\s*([\d\.]+)\s*ms\s*\/\s*(\d+)\s*tokens/i);
      if (tm) {
        t.total = { ms: parseFloat(tm[1]), tokens: parseInt(tm[2], 10) };
        t.state = "completed";
      }
    }
  }

  // Sync to records array
  records = Array.from(auditTasksMap.values()).sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));

  // Prune history
  while (records.length > 100) {
    const oldest = records.pop();
    auditTasksMap.delete(oldest.id);
  }

  setText("count", records.length);
  renderRequestsList();

  if (selectedId) {
    showDetail(selectedId);
  }

  setText("updated", `Live · updated ${new Date().toLocaleTimeString()}`);
}

// -----------------------------------------------------------------------------
// Workspace & Request Inspector
// -----------------------------------------------------------------------------
function renderRequestsList() {
  const query = ($("search").value || "").toLowerCase();
  const filter = $("filter").value;

  const visible = records.filter((r) => {
    const matchText = `${r.id} ${r.path} slot ${r.slot}`.toLowerCase();
    const matchQuery = matchText.includes(query);
    const matchFilter =
      filter === "all" ||
      (filter === "active" && (r.state === "generating" || r.state === "loading")) ||
      r.state === filter;
    return matchQuery && matchFilter;
  });

  const nextStamp = JSON.stringify([visible.map((v) => ({ id: v.id, state: v.state, tokens: v.gen?.tokens, speed: v.gen?.speed })), selectedId]);
  if (stamp === nextStamp) return;
  stamp = nextStamp;

  const container = $("requests");
  container.replaceChildren();

  if (visible.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.className = "empty";
    emptyDiv.textContent = records.length ? "No matching requests." : "No requests yet. API calls will appear here automatically.";
    container.append(emptyDiv);
    return;
  }

  for (const r of visible) {
    const btn = document.createElement("button");
    btn.className = `request${selectedId === r.id ? " selected" : ""}`;
    btn.dataset.request = r.id;
    btn.setAttribute("aria-label", `Request ${r.id}`);

    const row = document.createElement("div");
    row.className = "row";

    const timeSpan = document.createElement("span");
    timeSpan.textContent = r.time || "—";

    const tagSpan = document.createElement("span");
    tagSpan.className = `tag ${r.state || "completed"}`;
    tagSpan.textContent = r.state === "generating" ? "generating" : r.state === "completed" ? "completed" : r.state;

    row.append(timeSpan, tagSpan);

    const endpoint = document.createElement("div");
    endpoint.className = "endpoint";
    endpoint.textContent = `POST ${r.path || "/v1/chat/completions"} (Slot ${r.slot})`;

    const meta = document.createElement("div");
    meta.className = "small";

    const totalTok = r.total?.tokens || (r.gen?.tokens || 0) + (r.prefill?.tokens || 0) || r.liveGen?.tokens || "—";
    const wallSec = r.total?.ms ? `${(r.total.ms / 1000).toFixed(1)} s` : r.gen?.ms ? `${(r.gen.ms / 1000).toFixed(1)} s` : "In prog";
    const genSpeed = r.gen?.speed ? `${r.gen.speed.toFixed(1)} tok/s` : r.liveGen?.speed ? `${r.liveGen.speed.toFixed(1)} tok/s` : "";

    meta.textContent = `Task #${r.id} · ${totalTok} tok · ${wallSec}${genSpeed ? ` · ${genSpeed}` : ""}`;

    btn.append(row, endpoint, meta);

    btn.onclick = () => {
      selectedId = r.id;
      renderRequestsList();
      showDetail(r.id);
    };

    container.append(btn);
  }
}

function showDetail(id) {
  const r = records.find((rec) => rec.id === id);
  if (!r) return;
  detailRecord = r;

  $("no-selection").hidden = true;
  $("selection").hidden = false;

  setText("detail-title", `Task #${r.id} · POST ${r.path || "/v1/chat/completions"}`);
  setText("detail-status", r.state || "completed");
  $("detail-status").className = `tag ${r.state || "completed"}`;
  setText("detail-time", `Recorded at ${r.time}`);

  // Facts Grid (8 Facts)
  const wallStr = r.total?.ms ? formatDuration(r.total.ms) : r.gen?.ms ? formatDuration(r.gen.ms) : "In progress";
  setText("detail-wall", wallStr);

  let queueMs = 0;
  if (r.total?.ms && (r.prefill?.ms || r.gen?.ms)) {
    const execMs = (r.prefill?.ms || 0) + (r.gen?.ms || 0);
    queueMs = Math.max(0, r.total.ms - execMs);
  }
  setText("detail-queue", queueMs > 15 ? formatDuration(queueMs) : "< 10 ms");

  setText("detail-first", r.prefill?.ms ? formatDuration(r.prefill.ms) : (r.prefillProg ? "Processing..." : "Cached / —"));
  setText("detail-prompt", r.prefill ? `${r.prefill.tokens.toLocaleString()} tok` : "Cached");
  setText("detail-tokens", r.gen ? `${r.gen.tokens.toLocaleString()} tok` : r.liveGen ? `${r.liveGen.tokens.toLocaleString()} tok (live)` : "—");
  setText("detail-speed", r.gen ? `${r.gen.speed.toFixed(1)} tok/s` : r.liveGen ? `${r.liveGen.speed.toFixed(1)} tok/s` : "—");
  setText("detail-prefill-speed", r.prefill ? `${r.prefill.speed.toFixed(1)} tok/s` : "—");

  const promptToks = r.prefill?.tokens || 0;
  const genToks = r.gen?.tokens || r.liveGen?.tokens || 0;
  const totalReqToks = promptToks + genToks;
  if (totalReqToks > 0) {
    const ctxLimit = r.slotCtx || 6672;
    const pct = Math.min(100, (totalReqToks / ctxLimit) * 100).toFixed(1);
    setText("detail-ctx", `${totalReqToks.toLocaleString()} tok (${pct}%)`);
  } else {
    setText("detail-ctx", `Slot #${r.slot}`);
  }

  updateTabContent();
}

function updateTabContent() {
  if (!detailRecord) return;
  const r = detailRecord;

  let textVal = "";
  let noteVal = "";

  if (activePane === "input") {
    textVal = r.prompt || `Task #${r.id} prompt tokens evaluated: ${r.prefill?.tokens || "Cached"}\n(Detailed prompt content streamed via slot memory)`;
    noteVal = "Original request prompt and inputs.";
  } else if (activePane === "output") {
    textVal = r.output || `Decoded ${r.gen?.tokens || r.liveGen?.tokens || 0} tokens @ ${r.gen?.speed || r.liveGen?.speed || 0} tok/s.\nTask completed successfully.`;
    noteVal = "Model generated answer.";
  } else if (activePane === "reasoning") {
    textVal = r.reasoning || "No separate reasoning blocks detected in this completion.";
    noteVal = "Chain of thought / reasoning content.";
  } else if (activePane === "response") {
    const responsePayload = {
      task_id: r.id,
      slot_id: r.slot,
      time: r.time,
      state: r.state,
      prefill: r.prefill,
      generation: r.gen,
      total_time_ms: r.total?.ms,
      total_tokens: r.total?.tokens
    };
    textVal = JSON.stringify(responsePayload, null, 2);
    noteVal = "Raw timings, latency benchmarks, and metrics.";
  }

  setText("content", textVal);
  setText("content-note", noteVal);
}

// -----------------------------------------------------------------------------
// UI Event Handlers
// -----------------------------------------------------------------------------
function setupUIEventListeners() {
  // Theme switcher
  $("theme").onclick = () => {
    const curTheme = document.documentElement.dataset.theme;
    const newTheme = curTheme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = newTheme;
    localStorage.setItem("llama_monitor.theme", newTheme);
  };

  // Search and status filters
  $("search").oninput = renderRequestsList;
  $("filter").onchange = renderRequestsList;

  // Tabs
  document.querySelectorAll("[data-pane]").forEach((btn) => {
    btn.onclick = () => {
      activePane = btn.dataset.pane;
      document.querySelectorAll("[data-pane]").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
      updateTabContent();
    };
  });

  // Copy
  $("copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("content").textContent);
      setText("copy", "Copied");
      setTimeout(() => setText("copy", "Copy"), 1500);
    } catch (_) {}
  };

  // Refresh
  $("btn-refresh").onclick = () => {
    pollServer();
    pollHostMetrics();
  };

  // Auto-detect Unsloth button
  $("btn-auto-unsloth").onclick = () => {
    if (!nativePort) connectNativeHost();
    checkUnslothDetection();
    setTimeout(() => {
      if (detectedUnsloth && detectedUnsloth.detected) {
        alert(`Detected Unsloth active port ${detectedUnsloth.port}!\nRedirecting monitor.`);
        pollServer();
      } else {
        alert("Unsloth detection scanned. Ensure Unsloth is running.");
      }
    }, 400);
  };

  // API Key modal
  $("key").onclick = () => {
    $("auth").hidden = !$("auth").hidden;
    if (!$("auth").hidden) $("api-key").focus();
  };

  $("auth").onsubmit = (e) => {
    e.preventDefault();
    const key = $("api-key").value.trim();
    if (activeProfile) activeProfile.apiKey = key;
    $("auth").hidden = true;
    pollServer();
  };

  // Profile Drawer
  $("btn-profiles-toggle").onclick = () => {
    $("profile-drawer").hidden = !$("profile-drawer").hidden;
    populateProfileForm(activeProfile);
  };

  $("btn-close-drawer").onclick = () => {
    $("profile-drawer").hidden = true;
  };

  $("profile-select").onchange = async (e) => {
    const newId = e.target.value;
    currentConfig.activeProfileId = newId;
    activeProfile = currentConfig.profiles[newId];
    await chrome.storage.local.set({ activeProfileId: newId });
    populateProfileForm(activeProfile);
    if (newId === "unsloth") checkUnslothDetection();
    pollServer();
  };

  $("btn-add-profile").onclick = () => {
    const newId = "profile_" + Date.now();
    const newProf = { id: newId, name: "New Profile", baseUrl: "http://127.0.0.1:8080", logFile: "", apiKey: "" };
    currentConfig.profiles[newId] = newProf;
    currentConfig.activeProfileId = newId;
    activeProfile = newProf;
    chrome.storage.local.set(currentConfig);
    renderProfileDropdown();
    populateProfileForm(newProf);
  };

  $("btn-save-profile").onclick = async () => {
    if (!activeProfile) return;
    activeProfile.name = $("cfg-name").value.trim() || "Server";
    activeProfile.baseUrl = $("cfg-url").value.trim();
    activeProfile.logFile = $("cfg-log").value.trim();
    activeProfile.apiKey = $("cfg-key").value.trim();
    delete activeProfile.runtimeBaseUrl;
    delete activeProfile.runtimeApiKey;
    delete activeProfile.runtimePort;
    await chrome.storage.local.set(currentConfig);
    renderProfileDropdown();
    setText("cfg-status", "Profile saved!");
    setTimeout(() => setText("cfg-status", ""), 2000);
    pollServer();
  };

  $("btn-delete-profile").onclick = async () => {
    if (!activeProfile) return;
    const keys = Object.keys(currentConfig.profiles);
    if (keys.length <= 1) {
      alert("Cannot delete the only profile.");
      return;
    }
    delete currentConfig.profiles[activeProfile.id];
    currentConfig.activeProfileId = Object.keys(currentConfig.profiles)[0];
    activeProfile = currentConfig.profiles[currentConfig.activeProfileId];
    await chrome.storage.local.set(currentConfig);
    renderProfileDropdown();
    populateProfileForm(activeProfile);
  };
}

function populateProfileForm(p) {
  if (!p) return;
  $("cfg-name").value = p.name || "";
  $("cfg-url").value = p.baseUrl || "";
  $("cfg-log").value = p.logFile || "";
  $("cfg-key").value = p.apiKey || "";
}

// -----------------------------------------------------------------------------
// Polling Loop
// -----------------------------------------------------------------------------
function startPolling() {
  setInterval(pollServer, 1000);
  setInterval(pollHostMetrics, 1000);
  setInterval(() => {
    if (nativePort) nativePort.postMessage({ action: "get_gpu" });
  }, 1000);

  // Initial queries
  pollServer();
  pollHostMetrics();
}

document.addEventListener("DOMContentLoaded", init);
