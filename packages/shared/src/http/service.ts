import { z } from 'zod';

// Service discovery identifies the HTTPS service, independent of either plugin's installation ID.
export const serviceInfoSchema = z.strictObject({
  product: z.literal('dotx'),
  service_id: z.uuid(),
  version: z.string().min(1),
  wire_protocol: z.number().int().positive(),
  guides_url: z.url(),
  mcp_url: z.url(),
  origin: z.url().refine((input) => {
    const url = new URL(input);
    return url.protocol === 'https:' && input === url.origin;
  }, 'EXPECTED_HTTPS_ORIGIN'),
});
export type ServiceInfo = z.infer<typeof serviceInfoSchema>;
