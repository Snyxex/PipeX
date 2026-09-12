import type { EngineLimits, ProcessorContext, StreamPluginContext } from './types.js';

export const DEFAULT_LIMITS: Readonly<EngineLimits> = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
  maxFrameBytes: 8 * 1024 * 1024,
  maxFrames: 100_000,
  maxConcurrentOperations: 32,
  operationTimeoutMs: 5 * 60_000,
  maxRetryAttempts: 5,
  maxRetryDelayMs: 30_000,
});

type LimitContext = Pick<ProcessorContext | StreamPluginContext, 'limits'>;

/** Maximum buffer a plugin can receive: external input or prior plugin output. */
export function pluginInputLimit(context?: LimitContext): number {
  const limits = context?.limits ?? DEFAULT_LIMITS;
  return Math.max(limits.maxInputBytes, limits.maxOutputBytes);
}

/** Maximum buffer a plugin may produce. */
export function pluginOutputLimit(context?: LimitContext): number {
  return context?.limits?.maxOutputBytes ?? DEFAULT_LIMITS.maxOutputBytes;
}
