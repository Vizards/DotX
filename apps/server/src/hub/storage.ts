export interface Store {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<unknown>;
}
export interface AtomicStore extends Store {
  transaction<T>(callback: (txn: Store) => Promise<T>): Promise<T>;
}
