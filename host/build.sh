#!/usr/bin/env sh
# Builds the native messaging host.
#   ./build.sh        host OS -> host/smi_bridge (smi_bridge.exe on Windows)
#   ./build.sh --all  every target -> host/dist/
set -eu
cd "$(dirname "$0")"

LDFLAGS="-s -w"

build() {
  goos="$1"
  goarch="$2"
  out="$3"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags "$LDFLAGS" -o "$out" .
  echo "built $out"
}

if [ "${1:-}" = "--all" ]; then
  mkdir -p dist
  # The windowed subsystem keeps Chrome from flashing a console window.
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
    go build -trimpath -ldflags "$LDFLAGS -H=windowsgui" -o dist/smi_bridge.exe .
  echo "built dist/smi_bridge.exe"
  build linux amd64 dist/smi_bridge-linux-amd64
  build linux arm64 dist/smi_bridge-linux-arm64
  build darwin amd64 dist/smi_bridge-darwin-amd64
  build darwin arm64 dist/smi_bridge-darwin-arm64
  exit 0
fi

case "$(go env GOOS)" in
  windows)
    CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS -H=windowsgui" -o smi_bridge.exe .
    echo "built smi_bridge.exe"
    ;;
  *)
    CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" -o smi_bridge .
    echo "built smi_bridge"
    ;;
esac
