@echo off
setlocal
set "DIR=%~dp0"
if exist "%DIR%smi_bridge.exe" (
    "%DIR%smi_bridge.exe"
) else (
    echo smi_bridge.exe not found. Run build.sh or install_host.bat first. 1>&2
    exit /b 1
)
