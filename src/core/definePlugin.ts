import type { ProcessorPlugin } from './types.js';
import { getPluginCapabilities } from './core.js';

/** Object-style plugins are binary-only unless streaming is explicitly enabled. */
export type PluginDefinition = ProcessorPlugin;

/** A synchronous factory creates a fresh plugin from application-owned options. */
export type PluginFactory<TOptions = unknown> = (options: TOptions) => ProcessorPlugin;

/** Factories passed to fromConfig apply only to that configuration load. */
export type PluginRegistry = Readonly<Record<string, PluginFactory<any>>>;

/** Validate and snapshot an object-style plugin. Native streams enable streaming automatically. */
export function definePlugin(definition: PluginDefinition): Readonly<ProcessorPlugin> {
  if (!definition || typeof definition.name !== 'string' || definition.name.length === 0
    || definition.name.length > 128 || typeof definition.version !== 'string'
    || definition.version.length === 0 || typeof definition.process !== 'function'
    || (definition.reverse !== undefined && typeof definition.reverse !== 'function')
    || (definition.createStream !== undefined && typeof definition.createStream !== 'function')) {
    throw new TypeError('[PipeX] Invalid plugin definition');
  }
  const plugin: ProcessorPlugin = {
    name: definition.name,
    version: definition.version,
    process: definition.process,
    ...(definition.reverse ? { reverse: definition.reverse } : {}),
    ...(definition.createStream ? { createStream: definition.createStream } : {}),
    ...(definition.reversible !== undefined ? { reversible: definition.reversible } : {}),
    streaming: definition.streaming === undefined
      ? typeof definition.createStream === 'function' : definition.streaming,
    ...(definition.retryOptions ? { retryOptions: Object.freeze({ ...definition.retryOptions }) } : {}),
  };
  getPluginCapabilities(plugin);
  return Object.freeze(plugin);
}
