$ErrorActionPreference = 'Stop'
$pluginRoot = $args[0]

function Find-Node {
  if ($env:DOTX_APP_PATH) {
    foreach ($relative in @('resources\cua_node\bin\node.exe', 'app\resources\cua_node\bin\node.exe')) {
      $candidate = Join-Path $env:DOTX_APP_PATH $relative
      if (Test-Path $candidate) { return $candidate }
    }
  }
  # Per-user runtime provisioned by the desktop app; always readable.
  $perUser = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes\cua_node\*\bin\node.exe') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($perUser) { return $perUser.FullName }
  # Packaged install under WindowsApps (listing it can be ACL-restricted).
  $packaged = Get-ChildItem -Path (Join-Path $env:ProgramFiles 'WindowsApps\OpenAI.Codex_*\app\resources\cua_node\bin\node.exe') -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($packaged) { return $packaged.FullName }
  $onPath = Get-Command node -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  return $null
}

$node = Find-Node
if (-not $node) {
  [Console]::Error.WriteLine('DOTX_DESKTOP_NOT_FOUND: install the Codex desktop application')
  exit 1
}
& $node (Join-Path $pluginRoot 'connector.mjs')
exit $LASTEXITCODE
