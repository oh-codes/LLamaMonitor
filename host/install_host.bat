@echo off
setlocal
set "HOST_DIR=%~dp0"
set "JSON_PATH=%HOST_DIR%com.llama.smi_host.json"
set "EXE_PATH=%HOST_DIR%smi_bridge.exe"
set "DEFAULT_ID=mogoecckabfchcngfnfgebnhdfmgafpd"

if not "%~1"=="" (
    if not "%~1"=="non-interactive" (
        set "EXT_ID=%~1"
    ) else (
        set "EXT_ID=%DEFAULT_ID%"
    )
) else (
    set "EXT_ID=%DEFAULT_ID%"
)

echo Registering Native Messaging Host for Google Chrome...
echo Extension ID: %EXT_ID%

REM Build the host with Go only when the prebuilt binary is missing
if not exist "%EXE_PATH%" (
    echo Building native smi_bridge.exe with Go...
    pushd "%HOST_DIR%"
    go build -trimpath -ldflags "-s -w -H=windowsgui" -o "%EXE_PATH%" .
    if errorlevel 1 (
        popd
        echo [ERROR] smi_bridge.exe missing and the Go build failed. Install Go 1.21+ or restore the prebuilt binary.
        exit /b 1
    )
    popd
)

REM Generate dynamic JSON pointing directly to smi_bridge.exe
powershell -NoProfile -Command ^
  "$json = @{ name = 'com.llama.smi_host'; description = 'Universal llama.cpp Monitor SMI Bridge'; path = (Resolve-Path '%EXE_PATH%').Path; type = 'stdio'; allowed_origins = @('chrome-extension://' + '%EXT_ID%' + '/') };" ^
  "$json | ConvertTo-Json | Set-Content -Path '%JSON_PATH%' -Encoding UTF8"

REM Register in HKCU for Google Chrome
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.llama.smi_host" /ve /t REG_SZ /d "%JSON_PATH%" /f >nul
if %errorlevel% equ 0 (
    echo [SUCCESS] Host successfully registered in Chrome registry!
    echo Key: HKCU\Software\Google\Chrome\NativeMessagingHosts\com.llama.smi_host
    echo Executable: %EXE_PATH%
    echo Manifest: %JSON_PATH%
) else (
    echo [ERROR] Failed to write registry key.
    exit /b 1
)

echo Done.
if "%~1"=="" pause
