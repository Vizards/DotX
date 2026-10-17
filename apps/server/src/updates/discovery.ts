import { gt, valid } from 'semver';
import { z } from 'zod';
import type { Store } from '../hub/storage.ts';

const interval = 6 * 60 * 60_000;
const releaseSchema = z.object({
  tag_name: z.string(),
  draft: z.literal(false),
  prerelease: z.literal(false),
});
interface LatestRelease {
  version: string;
  url: string;
  update_skill_url: string;
}
interface CachedRelease {
  attempted_at: number;
  checked_at: number | null;
  latest: LatestRelease | null;
  diagnostic?: string;
}
export interface ReleaseDiscovery extends CachedRelease {
  status: 'ok' | 'unavailable' | 'not_configured';
  cached: boolean;
}

// One low-frequency lookup per service. No polling timer or component upgrade planner.
export class ReleaseUpdates {
  private pending?: Promise<ReleaseDiscovery>;
  private readonly store: Store;
  private readonly repository: string;
  private readonly fetcher: typeof fetch;
  constructor(store: Store, repository = '', fetcher: typeof fetch = fetch) {
    this.store = store;
    this.repository = repository;
    this.fetcher = fetcher;
  }
  async read(): Promise<ReleaseDiscovery> {
    if (!this.repository)
      return {
        status: 'not_configured',
        cached: false,
        attempted_at: 0,
        checked_at: null,
        latest: null,
      };
    if (this.pending) return this.pending;
    this.pending = this.lookup().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async lookup(): Promise<ReleaseDiscovery> {
    const key = `updates:${this.repository}`;
    const previous = await this.store.get<CachedRelease>(key);
    if (previous && Date.now() - previous.attempted_at < interval)
      return { ...previous, status: previous.diagnostic ? 'unavailable' : 'ok', cached: true };
    const next: CachedRelease = {
      attempted_at: Date.now(),
      checked_at: previous?.checked_at ?? null,
      latest: previous?.latest ?? null,
    };
    try {
      const response = await this.fetcher(
        `https://api.github.com/repos/${this.repository}/releases/latest`,
        {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DotX' },
          signal: AbortSignal.timeout(3000),
        },
      );
      if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
      const release = releaseSchema.parse(await response.json());
      const version = valid(release.tag_name);
      if (!version || version.includes('-')) throw new Error('INVALID_RELEASE_VERSION');
      next.latest = {
        version,
        url: `https://github.com/${this.repository}/releases/tag/${encodeURIComponent(release.tag_name)}`,
        update_skill_url: `https://github.com/${this.repository}/releases/download/${encodeURIComponent(release.tag_name)}/update-SKILL.md`,
      };
      next.checked_at = next.attempted_at;
    } catch (error) {
      next.diagnostic =
        error instanceof Error && /^GITHUB_HTTP_\d+$/.test(error.message)
          ? error.message
          : 'RELEASE_LOOKUP_FAILED';
    }
    await this.store.put(key, next);
    return { ...next, status: next.diagnostic ? 'unavailable' : 'ok', cached: false };
  }
}

export function updateAvailable(
  discovery: ReleaseDiscovery,
  current: string | null,
): boolean | null {
  if (!discovery.latest || !current || !valid(current)) return null;
  const newer = gt(discovery.latest.version, current);
  // Stale evidence may still prove a newer version exists, never that an installation is current.
  return newer || discovery.status === 'ok' ? newer : null;
}
