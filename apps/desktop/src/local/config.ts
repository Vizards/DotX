import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { serviceInfoSchema } from '@dotx/shared/http/service';
import { readJson } from './files.ts';
export const configSchema = z.strictObject({
  deviceId: z.uuid(),
  label: z.string(),
  keyId: z.string(),
  operationId: z.uuid(),
  service: serviceInfoSchema,
  callerThreadId: z.string().optional(),
  callerArchived: z.boolean().optional(),
  callerCreationPending: z.boolean().optional(), // Accept older development state; ignored by setup.
  codexHome: z.string().optional(),
});
export type DeviceConfig = z.infer<typeof configSchema>;
export type ReadyConfig = DeviceConfig & {
  callerThreadId: string;
  codexHome: string;
  callerArchived: boolean;
};
export function readConfig(dir: string) {
  const file = path.join(dir, 'config.json');
  return fs.existsSync(file) ? configSchema.parse(readJson(file)) : null;
}
export function validateConfig(config: DeviceConfig): asserts config is ReadyConfig {
  configSchema.parse(config);
  if (!config.callerThreadId || !config.codexHome) throw new Error('DEVICE_SETUP_INCOMPLETE');
}
