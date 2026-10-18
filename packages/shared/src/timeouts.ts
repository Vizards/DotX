// Fallback for bounded waits without a suitable library default. This reuses the
// existing App Tools call budget; it is not a platform limit or a task deadline.
export const DEFAULT_TIMEOUT_MS = 30_000;
