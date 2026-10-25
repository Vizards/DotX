import { DEFAULT_TIMEOUT_MS } from '@dotx/shared/timeouts';
import { gt, prerelease, valid } from 'semver';
import { z } from 'zod';
import type { Store } from '../hub/storage.ts';

const interval = 6 * 60 * 60_000;
const failureInterval = 5 * 60_000;
const releaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
});
export type ReleaseChannel = string;
interface LatestRelease {
  version: string;
  url: string;
}
interface CachedRelease {
  attempted_at: number;
  checked_at: number | null;
  latest: LatestRelease | null;
  diagnostic?: string;
}
export interface ReleaseDiscovery extends CachedRelease {
  channel: ReleaseChannel;
  status: 'ok' | 'unavailable' | 'not_configured';
  cached: boolean;
}

// One low-frequency lookup per service. No polling timer or component upgrade planner.
export class ReleaseUpdates {
  private pending?: Promise<ReleaseDiscovery>;
  private readonly store: Store;
  private readonly repository: string;
  private readonly channel: ReleaseChannel;
  constructor(store: Store, repository = '', channel: ReleaseChannel = 'stable') {
    this.store = store;
    this.repository = repository;
    this.channel = channel;
  }
  async read(): Promise<ReleaseDiscovery> {
    if (!this.repository)
      return {
        channel: this.channel,
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
    const key = `updates:${this.repository}:${this.channel}`;
    const previous = await this.store.get<CachedRelease>(key);
    if (
      previous &&
      Date.now() - previous.attempted_at < (previous.diagnostic ? failureInterval : interval)
    )
      return {
        ...previous,
        channel: this.channel,
        status: previous.diagnostic ? 'unavailable' : 'ok',
        cached: true,
      };
    const next: CachedRelease = {
      attempted_at: Date.now(),
      checked_at: previous?.checked_at ?? null,
      latest: previous?.latest ?? null,
    };
    try {
      const read = async (suffix: string) => {
        const response = await fetch(
          `https://api.github.com/repos/${this.repository}/releases${suffix}`,
          {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DotX' },
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
          },
        );
        if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
        return response.json();
      };
      let selected: z.infer<typeof releaseSchema> | undefined;
      if (this.channel === 'stable') {
        selected = releaseSchema.parse(await read('/latest'));
        const version = valid(selected.tag_name);
        if (selected.draft || selected.prerelease || !version || prerelease(version))
          throw new Error('INVALID_RELEASE_VERSION');
      } else {
        // Every preview channel uses the first SemVer prerelease identifier.
        // GitHub's list order is not SemVer order; compare matching versions.
        const releases = z.array(releaseSchema).parse(await read('?per_page=100&page=1'));
        for (const release of releases) {
          const version = valid(release.tag_name);
          if (
            !release.draft &&
            release.prerelease &&
            version &&
            prerelease(version)?.[0]?.toString() === this.channel &&
            (!selected || gt(version, valid(selected.tag_name)!))
          )
            selected = release;
        }
      }
      next.latest = selected
        ? {
            version: valid(selected.tag_name)!,
            url: `https://github.com/${this.repository}/releases/tag/${encodeURIComponent(selected.tag_name)}`,
          }
        : null;
      next.checked_at = next.attempted_at;
    } catch (error) {
      next.diagnostic =
        error instanceof Error && /^GITHUB_HTTP_\d+$/.test(error.message)
          ? error.message
          : 'RELEASE_LOOKUP_FAILED';
    }
    await this.store.put(key, next);
    return {
      ...next,
      channel: this.channel,
      status: next.diagnostic ? 'unavailable' : 'ok',
      cached: false,
    };
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
