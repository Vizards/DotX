export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<unknown>;
  list<T>(options: {
    prefix?: string;
    startAfter?: string;
    limit?: number;
  }): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(at: number): Promise<void>;
}
export interface AtomicStore extends Store {
  transaction<T>(callback: (txn: Store) => Promise<T>): Promise<T>;
}
