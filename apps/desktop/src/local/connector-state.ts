import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './files.ts';
// Caller holds connector.lock throughout this write and all subsequent network activity.
export function nextGeneration(dir: string) {
  const file = path.join(dir, 'connector-state.json');
  let generation = 0;
  if (fs.existsSync(file)) {
    const state = readJson<{ generation: number }>(file);
    if (
      !Number.isSafeInteger(state.generation) ||
      state.generation < 1 ||
      state.generation >= Number.MAX_SAFE_INTEGER
    )
      throw new Error('CONNECTOR_STATE_INVALID');
    generation = state.generation;
  }
  generation++;
  writeJson(file, { generation });
  return generation;
}
