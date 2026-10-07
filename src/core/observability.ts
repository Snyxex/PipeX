import type { Logger, Span, Tracer, ProcessorContext } from './types.js';

import { pendingPromise } from './pendingPromise.js';

const loggerWrappers = new WeakMap<Logger, Logger>();
const tracerWrappers = new WeakMap<Tracer, Tracer>();

// Integrations may throw synchronously or return a rejected promise despite
// their synchronous TypeScript contract. Neither may escape an observer.
export function observe(callback: () => unknown): void {
  try { void pendingPromise(callback())?.catch(() => undefined); } catch { /* observer isolation */ }
}

export function safeLogger(logger: Logger | undefined): Logger | undefined {
  if (!logger) return undefined;
  const existing = loggerWrappers.get(logger);
  if (existing) return existing;
  const wrapper: Logger = {
    info: (message, context) => observe(() => logger.info(message, context)),
    warn: (message, context) => observe(() => logger.warn(message, context)),
    error: (message, context) => observe(() => logger.error(message, context)),
    debug: (message, context) => observe(() => logger.debug(message, context)),
  };
  loggerWrappers.set(logger, wrapper);
  loggerWrappers.set(wrapper, wrapper);
  return wrapper;
}

export function safeTracer(tracer: Tracer | undefined): Tracer | undefined {
  if (!tracer) return undefined;
  const existing = tracerWrappers.get(tracer);
  if (existing) return existing;
  const safe: Tracer = {
    startSpan(name: string, context?: ProcessorContext): Span {
      let span: Span | undefined;
      try {
        const candidate = tracer.startSpan(name, context);
        const pending = pendingPromise(candidate);
        if (pending) void pending.catch(() => undefined);
        else span = candidate;
      } catch { /* observer isolation */ }
      let ended = false;
      const wrapper: Span = {
        setAttribute(key, value) { observe(() => span?.setAttribute(key, value)); return wrapper; },
        addEvent(event, attributes) { observe(() => span?.addEvent(event, attributes)); return wrapper; },
        end() { if (!ended) { ended = true; observe(() => span?.end()); } },
      };
      return wrapper;
    },
  };
  tracerWrappers.set(tracer, safe);
  tracerWrappers.set(safe, safe);
  return safe;
}
