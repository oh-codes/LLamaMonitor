# Adversarial Security Audit & Threat Model

## 1. Scope & Objectives
This audit assesses the security boundaries of the **Local LLM Monitor Chrome Extension** and its companion **Native Messaging Host**. Because Native Messaging and `file:///*` permissions grant the browser elevated privileges, strict controls are mandated to prevent privilege escalation, code injection, and local file exposure.

---

## 2. Threat Analysis & Countermeasures

### Threat 1: Native Messaging Command Injection
* **Risk:** High (if unmitigated). A compromised browser tab, malicious third-party extension, or XSS flaw could attempt to send arbitrary shell commands to the native host executable.
* **Attack Vector:** An attacker sends `{ "action": "exec", "cmd": "calc.exe" }` or attempts shell metacharacter injection (e.g., `get_gpu && rm -rf /`).
* **Countermeasures:**
  1. **Strict Action Whitelisting:** The native host rejects any action other than explicitly permitted constants:
     - `get_gpu`
     - `ping`
  2. **No Shell Execution:** Subprocess calls **never** use `shell=True`. Arguments are passed as an immutable list:
     ```python
     # SECURE: Array arguments, no shell interpretation
     subprocess.check_output(["nvidia-smi", "--query-gpu=...", ...], shell=False)
     ```
  3. **Origin Validation:** The native messaging manifest specifies `allowed_origins` containing **only** the unique Chrome Extension ID. Untrusted extensions are denied connection by Chrome's broker.

---

### Threat 2: Protocol Framing & DoS (Buffer Overflow / Hangs)
* **Risk:** Medium. Malformed or oversized length headers could crash the Python bridge or cause high memory allocation.
* **Countermeasures:**
  1. Chrome specifies a 1MB maximum message size limit for native messaging.
  2. The host enforces a 1MB payload ceiling:
     ```python
     MAX_PAYLOAD_BYTES = 1024 * 1024  # 1MB
     if msg_len > MAX_PAYLOAD_BYTES:
         raise ValueError(f"Payload size {msg_len} exceeds 1MB limit")
     ```
  3. Explicit stream timeout and graceful `EOF` handling when Chrome closes the connection.

---

### Threat 3: Stored XSS via LLM Prompts & Responses
* **Risk:** High. An LLM prompt or output retrieved from `/slots` or the log file may contain malicious HTML/JavaScript payloads (e.g., `<script src="evil.js">`, `<img src=x onerror=alert(1)>`).
* **Countermeasures:**
  1. **No Unsanitized `innerHTML`:** All text fields, prompts, model responses, and error messages are rendered exclusively using `element.textContent = data` or strict sanitization routines.
  2. **Content Security Policy (CSP):** The extension enforces Manifest V3's strict CSP:
     - `script-src 'self'`: Disallows inline scripts, `eval()`, and external scripts.
     - `object-src 'none'`: Prevents embedding Flash, Java, or arbitrary plugins.

---

### Threat 4: Local File Access & Path Traversal
* **Risk:** Medium. `host_permissions: ["file:///*"]` permits reading files on disk.
* **Countermeasures:**
  1. The user must explicitly toggle **"Allow access to file URLs"** in `chrome://extensions`.
  2. In the profile settings, the log path input is validated to ensure it targets `.jsonl`, `.log`, or `.txt` log files.
  3. No file-writing capability is exposed through `file:///` URLs (browser sandbox prevents arbitrary writing).

---

## 3. Audit Verification Checklist

| Security Requirement | Status | Verification Method |
| :--- | :---: | :--- |
| No shell invocation in the host | PASS | Code audit of `host/main.go`: `exec.Command` with a fixed argument list, no shell |
| Command whitelist validation | PASS | `host/main_test.go` and `tests/test_host.py` with adversarial payloads |
| Message size ceiling (1MB) | PASS | `maxPayloadBytes` check in `host/main.go`, tested with an oversized header |
| Zero unescaped `innerHTML` | PASS | Code audit of `sidepanel/monitor.js` |
| MV3 CSP compliance | PASS | Validated in `manifest.json` |
