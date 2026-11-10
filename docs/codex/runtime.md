# Use the local Codex runtime

Use when installation, setup or diagnosis needs a local command. Need: access to the intended Codex desktop host and the selected Desktop package. Complete: the requested command returns a result from that installation; return to the guide that requested it.

## Check the host

DotX uses one Desktop package for macOS and native Windows. Run on the target computer in its Codex desktop environment. A cloud shell, WSL session or independently installed Codex CLI does not establish that desktop context. Native tools and computer-use capabilities depend on what this host actually exposes; inspect them through `device_status` and native discovery.

This release requires Node.js 24.12.0 or newer, supplied by the desktop host.

| Platform | Runtime source |
| --- | --- |
| macOS | The package's `launch` uses the desktop application's bundled Node. `DOTX_APP_PATH`, when supplied, selects that `.app`; otherwise the launcher checks the normal application directories |
| Windows | `launch.cmd` uses `CODEX_MCP_NODE_PATH`; native App Server calls use `CODEX_APP_RUNTIME_CLI_PATH`. Codex supplies these paths and its package/pipe context through normal host loading |

For plugin installation commands, use the desktop host's official CLI. On Windows, invoke the actual `CODEX_APP_RUNTIME_CLI_PATH` executable from the host's native shell. Do not guess WindowsApps/cache paths or install a separate Node/CLI to replace missing host context. If a Windows runtime path is absent, follow [runtime recovery](../troubleshooting/device.md#windows-runtime-and-powershell), then return here.

Windows also uses the system Windows PowerShell for private-directory permissions and registered desktop-package version metadata. No separate PowerShell installation is part of the normal flow. A policy or permission failure needs [the corresponding diagnosis](../troubleshooting/device.md#windows-runtime-and-powershell).

## Resolve this installation's paths

After normal plugin installation, call `device_status`. Use its exact `data_dir`; the plugin root is the parent of `docs_dir`. If the tool is absent, [recover plugin loading](../troubleshooting/plugin-loading.md) and return here. Keep the extracted marketplace in a persistent location, and keep the host-provided data directory across updates.

Use the same host's shell so its runtime context is retained. An unrelated terminal may lack that context. Replace every placeholder below with the observed path or target, and quote paths even when they currently contain no spaces.

## Run the requested command

Choose only the operation requested by the calling guide. `status` reads local configuration and the current owner. `connect` prepares or resumes this installation's connection and may submit an application; it is not a diagnostic read.

### macOS shell

```sh
"/ABSOLUTE/PLUGIN_ROOT/launch" --cli status --state "/EXACT/HOST_PLUGIN_DATA"
```

For [connection setup](connect.md):

```sh
"/ABSOLUTE/PLUGIN_ROOT/launch" --cli connect --state "/EXACT/HOST_PLUGIN_DATA" --url "HTTPS_ORIGIN" --name "ACTUAL_DEVICE_NAME"
```

### Windows PowerShell

```powershell
& 'C:\EXACT\PLUGIN_ROOT\launch.cmd' --cli status --state 'C:\EXACT\HOST_PLUGIN_DATA'
```

For [connection setup](connect.md):

```powershell
& 'C:\EXACT\PLUGIN_ROOT\launch.cmd' --cli connect --state 'C:\EXACT\HOST_PLUGIN_DATA' --url 'HTTPS_ORIGIN' --name 'ACTUAL_DEVICE_NAME'
```

Read the returned result or native error and return to the calling guide's completion check. A successful setup command alone does not prove approval or native interface readiness. For an older installed release without these launchers, use that release's own command reference.
