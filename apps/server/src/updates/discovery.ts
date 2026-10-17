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
export type ReleaseChannel = 'stable' | 'dev';
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
  private readonly fetcher: typeof fetch;
  constructor(
    store: Store,
    repository = '',
    channel: ReleaseChannel = 'stable',
    // Workers' native fetch rejects a class instance as its receiver.
    fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.store = store;
    this.repository = repository;
    this.channel = channel;
    this.fetcher = fetcher;
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
      const signal = AbortSignal.timeout(3000);
      const read = async (suffix: string) => {
        const response = await this.fetcher(
          `https://api.github.com/repos/${this.repository}/releases${suffix}`,
          {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DotX' },
            signal,
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
        // GitHub's latest endpoint excludes previews. Compare dev versions numerically,
        // across pages, rather than relying on publication order or tag string order.
        for (let page = 1; ; page++) {
          const releases = z.array(releaseSchema).parse(await read(`?per_page=100&page=${page}`));
          for (const release of releases) {
            const version = valid(release.tag_name);
            if (
              !release.draft &&
              release.prerelease &&
              version &&
              prerelease(version)?.[0] === 'dev' &&
              (!selected || gt(version, selected.tag_name))
            )
              selected = release;
          }
          if (releases.length < 100) break;
        }
      }
      next.latest = selected
        ? {
            version: valid(selected.tag_name)!,
            url: `https://github.com/${this.repository}/releases/tag/${encodeURIComponent(selected.tag_name)}`,
            update_skill_url: `https://github.com/${this.repository}/releases/download/${encodeURIComponent(selected.tag_name)}/update-SKILL.md`,
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
