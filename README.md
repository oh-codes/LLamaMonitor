# Universal llama.cpp Monitor

A real-time telemetry and inference monitor for local LLM engines (`llama.cpp`'s `llama-server`, Unsloth, Ollama, vLLM, and OpenAI-compatible backends).

Runs directly inside Google Chrome with two complementary views:
- **Full-Browser Tab Dashboard (`dashboard.html`)**: Rich 2-column workspace with live multi-GPU hardware cards, 8-fact request inspector, dynamic search/filter, and Gainsty-grade design system (light/dark mode).
- **Chrome Side Panel (`sidepanel/monitor.html`)**: Compact sidebar docked next to active browser work.

---

## Visual UI Snapshots

### 1. Full-Browser Dashboard & Live Hardware Telemetry

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ⚡ Universal llama.cpp   [ Unsloth (Auto-Detect) ▼ ] [⚙️ Profiles] [☀️/🌙]      ● Live · updated 15:42:10   │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  TOP KPI SUMMARY CARDS                                                                                 │
│  ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐  │
│  │ MODEL                 │ │ REQUESTS              │ │ CONTEXT FILL          │ │ DECODE SPEED          │  │
│  │ Qwen2.5-Coder-32B     │ │ 24 retained           │ │ 8,192 / 32,768 (25%)  │ │ 37.04 tok/s           │  │
│  │ Slot 0: generating    │ │ 1 active              │ │ [████░░░░░░░░░░░░░░░] │ │ 61.2 tok/s prefill    │  │
│  └───────────────────────┘ └───────────────────────┘ └───────────────────────┘ └───────────────────────┘  │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  HARDWARE TELEMETRY                                                                                    │
│  ┌─────────────────────────────────────────────────┐ ┌─────────────────────────────────────────────────┐│
│  │ NVIDIA GeForce RTX 3060 (12GB)                  │ │ NVIDIA GeForce RTX 4060 Ti (16GB)              ││
│  │ 11,480 / 12,288 MB (93.4%)                      │ │ 14,210 / 16,384 MB (86.7%)                      ││
│  │ [██████████████████████████████████░░]          │ │ [████████████████████████████████░░░░]          ││
│  │ 🌡️ 58°C   ⚡ 142W   ⚙️ 98% GPU Util              │ │ 🌡️ 52°C   ⚡ 118W   ⚙️ 94% GPU Util              ││
│  └─────────────────────────────────────────────────┘ └─────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────┐ ┌─────────────────────────────────────────────────┐│
│  │ COMBINED VRAM POOL                              │ │ HOST CPU & SYSTEM RAM                           ││
│  │ 25,690 / 28,672 MB (89.6%)                      │ │ CPU: 18.4% (16 Cores)                           ││
│  │ [█████████████████████████████████░░░]          │ │ RAM: 28.2 / 64.0 GB (44.1%)                     ││
│  │ Dual GPU Cluster Balanced Offload               │ │ System Host Bus Normal                          ││
│  └─────────────────────────────────────────────────┘ └─────────────────────────────────────────────────┘│
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  WORKSPACE & REQUEST INSPECTOR                                                                         │
│  ┌───────────────────────────────────┐ ┌──────────────────────────────────────────────────────────────┐ │
│  │ [🔍 Filter by ID, path, slot...]  │ │ Request: req-task-86 · slot 0 · completed in 1.42s           │ │
│  │ [ All ▼ ]             24 requests │ ├──────────────────────────────────────────────────────────────┤ │
│  ├───────────────────────────────────┤ │ 8-FACTS INSPECTION GRID                                      │ │
│  │ ● req-task-86              15:41  │ │ ┌──────────────┬──────────────┬──────────────┬──────────────┐│ │
│  │   /v1/chat/completions   37.0 t/s │ │ │ Wall Clock   │ Queue Wait   │ Prefill Lat. │ Prompt Tok   ││ │
│  │   slot 0 · 55 tok · 1.42s         │ │ │ 1.42 s       │ 12 ms        │ 241 ms       │ 2,267 tok    ││ │
│  │                                   │ │ ├──────────────┼──────────────┼──────────────┼──────────────┤│ │
│  │ ○ req-task-85              15:39  │ │ │ Output Tok   │ Decode Speed │ Prefill Spd  │ Context Fill ││ │
│  │   /v1/chat/completions   36.8 t/s │ │ │ 55 tok       │ 37.04 t/s    │ 61.2 t/s     │ 25.0%        ││ │
│  │   slot 0 · 214 tok · 5.81s        │ │ └──────────────┴──────────────┴──────────────┴──────────────┘│ │
│  │                                   │ ├──────────────────────────────────────────────────────────────┤ │
│  │ ○ req-task-84              15:36  │ │ [Input]  [Output]  [Reasoning]  [Timings & Raw JSON]  [Copy] │ │
│  │   /completion            38.1 t/s │ │                                                              │ │
│  │   slot 0 · 89 tok · 2.33s         │ │ "def calculate_attention(query, key, value, mask=None):..."  │ │
│  └───────────────────────────────────┘ └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2. Chrome Side Panel View

```
┌──────────────────────────────────────┐
│ ⚡ Universal llama.cpp    [⚙️] [↗] ● │
├──────────────────────────────────────┤
│ Unsloth (Port 8888)                  │
│ Qwen2.5-Coder-32B                    │
├──────────────────────────────────────┤
│ VRAM POOL: 25.69 / 28.67 GB (89%)    │
│ [████████████████████████████░░░░]   │
│ GPU 0: 11.48 GB (58°C · 142W)        │
│ GPU 1: 14.21 GB (52°C · 118W)        │
│ CPU: 18.4%   RAM: 28.2 / 64.0 GB     │
├──────────────────────────────────────┤
│ ACTIVE SLOTS (1 / 4)                 │
│ Slot 0 [Generating]  37.04 t/s       │
│ Prompt: 2,267 tok  | Gen: 55 tok     │
│ [████████░░░░░░░░░░░░░░░░░░░░░░░░]   │
├──────────────────────────────────────┤
│ RECENT AUDIT LOGS                    │
│ 15:41:02  req-86  completed  1.42s   │
│ 15:39:18  req-85  completed  5.81s   │
└──────────────────────────────────────┘
```

---

## Key Features

1. **Full-Browser Tab Replacement & Side Panel Modes:**
   - **Full Tab (`dashboard.html`)**: Rich workspace built on the Gainsty design system with light/dark theme switching (`tokens.css`).
   - **Side Panel (`sidepanel/monitor.html`)**: Compact MV3 sidebar for quick inspection while browsing or coding.
   - **1-Click Switching**: Click `↗` in the header anytime to expand the side panel into the full-browser tab.
2. **Multi-GPU Telemetry & Combined VRAM Pool:**
   - Queries all installed NVIDIA GPUs in real time using native `nvidia-smi` queries.
   - Computes both individual GPU cards (VRAM, temperature, power wattage, utilization %) and the aggregate VRAM pool across multi-GPU rigs.
3. **Host System Telemetry:**
   - Tracks CPU load % and System RAM using Chrome's native `chrome.system.cpu` and `chrome.system.memory` APIs.
4. **8-Fact Request Inspector & 2-Column Workspace:**
   - Full history table retaining past inference jobs across server idle cycles.
   - Instant search by request ID, endpoint path, or slot index.
   - Inspector panel breaking down Wall Clock, Queue Wait, Prefill Latency, Prompt Tokens, Output Tokens, Decode Speed, Prefill Speed, and Context Fill.
   - Tabbed payload view: Input prompt, Output completion, Chain-of-Thought reasoning, and Raw JSON.
5. **Seamless Unsloth Auto-Discovery:**
   - Dynamic port scanning and automated Bearer token extraction for Unsloth Studio backends.
   - Scans and loads newest log files without file locking.
6. **Zero External Dependencies in Browser:**
   - Pure vanilla JavaScript and modern CSS. No npm build steps, Webpack, or external CDNs required.

---

## Quick Start (Installation)

### Requirements

| Requirement | Needed for |
| :--- | :--- |
| Windows 10/11 | `install_host.bat` and the prebuilt `smi_bridge.exe` (.NET Framework 4) |
| Google Chrome | The extension itself (Manifest V3, side panel API) |
| NVIDIA driver | Per-GPU VRAM, temperature, power and utilization via `nvidia-smi` |
| A local inference server | `llama-server` (or an OpenAI-compatible backend) reachable on `127.0.0.1` |

Without an NVIDIA GPU the dashboard still renders host CPU, RAM and the request inspector; the GPU cards stay empty and the native bridge reports the missing `nvidia-smi`.

### Step 1: Clone Repository
```bash
git clone https://github.com/oh-codes/LLamaMonitor.git
cd LLamaMonitor
```

### Step 2: Register Native Host for GPU Telemetry (Windows)
The repository includes a compiled 64-bit native bridge (`host/smi_bridge.exe`) that communicates with `nvidia-smi`.

Run the automated installer:
```cmd
cd host
install_host.bat
```
*Note: This writes to `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.llama.smi_host`. It does **not** require Administrator privileges.*

### Step 3: Load Extension in Google Chrome
1. In Chrome, open `chrome://extensions/`.
2. Toggle **Developer mode** on (top-right switch).
3. Click **Load unpacked**.
4. Select the root folder of this repository (`LLamaMonitor`).
5. *(Optional for direct logfile reading)*: Click **Details** on the extension card, scroll down, and enable **"Allow access to file URLs"**.

### Step 4: Open Monitor
- Click the extension icon in your Chrome toolbar to launch the **Full-Browser Dashboard**.
- Or open Chrome's Side Panel and select **Universal llama.cpp**.

---

## Server Configuration & Recommended Flags

### 1. `llama.cpp` (`llama-server`)
Launch `llama-server` with `--metrics`, `--slots`, and `--props` to supply all telemetry endpoints:

```bash
llama-server.exe ^
  -m "path/to/model.gguf" ^
  --port 8080 ^
  --metrics ^
  --slots ^
  --props ^
  --log-file "server.jsonl" ^
  --log-jsonl ^
  --log-timestamps ^
  -ngl 99 ^
  -c 32768 ^
  -np 4
```

#### Multi-GPU Tensor & Layer Splitting:
```bash
# Example: Proportionally split across GPU 0 (12GB) and GPU 1 (16GB)
llama-server.exe ^
  -m "path/to/model.gguf" ^
  -ngl 99 ^
  --split-mode layer ^
  --tensor-split 12,16 ^
  --main-gpu 1 ^
  --metrics --slots
```

| Flag | Category | Purpose |
| :--- | :---: | :--- |
| **`--metrics`** | **Essential** | Enables Prometheus metrics at `GET /metrics` for generation velocities. |
| **`--slots`** | **Default on** | Exposes `GET /slots` for prompt length and progress. Only `--no-slots` switches it off. |
| **`--props`** | **Recommended** | Exposes model properties and max context size at `GET /props`. |
| **`--log-file <path>`** | **Audit** | Directs operational logs to disk for latency auditing. |
| **`--log-jsonl`** | **Audit** | Formats logs as JSON objects for line-by-line parsing. |
| **`--tensor-split <n,m>`** | **Multi-GPU** | Allocates VRAM proportions across graphics cards. |
| **`--split-mode <layer/row>`**| **Multi-GPU** | Assigns layers or matrix rows across GPUs. |

### 2. Unsloth Studio
Run Unsloth normally:
```bash
python -m unsloth --port 8888
```
In the extension's profile dropdown, select **Unsloth (Auto-Detect)**. The extension will automatically detect the backend inference port and authorization token.

---

## Security & Architecture

For in-depth security and architectural specifications:
* [ARCHITECTURE.md](./ARCHITECTURE.md): Complete component diagrams, sequence flows, and multi-port schema.
* [SECURITY_AUDIT.md](./SECURITY_AUDIT.md): Threat model covering command injection mitigation, 1MB protocol framing ceiling, and XSS sanitization.

### Security Highlights:
- **No Command Injection**: The native bridge enforces an immutable whitelist (`get_gpu`, `ping`, `read_log`, `detect_unsloth`) and never executes commands via a shell.
- **Deterministic ID Validation**: Native messaging manifest `allowed_origins` matches the extension's hardcoded public key to prevent unauthorized third-party extensions from connecting.
- **Strict Content Security Policy (CSP)**: Disallows inline scripts and `eval()`.
- **Local Isolation**: All telemetry queries stay strictly on `127.0.0.1` and `localhost`.

---

## Running Automated Tests

Run the included unit test suite:
```bash
python tests/test_host.py
```
(Or `python -m unittest discover -s tests`. The plain `python -m unittest tests/test_host.py` form fails on Python 3.12 because `tests/` is not a package.)

Tests validate:
- 32-bit little-endian binary message framing.
- 1MB DoS payload ceiling rejection.
- Action whitelisting enforcement.
- Multi-GPU CSV telemetry parsing.

---

## Repository Structure

```
LLamaMonitor/
├── manifest.json              # Chrome Manifest V3 configuration
├── tokens.css                 # Gainsty-grade design tokens (light & dark mode)
├── dashboard.html             # Full-browser 2-column dashboard layout
├── dashboard.css              # Full-browser dashboard styling
├── dashboard.js               # Full-browser telemetry & request inspector engine
├── ARCHITECTURE.md            # Architecture specification & sequence diagrams
├── SECURITY_AUDIT.md          # Security audit & threat model
├── README.md                  # Documentation & visual snapshots
├── .gitignore                 # Excludes local paths, logs, and artifacts
├── background/
│   └── service_worker.js      # Background extension lifecycle & tab routing
├── sidepanel/
│   ├── monitor.html           # Side panel compact HTML layout
│   ├── monitor.css            # Side panel styling
│   └── monitor.js             # Side panel controller
├── host/
│   ├── smi_host.cs            # C# Native Messaging Host source
│   ├── smi_bridge.exe         # Compiled 64-bit Windows Native Host binary
│   ├── smi_host.py            # Python reference Native Host
│   ├── install_host.bat       # 1-Click Windows registry installer
│   ├── run_host.bat           # Launcher script
│   └── com.llama.smi_host.json.example # Host manifest template
├── tests/
│   └── test_host.py           # Automated test suite
└── icons/                     # 16px, 48px, 128px extension icons
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
