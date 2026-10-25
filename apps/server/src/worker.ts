import type { Env } from './env.ts';
import { deviceRoute } from './devices/routes.ts';
import { serveOAuth } from './oauth/provider.ts';
import { HttpError, failure } from './http/responses.ts';
export { DeviceHub } from './hub/device-hub.ts';
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    try {
      const url = new URL(request.url);
      if (url.origin !== env.PUBLIC_ORIGIN) throw new HttpError(421, 'ORIGIN_NOT_CONFIGURED');
      if (url.pathname === '/device/connect' || url.pathname === '/setup/enroll')
        return await deviceRoute(request, env);
      if (url.pathname.startsWith('/internal/')) throw new HttpError(404, 'NOT_FOUND');
      if (url.pathname === '/mcp') {
        const origin = request.headers.get('Origin');
        if (origin && origin !== env.PUBLIC_ORIGIN) throw new HttpError(403, 'BAD_ORIGIN');
      }
      return await serveOAuth(request, env, ctx);
    } catch (error) {
      return failure(error);
    }
  },
};
