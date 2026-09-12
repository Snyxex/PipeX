/**
 * DataEngine — the public surface of PipeX
 *
 * Responsibilities:
 *   1. Plugin registry (use / plugins)
 *   2. EventEmitter lifecycle (start, plugin:after, progress, error, end, manifest)
 *   3. Controller wiring (file, binary, stream)
 *   4. Request lifecycle helpers used by controllers (startRequest, endRequest, …)
 *
 * Zero I/O, zero stream logic — all of that lives in core.ts and controllers.
 */

import { EventEmitter }         from 'node:events';
import { randomUUID }           from 'node:crypto';
import { Writable }             from 'node:stream';
import { z }                    from 'zod';
import type { 
  ProcessorPlugin, 
  Logger, 
  Tracer,
  AuditLogger,
  AuditRecord,
  SchemaRegistry,
  EngineConfig
  , EngineLimits
  , OperationOptions
} from './types.js';
import { DEFAULT_LIMITS }       from './core.js';
import { FileController }       from './controllers/FileController.js';
import { BinaryController }     from './controllers/BinaryController.js';
import { StreamController }     from './controllers/StreamController.js';

// ─── Typed EventEmitter ───────────────────────────────────────────────────────

interface PipeXEventMap {
  start:          [requestId: string];
  'plugin:after': [name: string, durationMs: number];
  progress:       [bytes: number, requestId: string];
  error:          [err: Error, requestId: string];
  end:            [requestId: string, durationMs?: number];
  manifest:       [manifest: unknown, requestId?: string];
}

