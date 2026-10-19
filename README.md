# Universal llama.cpp Monitor

A Chrome extension that shows live telemetry for llama.cpp-based engines - `llama-server`,
Unsloth Studio, and llama.cpp forks. Two views: a full-tab dashboard and a side panel.

GPU telemetry is **NVIDIA-only** (read via `nvidia-smi`); host CPU/RAM, slots, context fill,
speed, and the request inspector work against any llama.cpp-compatible server.

## What it shows

- **GPU hardware** - per-GPU VRAM, temperature, power, utilization, and the combined VRAM pool.
- **Host** - CPU load and system RAM.
- **Slots & context** - active slots and context-window fill (`33.4k / 84k · 39.8%`).
- **Speed** - decode and prefill tokens/s from the server's `/metrics`.
- **Request inspector** - per-request wall clock, prefill/generation timing, and token counts.

## Install

1. Register the native host (Windows; no admin required):
   ```cmd
   cd host
   install_host.bat
   ```
   The host wraps `nvidia-smi` and the server log. A prebuilt `smi_bridge.exe` ships with the
   repo; rebuild it with `sh build.sh` (or `sh build.sh --all` for Windows/Linux/macOS).
2. In Chrome: `chrome://extensions` -> enable **Developer mode** -> **Load unpacked** -> this folder.
3. Optional: enable **Allow access to file URLs** on the extension card for log reading.

## Server settings

Only two flags matter:

| Flag | Purpose |
| :--- | :--- |
| `--metrics` | exposes `/metrics` so the speed gauges populate |
| `--log-file <path>` | enables the per-request inspector (plain-text log; do **not** use `--log-jsonl`) |

`/slots` and `/v1/models` are on by default, so model name and context fill need no flag.
Unsloth Studio needs none of these - it writes its log automatically and the monitor
auto-detects the port and API key.

## License

MIT. See [LICENSE](LICENSE).
