// Preserve only native Windows package context, never the caller's thread,
// App Tools pipe, credentials or inherited per-turn Codex configuration.
const windowsContext = new Set([
  'CODEX_WINDOWS_REGISTERED_CORE',
  'CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY',
]);
export function appServerEnvironment(home?: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith('CODEX_') || (process.platform === 'win32' && windowsContext.has(key)),
    ),
  );
  if (home) env.CODEX_HOME = home;
  return env;
}
