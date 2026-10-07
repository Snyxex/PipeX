import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable, Writable, Transform } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { DataEngine, definePlugin, withRetry, OperationTimeoutError, OperationAbortedError } from 'pipex';

test('synchronous retries preserve values, receiver and deadline checks without tracking finished work', async () => {
  let tracked = 0;
  const engine = new DataEngine();
  const signal = engine.createOperationSignal();
  for (const value of [undefined, null, 42, false, 'x', Buffer.from('bytes'), {}]) {
    assert.equal(await withRetry(() => value, undefined, undefined, { signal, track() { tracked++; } }), value);
  }
  assert.equal(tracked, 0);
  const microtaskAbort = new AbortController();
  await assert.rejects(withRetry(() => {
    queueMicrotask(() => microtaskAbort.abort());
    return Buffer.alloc(0);
  }, undefined, undefined, { signal: microtaskAbort.signal }), OperationAbortedError);
  let calls = 0;
  const plugin = definePlugin({
    name: 'retry-receiver', version: '1',
    retryOptions: { attempts: 2, backoff: 'fixed', delayMs: 0 },
    process(data) {
      assert.equal(this.name, 'retry-receiver');
      if (++calls === 1) throw new Error('retry');
      return data;
    },
  });
  assert.equal((await new DataEngine().use(plugin).binary.run('ok')).data.toString(), 'ok');
  assert.equal(calls, 2);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(withRetry(() => { throw new Error('must not run'); }, undefined, undefined, { signal: aborted.signal }), OperationAbortedError);
  const deadline = engine.createOperationSignal({ timeoutMs: 1 });
  await assert.rejects(withRetry(() => {
    const end = Date.now() + 10; while (Date.now() < end) {}
    return Buffer.alloc(0);
  }, undefined, undefined, { signal: deadline }), OperationTimeoutError);
});

test('Promises and custom thenables retain asynchronous assimilation and one-time getter access', async () => {
  let reads = 0, calls = 0, tracked = 0;
  let invoked = false;
  const thenable = {
    get then() {
      reads++;
      return function(resolve, reject) {
        assert.equal(this, thenable);
        invoked = true; calls++;
        resolve(Buffer.from('ok'));
        reject(new Error('late reject'));
        throw new Error('late throw');
      };
    },
  };
  const work = withRetry(() => thenable, undefined, undefined, { track() { tracked++; } });
  assert.equal(invoked, false);
  assert.equal((await work).toString(), 'ok');
  assert.equal(reads, 1); assert.equal(calls, 1); assert.equal(tracked, 1);
  assert.equal(await withRetry(() => Promise.resolve(7), undefined, undefined, { track() { tracked++; } }), 7);
  assert.equal(tracked, 2);
  let getters = 0;
  await assert.rejects(withRetry(() => ({ get then() { getters++; throw new Error('getter failed'); } }),
    { attempts: 2, backoff: 'fixed', delayMs: 0 }), /getter failed/);
  assert.equal(getters, 2);
});

test('timed-out thenables retain engine capacity until underlying work settles', async () => {
  let finish;
  const engine = new DataEngine({ maxConcurrentOperations: 1 }).use(definePlugin({
    name: 'pending-thenable', version: '1',
    process(data) { return { then(resolve) { finish = () => resolve(data); } }; },
  }));
  await assert.rejects(engine.binary.run('slow', { timeoutMs: 10 }), OperationTimeoutError);
  await assert.rejects(engine.binary.run('blocked'), /Maximum concurrent/);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  const result = engine.binary.run('next', { timeoutMs: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  finish();
  assert.equal((await result).data.toString(), 'next');
});

test('combined native stream guard keeps cumulative bounds, progress order and single span completion', async () => {
  const engine = new DataEngine({ maxInputBytes: 32, maxOutputBytes: 10 }).use(definePlugin({
    name: 'expand-native', version: '1', process: data => data,
    createStream() { return new Transform({ transform(chunk, _encoding, callback) { callback(null, Buffer.concat([chunk, chunk])); } }); },
  }));
  const progress = [], spans = [];
  engine.on('progress', bytes => progress.push(bytes));
  engine.setTracer({ startSpan(name) {
    const span = { name, ended: 0, setAttribute() { return this; }, addEvent() { return this; }, end() { this.ended++; } };
    spans.push(span); return span;
  } });
  let forwarded = 0;
  await assert.rejects(engine.stream.pipe(
    Readable.from([Buffer.alloc(3), Buffer.alloc(3), Buffer.alloc(3)]),
    new Writable({ write(chunk, _encoding, callback) { forwarded += chunk.length; callback(); } }),
  ), /output after plugin expand-native#0 exceeds 10 bytes/);
  assert.ok(forwarded <= 10);
  assert.deepEqual(progress.slice(0, 2), [6, 6]);
  assert.ok(spans.length > 0);
  assert.ok(spans.every(span => span.ended === 1));
});

test('sync and async observer failures including hostile thenables stay isolated', () => {
  const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', [
    "import { DataEngine, definePlugin } from 'pipex';",
    "let reads = 0, logs = 0, ends = 0;",
    "const bad = () => ({ get then() { reads++; return (_resolve, reject) => reject(new Error('observer')); } });",
    "const engine = new DataEngine().use(definePlugin({name:'identity',version:'1',process:x=>x}));",
    "engine.setLogger({info(){logs++;return bad()},debug(){throw Error('debug')},warn(){return Promise.reject(Error('warn'))},error(){throw Error('error')}});",
    "engine.setTracer({startSpan(){return {setAttribute:bad,addEvent:bad,end(){ends++;return bad()}}}});",
    "engine.on('start',bad).on('end',()=>Promise.reject(Error('listener')));",
    "await engine.binary.run('ok');",
    "await new Promise(resolve=>setImmediate(resolve));",
    "if(logs!==2||ends!==2||reads<3) throw Error('observer lifecycle changed');",
  ].join('\n')], { cwd: new URL('../..', import.meta.url), encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
});

test('operation signals preserve independent deadlines and caller cancellation', async () => {
  const engine = new DataEngine();
  const first = engine.createOperationSignal({ timeoutMs: 10 });
  const second = engine.createOperationSignal({ timeoutMs: 1000 });
  assert.notEqual(first, second);
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await new Promise(resolve => first.addEventListener('abort', resolve, { once: true }));
    assert.equal(first.reason.name, 'TimeoutError');
    assert.equal(second.aborted, false);
    const caller = new AbortController();
    const composed = engine.createOperationSignal({ signal: caller.signal, timeoutMs: 1000 });
    const unlimited = engine.createOperationSignal({ signal: caller.signal, timeoutMs: 0 });
    assert.notEqual(composed, caller.signal);
    assert.notEqual(unlimited, caller.signal);
    const reason = new Error('caller cancelled');
    caller.abort(reason);
    assert.equal(composed.reason, reason);
    assert.equal(unlimited.reason, reason);
    assert.equal(engine.createOperationSignal({ timeoutMs: 0 }).aborted, false);
  } finally { clearTimeout(keepAlive); }
});
