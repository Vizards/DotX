import { createRequire } from 'node:module';
import path from 'node:path';
import { BridgeError } from '@dotx/shared/errors';

// Loaded only on Windows. Koffi's Node-API binary is shipped in the Desktop ZIP;
// neither a compiler nor a separate Node installation is needed on the host.
let instance: ReturnType<typeof createApi> | undefined;
export const win32 = () => (instance ??= createApi());
export type Handle = bigint;
export const INVALID_HANDLE = 0xffffffffffffffffn;

function createApi() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new BridgeError('UNSUPPORTED_PLATFORM', 'Desktop supports macOS and Windows x64');
  const ffi: typeof import('koffi') = createRequire(import.meta.url)('koffi');
  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const kernel = ffi.load(path.join(system, 'kernel32.dll'));
  const security = ffi.load(path.join(system, 'advapi32.dll'));
  const k = (signature: string) => kernel.func(signature);
  const a = (signature: string) => security.func(signature);
  const sa = ffi.struct({ length: 'uint32', descriptor: 'void *', inherit: 'int' });
  const api = {
    ffi,
    sa,
    lastError: k('uint32 GetLastError()'),
    close: k('int CloseHandle(void *handle)'),
    localFree: k('void *LocalFree(void *memory)'),
    createFile: k(
      'void *CreateFileW(str16 name, uint32 access, uint32 share, void *security, uint32 disposition, uint32 flags, void *templateFile)',
    ),
    attributes: k(
      'int GetFileInformationByHandleEx(void *handle, int kind, void *info, uint32 size)',
    ),
    moveFile: k('int MoveFileExW(str16 from, str16 to, uint32 flags)'),
    lock: k(
      'int LockFileEx(void *handle, uint32 flags, uint32 reserved, uint32 low, uint32 high, void *overlapped)',
    ),
    unlock: k(
      'int UnlockFileEx(void *handle, uint32 reserved, uint32 low, uint32 high, void *overlapped)',
    ),
    openProcess: k('void *OpenProcess(uint32 access, int inherit, uint32 pid)'),
    processSession: k('int ProcessIdToSessionId(uint32 pid, _Out_ uint32 *session)'),
    processImage: k(
      'int QueryFullProcessImageNameW(void *process, uint32 flags, void *name, _Inout_ uint32 *length)',
    ),
    wait: k('uint32 WaitForSingleObject(void *handle, uint32 milliseconds)'),
    openToken: a('int OpenProcessToken(void *process, uint32 access, _Out_ void **token)'),
    tokenInfo: a(
      'int GetTokenInformation(void *token, int kind, void *info, uint32 size, _Out_ uint32 *required)',
    ),
    sidString: a('int ConvertSidToStringSidW(void *sid, _Out_ void **string)'),
    descriptor: a(
      'int ConvertStringSecurityDescriptorToSecurityDescriptorW(str16 string, uint32 revision, _Out_ void **descriptor, void *size)',
    ),
    getSecurity: a(
      'uint32 GetSecurityInfo(void *handle, int kind, uint32 info, _Out_ void **owner, void *group, _Out_ void **dacl, void *sacl, _Out_ void **descriptor)',
    ),
    setSecurity: a(
      'uint32 SetSecurityInfo(void *handle, int kind, uint32 info, void *owner, void *group, void *dacl, void *sacl)',
    ),
    descriptorDacl: a(
      'int GetSecurityDescriptorDacl(void *descriptor, _Out_ int *present, _Out_ void **dacl, _Out_ int *defaulted)',
    ),
    descriptorControl: a(
      'int GetSecurityDescriptorControl(void *descriptor, _Out_ uint16 *control, _Out_ uint32 *revision)',
    ),
    getAce: a('int GetAce(void *acl, uint32 index, _Out_ void **ace)'),
    createEvent: k(
      'void *CreateEventW(void *security, int manualReset, int initialState, str16 name)',
    ),
    read: k('int ReadFile(void *handle, void *buffer, uint32 size, void *count, void *overlapped)'),
    write: k(
      'int WriteFile(void *handle, void *buffer, uint32 size, void *count, void *overlapped)',
    ),
    result: k(
      'int GetOverlappedResult(void *handle, void *overlapped, _Out_ uint32 *count, int wait)',
    ),
    cancel: k('int CancelIoEx(void *handle, void *overlapped)'),
    serverPid: k('int GetNamedPipeServerProcessId(void *pipe, _Out_ uint32 *pid)'),
    clientPid: k('int GetNamedPipeClientProcessId(void *pipe, _Out_ uint32 *pid)'),
    createPipe: k(
      'void *CreateNamedPipeW(str16 name, uint32 access, uint32 mode, uint32 instances, uint32 outputSize, uint32 inputSize, uint32 timeout, void *security)',
    ),
    connectPipe: k('int ConnectNamedPipe(void *pipe, void *overlapped)'),
    disconnectPipe: k('int DisconnectNamedPipe(void *pipe)'),
  };
  return api;
}

