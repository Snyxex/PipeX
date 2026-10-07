import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { DataEngine } from '../../dist/index.mjs';

test('observer throws and asynchronous rejections cannot terminate the host process', () => {
  const entry = new URL('../../dist/index.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { Readable, Writable } from 'node:stream';
    import { DataEngine } from '${entry}';
    const broken = () => { throw new Error('observer failed'); };
    const rejected = async () => { throw new Error('async observer failed'); };
    const engine = new DataEngine().setLogger({ info: rejected, warn: broken, debug: rejected, error: broken });
    engine.setTracer({ startSpan() { return { setAttribute: broken, addEvent: rejected, end: rejected }; } });
    engine.on('end', rejected);
    engine.on('error', rejected);
    await engine.binary.run('healthy');
    engine.use({ name: 'failure', version: '1', process() { throw new Error('plugin failure'); } });
    await assert.rejects(engine.stream.pipe(Readable.from([Buffer.from('x')]), new Writable({ write(_c, _e, cb) { cb(); } })), /plugin failure/);
    await new Promise(resolve => setTimeout(resolve, 20));
    console.log('survived');
  `;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', script], { env, encoding: 'utf8', timeout: 5000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /survived/);
});

test('observer isolation preserves once, listener removal, and independent delivery', async () => {
  const engine = new DataEngine();
  let once = 0;
  let always = 0;
  engine.once('end', () => { once++; throw new Error('ignored'); });
  const listener = () => { always++; };
  engine.on('end', listener);
  await engine.binary.run('one');
  await engine.binary.run('two');
  engine.off('end', listener);
  await engine.binary.run('three');
  assert.equal(once, 1);
  assert.equal(always, 2);
});

test('audit sink failures remain visible and free capacity', async () => {
  const engine = new DataEngine({ maxConcurrentOperations: 1 }).setAuditLogger({ async log() { throw new Error('audit failed'); } });
  await assert.rejects(engine.binary.run('one'), /audit failed/);
  engine.setAuditLogger({ log() {} });
  await engine.binary.run('two');
});
