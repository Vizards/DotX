#!/bin/sh
set -eu
if [ -n "${DOTX_APP_PATH:-}" ]; then
  exec "$DOTX_APP_PATH/Contents/Resources/cua_node/bin/node" "$1/connector.mjs"
fi
for directory in /Applications "$HOME/Applications"; do
  for application in "$directory"/ChatGPT*.app "$directory"/Codex*.app; do
    runtime="$application/Contents/Resources/cua_node/bin/node"
    if [ -x "$runtime" ]; then
      export DOTX_APP_PATH="$application"
      exec "$runtime" "$1/connector.mjs"
    fi
  done
done
echo 'DOTX_DESKTOP_NOT_FOUND: install the Codex desktop application' >&2
exit 1
