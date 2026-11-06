param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ConnectorArgs)
$ErrorActionPreference = 'Stop'
$runtime = & (Join-Path $PSScriptRoot 'runtime.ps1')
$env:DOTX_DESKTOP_RUNTIME = $runtime | ConvertTo-Json -Compress
$env:DOTX_PLUGIN_ROOT = $PSScriptRoot
$entry = 'connector.mjs'
if ($ConnectorArgs.Count -gt 0 -and $ConnectorArgs[0] -eq '--cli') {
  $entry = 'cli.mjs'
  $ConnectorArgs = @($ConnectorArgs | Select-Object -Skip 1)
}
& $runtime.node (Join-Path $PSScriptRoot $entry) @ConnectorArgs
exit $LASTEXITCODE
