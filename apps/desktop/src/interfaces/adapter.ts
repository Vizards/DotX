import type { InterfaceStatus, NativeResponse, NativeEvent } from '@dotx/shared/gateway';
export interface Method {
  name: string;
  description?: string;
  input_schema: unknown;
  output_schema?: unknown;
  kind: 'request' | 'server_request' | 'notification';
  managed?: boolean;
  tracking?: string[];
}
export interface Adapter {
  status(): InterfaceStatus;
  methods(): Promise<Method[]>;
  call(method: string, params: Record<string, unknown>): Promise<NativeResponse>;
  prepareResponse?(event: NativeEvent, response: NativeResponse): Promise<void>;
  respond?(
    event: NativeEvent,
    response: NativeResponse,
  ): void | Promise<void | {
    status: NativeEvent['response_status'];
  }>;
  decorateEvent?(event: NativeEvent): NativeEvent;
  close(): void;
}
