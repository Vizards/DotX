import fs from 'node:fs';
import path from 'node:path';
import { BridgeError } from '@dotx/shared/errors';
import {
  checkedHandle,
  check,
  failure,
  privateSecurity,
  sidString,
  userIdentity,
  win32,
} from './api.ts';
import type { Handle } from './api.ts';

function securityInfo(handle: Handle) {
  const api = win32(),
    owner = [null],
    dacl = [null],
    descriptor = [null];
  const code = api.getSecurity(handle, 1, 5, owner, null, dacl, null, descriptor);
  if (code) throw failure('GetSecurityInfo', code);
  return {
    owner: owner[0]!,
    dacl: dacl[0]!,
    descriptor: descriptor[0]!,
    close: () => api.localFree(descriptor[0]),
  };
}
function checkFile(handle: Handle, directory: boolean) {
  const info = Buffer.alloc(8),
    api = win32();
  check(api.attributes(handle, 9, info, info.length), 'GetFileInformationByHandleEx');
  const flags = info.readUInt32LE();
  if (!!(flags & 0x10) !== directory || flags & 0x400)
    throw new BridgeError(
      'PRIVATE_PATH_INVALID',
      'Expected a local file/directory without a reparse point',
    );
  const security = securityInfo(handle);
  try {
    if (sidString(security.owner) !== userIdentity().sid)
      throw new BridgeError('PRIVATE_PATH_OWNER_MISMATCH');
  } finally {
    security.close();
  }
}
function open(file: string, directory: boolean, writeAcl: boolean) {
  return checkedHandle(
    win32().createFile(
      file,
      writeAcl ? 0x60000 : 0x20000,
      7,
      null,
      3,
      0x200000 | (directory ? 0x2000000 : 0),
      null,
    ),
    'Open private path',
  );
}
function setPrivate(handle: Handle, directory: boolean) {
  const api = win32(),
    security = privateSecurity(directory);
  try {
    const present = [0],
      dacl = [null],
      defaulted = [0];
    check(
      api.descriptorDacl(security.descriptor, present, dacl, defaulted),
      'GetSecurityDescriptorDacl',
    );
    const code = api.setSecurity(handle, 1, 0x80000004, null, null, dacl[0], null);
    if (code) throw failure('SetSecurityInfo', code);
  } finally {
    security.close();
  }
}
const preparedDirectories = new Set<string>();
export function secureDirectory(dir: string) {
  const key = path.resolve(dir).toLowerCase();
  if (preparedDirectories.has(key)) return;
  // The host may pre-create PLUGIN_DATA with sandbox-readable inheritance.
  // Provision it on first use, not on every standby lock attempt or write.
  fs.mkdirSync(dir, { recursive: true });
  const handle = open(dir, true, true);
  try {
    checkFile(handle, true);
    setPrivate(handle, true);
  } finally {
    win32().close(handle);
  }
  preparedDirectories.add(key);
}
export function verifyPrivate(file: string, directory = false) {
  const handle = open(file, directory, false),
    api = win32();
  try {
    checkFile(handle, directory);
    const security = securityInfo(handle);
    try {
      if (!security.dacl) throw new BridgeError('PRIVATE_PATH_ACL_INVALID');
      const control = [0],
        revision = [0];
      check(
        api.descriptorControl(security.descriptor, control, revision),
        'GetSecurityDescriptorControl',
      );
      if (directory && !(control[0] & 0x1000)) throw new BridgeError('PRIVATE_PATH_ACL_INVALID');
      const count = api.ffi.decode(security.dacl, 4, 'uint16');
      let userAllowed = false;
      for (let index = 0; index < count; index++) {
        const ace: (Handle | null)[] = [null];
        check(api.getAce(security.dacl, index, ace), 'GetAce');
        const pointer = ace[0]!;
        if (api.ffi.decode.uint8(pointer) !== 0) throw new BridgeError('PRIVATE_PATH_ACL_INVALID');
        const sid = sidString(pointer + 8n),
          mask = api.ffi.decode(pointer, 4, 'uint32');
        // Administrators already have the authority to take ownership. Their
        // conventional ACE is not a cross-user credential exposure.
        if (sid !== userIdentity().sid && sid !== 'S-1-5-18' && sid !== 'S-1-5-32-544')
          throw new BridgeError('PRIVATE_PATH_ACL_INVALID');
        if (sid === userIdentity().sid && (mask & 0x1f01ff) === 0x1f01ff) userAllowed = true;
      }
      if (!userAllowed) throw new BridgeError('PRIVATE_PATH_ACL_INVALID');
    } finally {
      security.close();
    }
  } finally {
    api.close(handle);
  }
}
