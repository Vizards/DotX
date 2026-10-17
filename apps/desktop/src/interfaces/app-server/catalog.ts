import fs from 'node:fs';
import path from 'node:path';
import type { Method } from '../adapter.ts';
type Schema = Record<string, any>;
// Include only definitions reachable from a method. References keep their original names.
export function selfContained(root: Schema, body: Schema): Schema {
  const definitions: Schema = {};
  const scan = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string' && v.startsWith('#/definitions/')) {
        const n = v.slice(14);
        if (!(n in definitions) && root.definitions?.[n]) {
          definitions[n] = root.definitions[n];
          scan(definitions[n]);
        }
      } else scan(v);
    }
  };
  scan(body);
  return { ...body, ...(Object.keys(definitions).length ? { definitions } : {}) };
}
export function loadCatalog(dir: string): Method[] {
  // App Server has public protocol docs; this parser still depends on the CLI generator's
  // oneOf/definitions layout and Params -> Response file naming, including experimental APIs.
  const methods: Method[] = [];
  for (const [file, kind] of [
    ['ClientRequest', 'request'],
    ['ServerRequest', 'server_request'],
    ['ServerNotification', 'notification'],
  ] as const) {
    const root: Schema = JSON.parse(fs.readFileSync(path.join(dir, file + '.json'), 'utf8'));
    for (const variant of root.oneOf) {
      const name = variant.properties.method.enum[0];
      const ref = variant.properties.params ?? { type: 'object' };
      const type = ref.$ref?.split('/').at(-1);
      const schema = selfContained(root, type ? root.definitions[type] : ref);
      const base = type?.replace(/(?:Params|Notification)$/, 'Response');
      const responsePath = base ? findSchema(dir, base + '.json') : null;
      const output = responsePath ? JSON.parse(fs.readFileSync(responsePath, 'utf8')) : undefined;
      methods.push({
        name,
        kind,
        description: variant.description ?? schema.description,
        input_schema: schema,
        output_schema: output,
        managed: kind === 'request' && name === 'initialize',
      });
    }
  }
  return methods;
}
function findSchema(dir: string, name: string): string | null {
  for (const folder of [dir, path.join(dir, 'v2'), path.join(dir, 'v1')]) {
    const p = path.join(folder, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
