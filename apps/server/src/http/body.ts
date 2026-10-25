import { HttpError } from './responses.ts';

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'INVALID_JSON');
  }
}
