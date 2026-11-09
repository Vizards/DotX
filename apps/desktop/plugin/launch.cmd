@echo off
setlocal
if not defined CODEX_MCP_NODE_PATH (
  echo CODEX_MCP_NODE_PATH_REQUIRED: run from Codex or set its bundled Node path. >&2
  exit /b 1
)
"%CODEX_MCP_NODE_PATH%" "%~dp0launch.mjs" %*
exit /b %errorlevel%
