import { constants, openSync, closeSync, fstatSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import type * as Koffi from 'koffi';

let ffi: typeof Koffi | undefined;
const native = (): typeof Koffi => ffi ??= createRequire(import.meta.url)('koffi') as typeof Koffi;
import { assertExists, resolveOutputPath, DEFAULT_HIGH_WATER } from './core.js';

export interface AtomicFileSession {
  readonly source: Readable;
  readonly destination: Writable;
  commit(): void;
  dispose(): Promise<void>;
}

const fail = (operation: string): never => { throw new Error('[PipeX] Secure file ' + operation + ' failed'); };
const components = (absolute: string): string[] => {
  const base = path.parse(absolute).root;
  return absolute.slice(base.length).split(path.sep).filter(Boolean);
};

/** Acquire capabilities before invoking any plugin or beginning asynchronous I/O. */
export function openAtomicFileSession(inputPath: string, outputPath: string, allowedRoot?: string): AtomicFileSession {
  const root = realpathSync.native(path.resolve(allowedRoot ?? process.cwd()));
  const input = assertExists(inputPath, root);
  const output = resolveOutputPath(outputPath, root);
  if (input === output) throw new Error('[PipeX] Input and output must be different files');
  return process.platform === 'win32' ? openWindows(input, output, root) : openPosix(input, output);
}

let windows: ReturnType<typeof loadWindows> | undefined;
function loadWindows() {
  const koffi = native();
  const lib = koffi.load('kernel32.dll');
  const ntdll = koffi.load('ntdll.dll');
  const unicode = koffi.struct({ Length: 'uint16_t', MaximumLength: 'uint16_t', Buffer: 'str16' });
  const attributes = koffi.struct({ Length: 'uint32_t', RootDirectory: 'intptr_t', ObjectName: koffi.pointer(unicode), Attributes: 'uint32_t', SecurityDescriptor: 'void *', SecurityQualityOfService: 'void *' });
  const status = koffi.struct({ Status: 'intptr_t', Information: 'uintptr_t' });
  return {
    setRelativeInfo: ntdll.func('__stdcall', 'NtSetInformationFile', 'int32_t', ['intptr_t', koffi.out(koffi.pointer(status)), 'void *', 'uint32_t', 'int']),
    relativeOpen: ntdll.func('__stdcall', 'NtCreateFile', 'int32_t', ['_Out_ intptr_t *', 'uint32_t', koffi.pointer(attributes), koffi.out(koffi.pointer(status)), 'void *', 'uint32_t', 'uint32_t', 'uint32_t', 'uint32_t', 'void *', 'uint32_t']),
    attributesSize: koffi.sizeof(attributes),
    pointerBytes: koffi.sizeof('void *'),
    finalPath: lib.func('__stdcall', 'GetFinalPathNameByHandleW', 'uint32_t', ['intptr_t', '_Out_ void *', 'uint32_t', 'uint32_t']),
    open: lib.func('__stdcall', 'CreateFileW', 'intptr_t', ['str16', 'uint32_t', 'uint32_t', 'void *', 'uint32_t', 'uint32_t', 'void *']),
    info: lib.func('__stdcall', 'GetFileInformationByHandle', 'int', ['intptr_t', '_Out_ void *']),
    type: lib.func('__stdcall', 'GetFileType', 'uint32_t', ['intptr_t']),
    read: lib.func('__stdcall', 'ReadFile', 'int', ['intptr_t', '_Out_ void *', 'uint32_t', '_Out_ uint32_t *', 'void *']),
    write: lib.func('__stdcall', 'WriteFile', 'int', ['intptr_t', 'void *', 'uint32_t', '_Out_ uint32_t *', 'void *']),
    setInfo: lib.func('__stdcall', 'SetFileInformationByHandle', 'int', ['intptr_t', 'int', 'void *', 'uint32_t']),
    close: lib.func('__stdcall', 'CloseHandle', 'int', ['intptr_t']),
  };
}

function openWindows(input: string, output: string, root: string): AtomicFileSession {
  const api = windows ??= loadWindows();
  const handles: (number | bigint)[] = [];
  const directories = new Map<string, number | bigint>();
  const pending = new Set<Promise<unknown>>();
  let committed = false;
  let disposed = false;
  let inputHandle: number | bigint;
  let outputHandle: number | bigint | undefined;
  const information = (handle: number | bigint): Buffer => {
    const buffer = Buffer.alloc(52); // BY_HANDLE_FILE_INFORMATION, fixed Win32 layout
    if (!api.info(handle, buffer)) fail('handle inspection');
    return buffer;
  };
  const acquire = (name: string, access: number, share: number, disposition: number, directory: boolean): number | bigint => {
    // OPEN_REPARSE_POINT prevents following a last-component junction/symlink.
    const handle = api.open(name, access, share, null, disposition, 0x00200000 | (directory ? 0x02000000 : 0x80), null) as number | bigint;
    if (BigInt(handle) === -1n) fail('open');
    handles.push(handle);
    const attributes = information(handle).readUInt32LE(0);
    if ((attributes & 0x400) || Boolean(attributes & 0x10) !== directory || api.type(handle) !== 1) fail('file type validation');
    return handle;
  };
  const relativeOpen = (parent: number | bigint, name: string, access: number, create: boolean, directory: boolean, optional = false): number | bigint | undefined => {
    if (!name || name === '.' || name === '..' || /[\\/:]/.test(name)) fail('relative name validation');
    const opened: (number | bigint)[] = [0];
    const result = api.relativeOpen(opened, (access | 0x100000) >>> 0, {
      Length: api.attributesSize, RootDirectory: parent,
      ObjectName: { Length: Buffer.byteLength(name, 'utf16le'), MaximumLength: Buffer.byteLength(name, 'utf16le') + 2, Buffer: name },
      Attributes: 0x40, SecurityDescriptor: null, SecurityQualityOfService: null,
    }, {}, null, 0x80, directory ? 3 : 1, create ? 2 : 1, 0x200020 | (directory ? 1 : 0x40), null, 0) as number;
    if (result < 0) {
      if (optional && (result >>> 0) === 0xc0000034) return undefined;
      fail('relative open');
    }
    const handle = opened[0]!;
    handles.push(handle);
    if (create) outputHandle = handle;
    const flags = information(handle).readUInt32LE(0);
    if ((flags & 0x400) || Boolean(flags & 0x10) !== directory || api.type(handle) !== 1) fail('relative type validation');
    return handle;
  };
  const openParent = (filename: string, rootHandle: number | bigint): number | bigint => {
    let current = '';
    let handle = rootHandle;
    for (const part of components(path.relative(root, path.dirname(filename)))) {
      current = path.join(current, part);
      const existing = directories.get(current.toLowerCase());
      if (existing !== undefined) handle = existing;
      else {
        handle = relativeOpen(handle, part, 0x80000000, false, true)!;
        directories.set(current.toLowerCase(), handle);
      }
    }
    return handle;
  };
  let outputParent: number | bigint;
  const closeAll = () => { for (const handle of handles.reverse()) api.close(handle); handles.length = 0; };
  try {
    const rootHandle = acquire(root, 0x80000000, 3, 3, true);
    // Verify the object actually opened, including any ancestor reparse points.
    // All subsequent lookup is relative to this capability, never to root's path.
    const rootName = Buffer.alloc(65536);
    const chars = api.finalPath(rootHandle, rootName, rootName.length / 2, 0) as number;
    if (!chars || chars >= rootName.length / 2) fail('root identity validation');
    const stripPrefix = (name: string) => name.startsWith('\\\\?\\UNC\\') ? '\\\\' + name.slice(8) : name.startsWith('\\\\?\\') ? name.slice(4) : name;
    if (path.normalize(stripPrefix(rootName.subarray(0, chars * 2).toString('utf16le'))).toLowerCase() !== path.normalize(root).toLowerCase()) fail('root identity validation');
    const inputParent = openParent(input, rootHandle);
    outputParent = openParent(output, rootHandle);
    inputHandle = relativeOpen(inputParent, path.basename(input), 0x80000000, false, false)!;
    // Compare file identities as well as names, including hard-link aliases.
    const other = relativeOpen(outputParent, path.basename(output), 0x80000000, false, false, true);
    if (other !== undefined) {
      try {
        const a = information(inputHandle);
        const b = information(other);
        if (a.readUInt32LE(28) === b.readUInt32LE(28) && a.subarray(44, 52).equals(b.subarray(44, 52))) {
          throw new Error('[PipeX] Input and output must be different files');
        }
        if (b.readUInt32LE(0) & 0x400) fail('output reparse validation');
      } finally { api.close(other); handles.pop(); }
    }
    const temporary = '.pipex-' + randomUUID() + '.tmp';
    // DELETE access permits rename/disposal through this exact handle. No
    // WRITE/DELETE sharing means another process cannot replace the temp file.
    outputHandle = relativeOpen(outputParent, temporary, 0x40010080, true, false)!;
  } catch (error) {
    if (outputHandle !== undefined) api.setInfo(outputHandle, 4, Buffer.from([1]), 1);
    closeAll();
    throw error;
  }

  const io = (write: boolean, buffer: Buffer): Promise<number> => {
    const count = [0];
    const task = new Promise<number>((resolve, reject) => {
      const fn = write ? api.write : api.read;
      fn.async(write ? outputHandle : inputHandle, buffer, buffer.length, count, null, (error: unknown, ok: number) => {
        if (error || !ok) reject(new Error('[PipeX] Secure file ' + (write ? 'write' : 'read') + ' failed'));
        else resolve(count[0]!);
      });
    });
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  let reading = false;
  const source = new Readable({
    highWaterMark: DEFAULT_HIGH_WATER,
    read() {
      if (reading) return;
      reading = true;
      const buffer = Buffer.allocUnsafe(DEFAULT_HIGH_WATER);
      void io(false, buffer).then(count => {
        reading = false;
        if (!this.destroyed) this.push(count ? buffer.subarray(0, count) : null);
      }, error => { reading = false; this.destroy(error as Error); });
    },
  });
  const destination = new Writable({
    highWaterMark: DEFAULT_HIGH_WATER,
    write(chunk: Buffer, _encoding, callback) {
      const work = (async () => {
        let offset = 0;
        while (offset < chunk.length) {
          if (disposed) fail('write after disposal');
          const count = await io(true, chunk.subarray(offset));
          if (!count) fail('write progress');
          offset += count;
        }
      })();
      pending.add(work);
      void work.then(() => { pending.delete(work); callback(); }, error => { pending.delete(work); callback(error as Error); });
    },
  });
  return {
    source, destination,
    commit() {
      if (disposed || committed) fail('commit state');
      // FILE_RENAME_INFO: offsets depend on HANDLE width, not filename length.
      const pointerBytes = api.pointerBytes;
      const rootOffset = pointerBytes === 8 ? 8 : 4;
      const lengthOffset = rootOffset + pointerBytes;
      const nameOffset = lengthOffset + 4;
      const name = Buffer.from(path.basename(output) + '\0', 'utf16le');
      const info = Buffer.alloc(nameOffset + name.length);
      info[0] = 1; // ReplaceIfExists, relative to the pinned output directory.
      if (pointerBytes === 8) info.writeBigUInt64LE(BigInt(outputParent), rootOffset);
      else info.writeUInt32LE(Number(outputParent), rootOffset);
      info.writeUInt32LE(name.length - 2, lengthOffset);
      name.copy(info, nameOffset);
      const status = api.setRelativeInfo(outputHandle, {}, info, info.length, 10) as number;
      if (status < 0) fail('atomic rename status ' + (status >>> 0).toString(16));
      committed = true;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      source.destroy();
      destination.destroy();
      await Promise.allSettled([...pending]);
      if (!committed) {
        // FILE_DISPOSITION_INFO deletes the opened temp object, never a path
        // that could have been exchanged by another process.
        api.setInfo(outputHandle, 4, Buffer.from([1]), 1);
      }
      closeAll();
    },
  };
}

let posix: ReturnType<typeof loadPosix> | undefined;
function loadPosix() {
  const lib = native().load(null);
  return {
    read: lib.func('intptr_t read(int fd, _Out_ void *buffer, size_t count)'),
    write: lib.func('intptr_t write(int fd, const void *buffer, size_t count)'),
    fcntl: lib.func('int fcntl(int fd, int command, int argument)'),
    openat: lib.func('int openat(int dirfd, const char *path, int flags, unsigned int mode)'),
    mkdirat: lib.func('int mkdirat(int dirfd, const char *path, unsigned int mode)'),
    renameat: lib.func('int renameat(int oldfd, const char *oldname, int newfd, const char *newname)'),
    unlinkat: lib.func('int unlinkat(int dirfd, const char *path, int flags)'),
  };
}

function openPosix(input: string, output: string): AtomicFileSession {
  const api = posix ??= loadPosix();
  const descriptors: number[] = [];
  const nofollow = constants.O_NOFOLLOW;
  const directory = constants.O_DIRECTORY;
  if (!nofollow || !directory) fail('platform support');
  const closeAll = () => { for (const fd of descriptors.reverse()) { try { closeSync(fd); } catch {} } descriptors.length = 0; };
  const openChild = (parent: number, name: string, flags: number, mode = 0): number => {
    const fd = api.openat(parent, name, flags | nofollow, mode) as number;
    if (fd < 0) fail('relative open');
    descriptors.push(fd);
    if (api.fcntl(fd, 2, 1) < 0) fail('descriptor inheritance protection');
    return fd;
  };
  const openParent = (filename: string): number => {
    let fd = openSync(path.parse(filename).root, constants.O_RDONLY | directory);
    descriptors.push(fd);
    for (const part of components(path.dirname(filename))) fd = openChild(fd, part, constants.O_RDONLY | directory);
    return fd;
  };
  const temporary = '.pipex-' + randomUUID();
  let outputParent: number | undefined;
  let temporaryParent: number | undefined;
  let inputFD: number;
  let outputFD: number;
  let committed = false;
  let disposed = false;
  let temporaryCreated = false;
  const pending = new Set<Promise<unknown>>();
  const removeDirectory = process.platform === 'linux' ? 0x200
    : process.platform === 'darwin' ? 0x80
    : process.platform === 'openbsd' ? 0x08 : 0x800; // AT_REMOVEDIR
  const cleanup = () => {
    if (temporaryParent !== undefined && !committed) api.unlinkat(temporaryParent, 'data', 0);
    if (outputParent !== undefined && temporaryCreated) api.unlinkat(outputParent, temporary, removeDirectory);
    closeAll();
  };
  try {
    const inputParent = openParent(input);
    outputParent = openParent(output);
    inputFD = openChild(inputParent, path.basename(input), constants.O_RDONLY | constants.O_NONBLOCK);
    const sourceStat = fstatSync(inputFD, { bigint: true });
    if (!sourceStat.isFile()) fail('input type validation');
    const existing = api.openat(outputParent, path.basename(output), constants.O_RDONLY | nofollow | constants.O_NONBLOCK, 0) as number;
    if (existing >= 0) {
      try {
        const targetStat = fstatSync(existing, { bigint: true });
        if (sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino) throw new Error('[PipeX] Input and output must be different files');
      } finally { closeSync(existing); }
    }
    // A private directory prevents another directory writer from substituting
    // the temporary entry. Subsequent operations use this exact directory FD.
    if (api.mkdirat(outputParent, temporary, 0o700) !== 0) fail('temporary directory creation');
    temporaryCreated = true;
    temporaryParent = openChild(outputParent, temporary, constants.O_RDONLY | directory);
    const tempStat = fstatSync(temporaryParent);
    if ((tempStat.mode & 0o077) !== 0 || tempStat.uid !== process.geteuid?.()) fail('temporary directory permissions');
    outputFD = openChild(temporaryParent, 'data', constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  } catch (error) { cleanup(); throw error; }
  const io = (write: boolean, buffer: Buffer): Promise<number> => {
    const task = new Promise<number>((resolve, reject) => {
      (write ? api.write : api.read).async(write ? outputFD : inputFD, buffer, buffer.length, (error: unknown, count: number | bigint) => {
        if (error || count < 0) reject(new Error('[PipeX] Secure relative file I/O failed'));
        else resolve(Number(count));
      });
    });
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  let reading = false;
  const source = new Readable({
    highWaterMark: DEFAULT_HIGH_WATER,
    read() {
      if (reading) return;
      reading = true;
      const buffer = Buffer.allocUnsafe(DEFAULT_HIGH_WATER);
      void io(false, buffer).then(count => {
        reading = false;
        if (!this.destroyed) this.push(count ? buffer.subarray(0, count) : null);
      }, error => { reading = false; this.destroy(error as Error); });
    },
  });
  const destination = new Writable({
    highWaterMark: DEFAULT_HIGH_WATER,
    write(chunk: Buffer, _encoding, callback) {
      const work = (async () => {
        let offset = 0;
        while (offset < chunk.length) {
          if (disposed) fail('write after disposal');
          const count = await io(true, chunk.subarray(offset));
          if (!count) fail('relative write progress');
          offset += count;
        }
      })();
      pending.add(work);
      void work.then(() => { pending.delete(work); callback(); }, error => { pending.delete(work); callback(error as Error); });
    },
  });
  return {
    source, destination,
    commit() {
      if (disposed || committed) fail('commit state');
      if (api.renameat(temporaryParent, 'data', outputParent, path.basename(output)) !== 0) fail('atomic relative rename');
      committed = true;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      // Wait for native I/O before closing descriptors, including cancellation.
      source.destroy();
      destination.destroy();
      await Promise.allSettled([...pending]);
      cleanup();
    },
  };
}
