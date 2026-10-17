import type { Env } from './env.ts';
import { hub, registered } from './hub/namespace.ts';
import { bearer, matches } from './auth/credentials.ts';
import { serveOAuth } from './auth/oauth.ts';

export { DeviceHub } from './hub/device-hub.ts';

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.origin !== env.PUBLIC_ORIGIN) return json({ error: 'ORIGIN_NOT_CONFIGURED' }, 421);
    if (url.pathname === '/setup' || url.pathname.startsWith('/setup/'))
      return hub(env).fetch(request);
    if (url.pathname === '/device/connect') {
      const id = request.headers.get('X-Device-Id'),
        device = (await registered(env)).find((d) => d.id === id);
      if (!device || !(await matches(bearer(request), device.tokenHash)))
        return json({ error: 'UNAUTHORIZED_DEVICE' }, 401);
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
        return json({ error: 'WEBSOCKET_REQUIRED' }, 426);
      return hub(env).fetch(new Request('https://hub/connect', request));
    }
    if (url.pathname === '/mcp') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== env.PUBLIC_ORIGIN) return json({ error: 'BAD_ORIGIN' }, 403);
    }
    return serveOAuth(request, env, ctx);
  },
};
