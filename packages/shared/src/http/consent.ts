export interface AgentAuthorizationRequest {
  transaction: string;
  created_at: number;
  expires_at: number;
  phase: 'waiting' | 'approved' | 'signing' | 'complete' | 'cancelled';
  client_name: string;
  client_domain: string | null;
  redirect_uri: string;
  redirect_is_loopback: boolean;
  agent_id: string | null;
}
export interface ConsentContext extends AgentAuthorizationRequest {
  service_name: string;
}
