#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
go_bin="${GO_BIN:-go}"
target_os="$("$go_bin" env GOOS)"
target_arch="$("$go_bin" env GOARCH)"
case "$target_os" in
  linux|freebsd) extension=so ;;
  darwin) extension=dylib ;;
  windows) extension=dll ;;
  *) echo "Unsupported OS: $target_os" >&2; exit 1 ;;
esac
output="dist/$target_os/$target_arch/antigravity-verify.$extension"
mkdir -p -- "$(dirname -- "$output")"
CGO_ENABLED=1 "$go_bin" build -buildvcs=false -trimpath -buildmode=c-shared -ldflags='-s -w' -o "$output" .
rm -f -- "${output%.*}.h"
echo "$output"
