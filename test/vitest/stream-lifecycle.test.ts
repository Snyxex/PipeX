import { describe, expect, it } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { DataEngine, CompressionPlugin } from '../../src/index.js';

describe('stream lifecycle', () => {
  it('does not overrun a slowly consuming writable', async () => {
    let writes = 0;
    const destination = new Writable({
      highWaterMark: 1024,
      write(_chunk, _encoding, cb) {
        writes++;
        setImmediate(cb);
      },
    });
    const engine = new DataEngine().use(new CompressionPlugin({ type: 'none' }));
    await engine.stream.pipe(
      Readable.from(Array.from({ length: 40 }, () => Buffer.alloc(4096, 1))),
      destination,
    );
    expect(writes).toBeGreaterThan(0);
    expect(destination.writableFinished).toBe(true);
  });
  it('propagates an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const destination = new Writable({ write(_data, _enc, cb) { cb(); } });
    const engine = new DataEngine().use(new CompressionPlugin({ type: 'gzip' }));
    await expect(engine.stream.pipe(
      Readable.from([Buffer.from('data')]),
      destination,
      false,
      { signal: controller.signal },
    )).rejects.toThrow();
  });
  it('propagates destination errors', async () => {
    const failure = new Error('destination failure');
    const destination = new Writable({ write(_data, _enc, cb) { cb(failure); } });
    const engine = new DataEngine().use(new CompressionPlugin({ type: 'none' }));
    await expect(engine.stream.pipe(Readable.from([Buffer.alloc(16)]), destination)).rejects.toThrow();
  });
});
