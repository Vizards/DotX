import type { AtomicStore, Store } from '../../src/hub/storage.ts';
export class MemoryStore implements AtomicStore {
  readonly data = new Map<string, unknown>();
  queue = Promise.resolve();
  alarm: number | null = null;
  async list<T>({
    prefix = '',
    startAfter = '',
    limit = Infinity,
  }: {
    prefix?: string;
    startAfter?: string;
    limit?: number;
  }) {
    return new Map(
      [...this.data.entries()]
        .filter(([k]) => k.startsWith(prefix) && k > startAfter)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, limit)
        .map(([k, v]) => [k, structuredClone(v) as T]),
    );
  }
  async delete(key: string) {
    return this.data.delete(key);
  }
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(at: number) {
    this.alarm = at;
  }
  async get<T>(key: string) {
    return structuredClone(this.data.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    this.data.set(key, structuredClone(value));
  }
  async transaction<T>(callback: (tx: Store) => Promise<T>): Promise<T> {
    const before = this.queue;
    let unlock!: () => void;
    this.queue = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await before;
    const snapshot = structuredClone(this.data);
    try {
      return await callback(this);
    } catch (error) {
      this.data.clear();
      for (const [k, v] of snapshot) this.data.set(k, v);
      throw error;
    } finally {
      unlock();
    }
  }
}