export type PluginConstructor<TOptions = unknown> = new (options: TOptions) => ProcessorPlugin;

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DataEngine extends EventEmitter {
  /** Built-in plugin registry for config-driven bootstrap. */
  private static readonly pluginRegistry = new Map<string, (options: unknown) => ProcessorPlugin>();

  /** Register a plugin class for use in fromConfig(). */
  public static registerPlugin<TOptions>(name: string, pluginClass: PluginConstructor<TOptions>): void {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(name) || typeof pluginClass !== 'function') {
      throw new Error('[PipeX] Invalid plugin registration');
    }
    this.pluginRegistry.set(name, options => new pluginClass(options as TOptions));
  }

  /**
   * Bootstrap a DataEngine from a configuration object.
   */
  public static async fromConfig(config: EngineConfig): Promise<DataEngine> {
    if (!config || typeof config !== 'object') throw new Error('[PipeX] Configuration must be an object');
    const engine = new DataEngine(config.limits);

    if (config.logger) engine.setLogger(config.logger);
    if (config.tracer) engine.setTracer(config.tracer);
    if (config.auditLogger) engine.setAuditLogger(config.auditLogger);
    if (config.dlq) engine.setDlq(config.dlq);
    if (config.schemaRegistry) engine.setSchemaRegistry(config.schemaRegistry);
    if (config.schema) engine.setSchema(config.schema);
    
    if (config.plugins) {
      if (!Array.isArray(config.plugins)) throw new Error('[PipeX] Configuration plugins must be an array');
      for (const p of config.plugins) {
        const createPlugin = this.pluginRegistry.get(p.name);
        if (!createPlugin) throw new Error(`[PipeX] Unknown plugin in config: ${p.name}`);
        try {
          engine.use(createPlugin(p.options));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`[PipeX] Failed to initialize plugin "${p.name}": ${message}`, { cause: error });
        }
      }
    }

    return engine;
  }

  // Plugins are readonly from outside; controllers access via #plugins
  readonly #plugins: ProcessorPlugin[] = [];
  #pluginView: readonly ProcessorPlugin[] = Object.freeze([]);
  #schema?: z.ZodType<any>;
  #registry?: SchemaRegistry;
  #logger?: Logger;
  #tracer?: Tracer;
  #dlq?:    Writable;
  #auditLogger?: AuditLogger;
  #limits: EngineLimits;
  readonly #activeRequests = new Set<string>();

  // ── Controllers ─────────────────────────────────────────────────────────────
  readonly file:   FileController;
  readonly binary: BinaryController;
  readonly stream: StreamController;

  constructor(limits: Partial<EngineLimits> = {}) {
    super();
    this.#limits = { ...DEFAULT_LIMITS, ...limits };
    this.#validateLimits(this.#limits);
    this.file   = new FileController(this);
    this.binary = new BinaryController(this);
    this.stream = new StreamController(this);
  }

  #validateLimits(limits: EngineLimits): void {
    for (const [name, value] of Object.entries(limits)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`[PipeX] Invalid engine limit ${name}`);
      }
    }
    if (limits.maxInputBytes < 1 || limits.maxOutputBytes < 1 || limits.maxFrameBytes < 1
      || limits.maxFrames < 1 || limits.maxConcurrentOperations < 1 || limits.maxRetryAttempts < 1) {
      throw new Error('[PipeX] Engine limits must be positive');
    }
  }

  get limits(): Readonly<EngineLimits> {
    return this.#limits;
  }

  setLimits(limits: Partial<EngineLimits>): this {
    const next = { ...this.#limits, ...limits };
    this.#validateLimits(next);
    this.#limits = next;
    return this;
  }

  createOperationSignal(options: OperationOptions = {}): AbortSignal {
    const timeoutMs = options.timeoutMs ?? this.#limits.operationTimeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
      throw new Error('[PipeX] Invalid operation timeout');
    }
    const signals = options.signal ? [options.signal] : [];
    if (timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
    return signals.length === 0 ? new AbortController().signal : AbortSignal.any(signals);
  }

  /** 
   * Set a Dead Letter Queue (DLQ) stream. 
   * When a plugin fails and retries are exhausted, the original chunk 
   * will be written to this stream instead of crashing the pipeline.
   * 
   * @param stream The writable stream to use as a DLQ.
   */
  setDlq(stream: Writable): this {
    if (!stream || typeof stream.write !== 'function') throw new Error('[PipeX] DLQ must be a writable stream');
    this.#dlq = stream;
    return this;
  }

  /** The current DLQ stream, if any. */
  get dlq(): Writable | undefined {
    return this.#dlq;
  }

  /** 
   * Set the engine's logger for structured observability. 
   * Compatible with Pino, Winston, or any logger implementing the Logger interface.
   * 
   * @param logger The logger instance.
   */
  setLogger(logger: Logger): this {
    if (!logger || !['info', 'warn', 'error', 'debug'].every(level => typeof logger[level as keyof Logger] === 'function')) {
      throw new Error('[PipeX] Logger must implement info, warn, error, and debug');
    }
    this.#logger = logger;
    return this;
  }

  /** The current logger instance. */
  get logger(): Logger | undefined {
    return this.#logger;
  }

  /** 
   * Set the engine's tracer for OpenTelemetry-compatible tracing. 
   * 
   * @param tracer The tracer instance.
   */
  setTracer(tracer: Tracer): this {
    if (!tracer || typeof tracer.startSpan !== 'function') throw new Error('[PipeX] Tracer must implement startSpan');
    this.#tracer = tracer;
    return this;
  }

  /** The current tracer instance. */
  get tracer(): Tracer | undefined {
    return this.#tracer;
  }

  /** 
   * Set the engine's audit logger for compliance and security auditing. 
   * 
   * @param logger The audit logger instance.
   */
  setAuditLogger(logger: AuditLogger): this {
    if (!logger || typeof logger.log !== 'function') throw new Error('[PipeX] Audit logger must implement log');
    this.#auditLogger = logger;
    return this;
  }

  /** 
   * Emits an audit record if an audit logger is configured. 
   * This is called automatically by controllers.
   * 
   * @param record The audit record metadata.
   */
  async emitAudit(record: Omit<AuditRecord, 'pluginChain' | 'timestamp'>): Promise<void> {
    if (this.#auditLogger) {
      await this.#auditLogger.log({
        ...record,
        pluginChain: this.#pluginView.map(p => `${p.name}@${p.version}`),
        timestamp: Date.now(),
      });
    }
  }

  /** 
   * Set a Schema Registry to fetch schemas dynamically.
   * 
   * @param registry The schema registry provider.
   */
  setSchemaRegistry(registry: SchemaRegistry): this {
    if (!registry || typeof registry.getSchema !== 'function') throw new Error('[PipeX] Schema registry must implement getSchema');
    this.#registry = registry;
    return this;
  }

  /** 
   * Fetch a schema from the registry and set it as the engine's active schema. 
   * 
   * @param subject The name of the schema to fetch.
   * @param version Optional version of the schema.
   */
  async loadSchema(subject: string, version?: number): Promise<void> {
    if (!this.#registry) throw new Error('[PipeX] No Schema Registry configured');
    const schema = await this.#registry.getSchema(subject, version);
    this.setSchema(schema);
  }

  /**
   * Set a global Zod schema for input/output validation.
   * When set, controllers will automatically validate data against this schema.
   */
  setSchema(schema: z.ZodType<any>): this {
    if (!schema || typeof schema.safeParse !== 'function') throw new Error('[PipeX] Schema must implement safeParse');
    this.#schema = schema;
    return this;
  }

  get schema(): z.ZodType<any> | undefined {
    return this.#schema;
  }

  /** Validates data against the registered schema (if any). Throws on failure. */
  validate(data: unknown): void {
    if (this.#schema) {
      const result = this.#schema.safeParse(data);
      if (!result.success) {
        throw new Error(`[PipeX] Core Validation failed: ${result.error.message}`);
      }
    }
  }

  // ── Plugin registry ──────────────────────────────────────────────────────────

  /** Register a plugin and return this for fluent chaining. */
  use(plugin: ProcessorPlugin): this {
    if (!plugin || typeof plugin.name !== 'string' || plugin.name.length === 0 || plugin.name.length > 128
      || typeof plugin.version !== 'string' || plugin.version.length === 0
      || typeof plugin.process !== 'function') {
      throw new Error('[PipeX] Invalid processor plugin');
    }
    if (this.#activeRequests.size > 0) {
      throw new Error('[PipeX] Cannot modify the plugin pipeline while operations are active');
    }
    if (this.#plugins.length >= 256) throw new Error('[PipeX] Maximum plugin count exceeded');
    this.#plugins.push(plugin);
    this.#pluginView = Object.freeze([...this.#plugins]);
    return this;
  }

  /**
   * Read-only view of the registered plugins.
   * Exposed so controllers can iterate without mutating the list.
   */
  get plugins(): readonly ProcessorPlugin[] {
    return this.#pluginView;
  }

  /** Human-readable plugin identifiers in execution order. */
  get pipeline(): readonly string[] {
    return Object.freeze(this.#pluginView.map(plugin => `${plugin.name}@${plugin.version}`));
  }

  // ── Request lifecycle (called by controllers) ────────────────────────────────

  /** Generates a requestId, emits 'start', returns the id. */
  startRequest(metadata: Record<string, unknown> = {}): string {
    if (this.#activeRequests.size >= this.#limits.maxConcurrentOperations) {
      throw new Error('[PipeX] Maximum concurrent operations exceeded');
    }
    const requestId = randomUUID();
    this.#activeRequests.add(requestId);
    try { this.#logger?.info('[PipeX] Request started', { requestId, ...metadata }); } catch { /* logger isolation */ }
    this.emit('start', requestId);
    return requestId;
  }

  /** Emits 'end' with optional duration. */
  endRequest(requestId: string, durationMs?: number): void {
    this.#activeRequests.delete(requestId);
    try { this.#logger?.info('[PipeX] Request ended', { requestId, durationMs }); } catch { /* logger isolation */ }
    this.emit('end', requestId, durationMs);
  }

  /** Emits 'progress'. */
  emitProgress(bytes: number, requestId: string): void {
    this.emit('progress', bytes, requestId);
  }

  /** Normalises unknown throws → Error and emits 'error'. */
  emitError(err: unknown, requestId: string): void {
    const error = err instanceof Error ? err : new Error(String(err));
    this.#activeRequests.delete(requestId);
    try { this.#logger?.error('[PipeX] Request failed', { requestId, error: error.message }); } catch { /* logger isolation */ }
    if (this.listenerCount('error') > 0) this.emit('error', error, requestId);
  }

  // ── EventEmitter typed overrides ─────────────────────────────────────────────

  override emit<K extends keyof PipeXEventMap>(
    event: K,
    ...args: PipeXEventMap[K]
  ): boolean {
    // Observability hooks must never take down data processing. A user-supplied
    // listener is outside the pipeline's trust boundary and may throw.
    try {
      return super.emit(event, ...args);
    } catch (error) {
      try {
        this.#logger?.error('[PipeX] Event listener failed', {
          event: String(event),
          error: error instanceof Error ? error.message : String(error),
        });
      } catch { /* logger isolation */ }
      return false;
    }
  }

  override on<K extends keyof PipeXEventMap>(
    event: K,
    listener: (...args: PipeXEventMap[K]) => void,
  ): this {
    return super.on(event, listener as (...a: unknown[]) => void);
  }

  override once<K extends keyof PipeXEventMap>(
    event: K,
    listener: (...args: PipeXEventMap[K]) => void,
  ): this {
    return super.once(event, listener as (...a: unknown[]) => void);
  }
}
