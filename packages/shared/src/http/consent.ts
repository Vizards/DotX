export interface ConsentContext {
  transaction: string;
  expires_at: number;
  service_name: string;
  client_name: string;
  client_domain: string | null;
  redirect_uri: string;
  redirect_is_loopback: boolean;
  sharing: string;
  error: { code: string; message: string } | null;
}
