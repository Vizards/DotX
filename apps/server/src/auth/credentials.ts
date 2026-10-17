export async function sha256(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export const bearer = (req: Request) =>
  req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
export async function matches(value: unknown, hash: string | undefined) {
  return typeof value === 'string' && !!hash && (await sha256(value)) === hash;
}
