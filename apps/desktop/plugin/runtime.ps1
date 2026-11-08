param([switch]$Json)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$app = $env:DOTX_APP_PATH
if (-not $app) {
  $package = Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1
  if (-not $package) { throw 'DESKTOP_NOT_FOUND: install and open Codex, or set DOTX_APP_PATH to its MSIX directory' }
  $app = $package.InstallLocation
}
$resources = Join-Path $app 'app\resources'
$nodePath = $env:CODEX_MCP_NODE_PATH
if (-not $nodePath) { $nodePath = Join-Path $resources 'cua_node\bin\node.exe' }
$cliPath = $env:CODEX_APP_RUNTIME_CLI_PATH
if (-not $cliPath) { $cliPath = Join-Path $resources 'codex.exe' }
foreach ($file in @($nodePath, $cliPath)) {
  if (-not [System.IO.Path]::IsPathRooted($file) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
    throw "DESKTOP_NOT_FOUND: selected desktop runtime missing: $file"
  }
}
$version = 'unknown'
$manifest = Join-Path $app 'AppxManifest.xml'
if (Test-Path -LiteralPath $manifest -PathType Leaf) {
  try {
    $selectedVersion = ([xml][System.IO.File]::ReadAllText($manifest)).Package.Identity.Version
    if ($selectedVersion) { $version = $selectedVersion }
  } catch {}
}
$runtime = [ordered]@{ app = $app; node = $nodePath; cli = $cliPath; version = $version }
if ($Json) { $runtime | ConvertTo-Json -Compress } else { $runtime }
