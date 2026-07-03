import { DataEngine } from '../src/core/dataEngine.js';
import { BasePlugin } from '../src/core/plugin.js';
import type { Logger, Tracer, Span, ProcessorContext } from '../src/core/types.js';

class MockLogger implements Logger {
  logs: { level: string; msg: string; ctx?: any }[] = [];
  info(msg: string, ctx?: any)  { this.logs.push({ level: 'info', msg, ctx }); }
  warn(msg: string, ctx?: any)  { this.logs.push({ level: 'warn', msg, ctx }); }
  error(msg: string, ctx?: any) { this.logs.push({ level: 'error', msg, ctx }); }
  debug(msg: string, ctx?: any) { this.logs.push({ level: 'debug', msg, ctx }); }
}

class MockSpan implements Span {
  attributes: Record<string, any> = {};
  events: { name: string; attr?: any }[] = [];
  ended = false;
  setAttribute(k: string, v: any) { this.attributes[k] = v; return this; }
  addEvent(name: string, attr?: any) { this.events.push({ name, attr }); return this; }
  end() { this.ended = true; }
}

class MockTracer implements Tracer {
  spans: MockSpan[] = [];
  startSpan(_name: string) {
    const s = new MockSpan();
    this.spans.push(s);
    return s;
  }
}

class ObsPlugin extends BasePlugin {
  name = 'obs';
  version = '1.0.0';
  process(data: Buffer, ctx: ProcessorContext) {
    ctx.logger?.info('Processing in plugin', { size: data.length });
    ctx.span?.setAttribute('plugin.processed', true);
    return data;
  }
}

async function testObservability() {
  console.log('Testing Observability...');
  const engine = new DataEngine();
  const logger = new MockLogger();
  const tracer = new MockTracer();

  engine.setLogger(logger).setTracer(tracer);
  engine.use(new ObsPlugin());

  await engine.binary.run({ hello: 'world' });

  // Verify Logger
  const hasStart = logger.logs.some(l => l.msg.includes('Request started'));
  const hasPlugin = logger.logs.some(l => l.msg === 'Processing in plugin');
  const hasEnd = logger.logs.some(l => l.msg.includes('Request ended'));

  if (!hasStart || !hasPlugin || !hasEnd) {
    throw new Error('Logger missing expected entries');
  }

  // Verify Tracer
  const hasBinaryRun = tracer.spans.some(s => s.ended);
  const hasPluginSpan = tracer.spans.some(s => s.attributes['plugin.processed'] === true);

  if (!hasBinaryRun || !hasPluginSpan) {
    throw new Error('Tracer missing expected spans or attributes');
  }

  console.log('✅ Observability test passed!');
}

testObservability().catch(e => {
  console.error('❌ Observability test failed:', e);
  process.exit(1);
});
