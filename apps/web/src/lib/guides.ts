export const repoUrl = 'https://github.com/Vizards/DotX';

/** The release page for the version this Server is running. */
export function releaseUrl(version: string): string {
  return `${repoUrl}/releases/tag/v${version}`;
}

/** Documentation links always point at the running release tag. */
export function guideUrl(path: string, version: string): string {
  return `${repoUrl}/blob/v${version}/docs/${path}`;
}
