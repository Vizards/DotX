import path from 'node:path';
export function checkedPath(value: string | undefined, code: string) {
  if (!value || !path.isAbsolute(value) || /\$\{[^}]+\}/.test(value)) throw new Error(code);
  return path.resolve(value);
}
export const dataDir = () => checkedPath(process.env.DOTX_PLUGIN_DATA, 'PLUGIN_DATA_REQUIRED');
export const pluginRoot = () => checkedPath(process.env.DOTX_PLUGIN_ROOT, 'PLUGIN_ROOT_REQUIRED');
export const cliDataDir = (value: string | undefined) =>
  checkedPath(value, 'EXPLICIT_PLUGIN_DATA_REQUIRED');
