import { OperationAbortedError, OperationTimeoutError } from './errors.js';

import { pendingPromise } from './pendingPromise.js';

const deadlines = new WeakMap<AbortSignal, number>();

export function registerDeadline(signal: AbortSignal, timeoutMs: number): void {
  if (timeoutMs > 0) deadlines.set(signal, Date.now() + timeoutMs);
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof OperationTimeoutError || signal.reason instanceof OperationAbortedError) return signal.reason;
  if (signal.reason instanceof Error && signal.reason.name === 'TimeoutError') return new OperationTimeoutError();
  return new OperationAbortedError();
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal) return;
  if (signal.aborted) throw abortError(signal);
  const deadline = deadlines.get(signal);
  // Synchronous work can keep the event loop from delivering its abort event.
  if (deadline !== undefined && Date.now() >= deadline) throw new OperationTimeoutError();
}

/** Stop waiting promptly, but account for non-cooperative work until it settles. */
export function awaitOperation<T>(
  value: T | PromiseLike<T>,
  signal?: AbortSignal,
  track?: (pending: Promise<unknown>) => void,
): T | Promise<T> {
  const promise = pendingPromise(value);
  if (!promise) {
    throwIfAborted(signal);
    return value as T;
  }
  track?.(promise);
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      if (timer) clearTimeout(timer);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    const deadline = deadlines.get(signal);
    if (deadline !== undefined) {
      // Referenced: a pending plugin promise may own no other event-loop handle.
      timer = setTimeout(() => fail(new OperationTimeoutError()), Math.max(0, deadline - Date.now()));
    }
    promise.then(result => {
      if (settled) return; // Late results are discarded, never forwarded or retried.
      try { throwIfAborted(signal); } catch (error) { fail(error); return; }
      settled = true;
      cleanup();
      resolve(result);
    }, fail);
    try { throwIfAborted(signal); } catch (error) { fail(error); }
  });
}
