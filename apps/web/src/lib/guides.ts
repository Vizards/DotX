import { version as buildVersion } from '../../package.json';

export const repoUrl = 'https://github.com/Vizards/DotX';

/** The release page for the version this Server is running. */
export function releaseUrl(version: string): string {
  return `${repoUrl}/releases/tag/v${version}`;
}

/** Release builds inject the same version into Web and Server, including before login. */
export function guideUrl(path: string, version = buildVersion): string {
  return `${repoUrl}/blob/v${version}/docs/${path}`;
}
