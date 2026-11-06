param([switch]$Json)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$package = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
if (-not $package) { throw 'DESKTOP_NOT_FOUND: install and open Codex for this Windows user' }
$app = $package.InstallLocation
if ($env:DOTX_APP_PATH) { $app = $env:DOTX_APP_PATH }
$resources = Join-Path $app 'app\resources'
$nodePath = $env:CODEX_MCP_NODE_PATH
if (-not $nodePath) { $nodePath = Join-Path $resources 'cua_node\bin\node.exe' }
$cliPath = $env:CODEX_APP_RUNTIME_CLI_PATH
if (-not $cliPath) { $cliPath = Join-Path $resources 'codex.exe' }
$imagePath = Join-Path $app 'app\ChatGPT.exe'
foreach ($file in @($nodePath, $cliPath, $imagePath)) {
  if (-not [System.IO.Path]::IsPathRooted($file) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "DESKTOP_NOT_FOUND: registered desktop runtime missing: $file"
  }
}
$runtime = [ordered]@{ app = $app; node = $nodePath; cli = $cliPath; image = $imagePath; version = $package.Version.ToString() }
if ($Json) { $runtime | ConvertTo-Json -Compress } else { $runtime }
