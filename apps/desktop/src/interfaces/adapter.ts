import type { Call, InterfaceStatus, NativeResponse, NativeEvent } from '@dotx/shared/gateway';
export interface Method {
  name: string;
  description?: string;
  annotations?: unknown;
  input_schema: unknown;
  output_schema?: unknown;
  kind: 'request' | 'server_request' | 'notification';
  managed?: boolean;
  tracking?: string[];
}
export interface Adapter {
  status(): InterfaceStatus;
  methods(): Promise<Method[]>;
  call(method: string, params: Call['params']): Promise<NativeResponse>;
  prepareResponse?(event: NativeEvent, response: NativeResponse): Promise<void>;
  respond?(
    event: NativeEvent,
    response: NativeResponse,
  ): void | Promise<void | {
    status: NativeEvent['response_status'];
    diagnostic?: unknown;
  }>;
  decorateEvent?(event: NativeEvent): NativeEvent;
  close(): void;
}
