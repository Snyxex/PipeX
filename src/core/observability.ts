import type { Logger, Span, Tracer, ProcessorContext } from './types.js';

// Integrations may throw synchronously or return a rejected promise despite
// their synchronous TypeScript contract. Neither may escape an observer.
export function observe(callback: () => unknown): void {
  try { void Promise.resolve(callback()).catch(() => undefined); } catch { /* observer isolation */ }
}

export function safeLogger(logger: Logger | undefined): Logger | undefined {
  if (!logger) return undefined;
  return {
    info: (message, context) => observe(() => logger.info(message, context)),
    warn: (message, context) => observe(() => logger.warn(message, context)),
    error: (message, context) => observe(() => logger.error(message, context)),
    debug: (message, context) => observe(() => logger.debug(message, context)),
  };
}

export function safeTracer(tracer: Tracer | undefined): Tracer | undefined {
  if (!tracer) return undefined;
  return {
    startSpan(name: string, context?: ProcessorContext): Span {
      let span: Span | undefined;
      try {
        const candidate = tracer.startSpan(name, context);
        if (candidate && typeof (candidate as unknown as { then?: unknown }).then === 'function') {
          observe(() => candidate);
        } else span = candidate;
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
}
