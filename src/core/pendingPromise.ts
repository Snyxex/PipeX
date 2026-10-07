/** Preserve Promise/thenable assimilation while leaving synchronous values alone. */
export function pendingPromise<T>(value: T | PromiseLike<T>): Promise<T> | undefined {
  if (value instanceof Promise) return Promise.resolve(value);
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  // Read once: then may be an accessor with observable effects or may throw.
  const then = (value as { then?: unknown }).then;
  if (typeof then !== 'function') return undefined;
  return Promise.resolve({
    then(resolve: (result: T | PromiseLike<T>) => void, reject: (error: unknown) => void) {
      Reflect.apply(then, value, [resolve, reject]);
    },
  } as PromiseLike<T>);
}