export function failure(operation: string, code = Number(win32().lastError())) {
  return new BridgeError('WINDOWS_NATIVE_ERROR', `${operation} failed (Win32 ${code})`, {
    cause: { operation, win32: code },
  });
}
export function check(value: unknown, operation: string) {
  if (!value) throw failure(operation);
}
export function checkedHandle(value: Handle | null, operation: string): Handle {
  if (!value || value === INVALID_HANDLE) throw failure(operation);
  return value;
}
export function sidString(sid: Handle): string {
  const api = win32(),
    output: (Handle | null)[] = [null];
  check(api.sidString(sid, output), 'ConvertSidToStringSid');
  try {
    return api.ffi.decode.string16(output[0]);
  } finally {
    api.localFree(output[0]);
  }
}
function tokenSid(processHandle: Handle) {
  const api = win32(),
    token: (Handle | null)[] = [null];
  check(api.openToken(processHandle, 8, token), 'OpenProcessToken');
  try {
    const required = [0];
    api.tokenInfo(token[0], 1, null, 0, required);
    const buffer = Buffer.alloc(required[0]);
    check(api.tokenInfo(token[0], 1, buffer, buffer.length, required), 'GetTokenInformation');
    return sidString(api.ffi.decode(buffer, 'void *'));
  } finally {
    api.close(token[0]);
  }
}
let identity: { sid: string; session: number } | undefined;
export function userIdentity() {
  if (!identity) {
    const session = [0];
    check(win32().processSession(process.pid, session), 'ProcessIdToSessionId');
    identity = { sid: tokenSid(INVALID_HANDLE), session: session[0] };
  }
  return identity;
}
export function processLease(pid: number) {
  const api = win32();
  const handle = checkedHandle(api.openProcess(0x101000, 0, pid), 'OpenProcess');
  let closed = false;
  try {
    const session = [0],
      length = [32768],
      image = Buffer.alloc(length[0] * 2);
    check(api.processSession(pid, session), 'ProcessIdToSessionId');
    const sid = tokenSid(handle);
    check(api.processImage(handle, 0, image, length), 'QueryFullProcessImageName');
    return {
      pid,
      sid,
      session: session[0],
      image: image.toString('utf16le', 0, length[0] * 2),
      alive: () => !closed && api.wait(handle, 0) === 258,
      close: () => {
        if (!closed) {
          closed = true;
          api.close(handle);
        }
      },
    };
  } catch (error) {
    api.close(handle);
    throw error;
  }
}

export function privateSecurity(directory: boolean) {
  const api = win32(),
    output: (Handle | null)[] = [null];
  const flags = directory ? 'OICI' : '';
  const sddl = `D:P(A;${flags};FA;;;${userIdentity().sid})(A;${flags};FA;;;SY)`;
  check(api.descriptor(sddl, 1, output, null), 'ConvertStringSecurityDescriptor');
  const descriptor = output[0]!;
  const attributes = { length: api.ffi.sizeof(api.sa), descriptor, inherit: 0 };
  return {
    descriptor,
    attributes: api.ffi.as(attributes, api.ffi.pointer(api.sa)),
    close: () => api.localFree(descriptor),
  };
}
