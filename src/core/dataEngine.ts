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
import { Readable, Writable }   from 'node:stream';
import { z }                    from 'zod';
import type { 
  ProcessorPlugin, 
  Logger, 
  Tracer,
  AuditLogger,
  AuditRecord,
  SchemaRegistry,
  EngineConfig
} from './types.js';
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

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DataEngine extends EventEmitter {
  /** Built-in plugin registry for config-driven bootstrap. */
  private static readonly pluginRegistry = new Map<string, any>();

  /** Register a plugin class for use in fromConfig(). */
  public static registerPlugin(name: string, pluginClass: any): void {
    this.pluginRegistry.set(name, pluginClass);
  }

  /**
   * Bootstrap a DataEngine from a configuration object.
   */
  public static async fromConfig(config: EngineConfig): Promise<DataEngine> {
    const engine = new DataEngine();
    
    if (config.plugins) {
      for (const p of config.plugins) {
        const PluginClass = this.pluginRegistry.get(p.name);
        if (!PluginClass) throw new Error(`[PipeX] Unknown plugin in config: ${p.name}`);
        engine.use(new PluginClass(p.options));
      }
    }

    return engine;
  }

  // Plugins are readonly from outside; controllers access via #plugins
  readonly #plugins: ProcessorPlugin[] = [];
  #schema?: z.ZodType<any>;
  #registry?: SchemaRegistry;
  #logger?: Logger;
  #tracer?: Tracer;
  #dlq?:    Writable;
  #auditLogger?: AuditLogger;

  // ── Controllers ─────────────────────────────────────────────────────────────
  readonly file:   FileController;
  readonly binary: BinaryController;
  readonly stream: StreamController;

  constructor() {
    super();
    this.file   = new FileController(this);
    this.binary = new BinaryController(this);
    this.stream = new StreamController(this);
  }

  /** 
   * Set a Dead Letter Queue (DLQ) stream. 
   * When a plugin fails and retries are exhausted, the original chunk 
   * will be written to this stream instead of crashing the pipeline.
   * 
   * @param stream The writable stream to use as a DLQ.
   */
  setDlq(stream: Writable): this {
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
        pluginChain: this.#plugins.map(p => `${p.name}@${p.version}`),
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
    this.#plugins.push(plugin);
    return this;
  }

  /**
   * Read-only view of the registered plugins.
   * Exposed so controllers can iterate without mutating the list.
   */
  get plugins(): readonly ProcessorPlugin[] {
    return this.#plugins;
  }

  // ── Request lifecycle (called by controllers) ────────────────────────────────

  /** Generates a requestId, emits 'start', returns the id. */
  startRequest(metadata: Record<string, unknown> = {}): string {
    const requestId = randomUUID();
    this.#logger?.info(`[PipeX] Request started: ${requestId}`, { requestId, ...metadata });
    this.emit('start', requestId);
    return requestId;
  }

  /** Emits 'end' with optional duration. */
  endRequest(requestId: string, durationMs?: number): void {
    this.#logger?.info(`[PipeX] Request ended: ${requestId}`, { requestId, durationMs });
    this.emit('end', requestId, durationMs);
  }

  /** Emits 'progress'. */
  emitProgress(bytes: number, requestId: string): void {
    this.emit('progress', bytes, requestId);
  }

  /** Normalises unknown throws → Error and emits 'error'. */
  emitError(err: unknown, requestId: string): void {
    const error = err instanceof Error ? err : new Error(String(err));
    this.#logger?.error(`[PipeX] Request failed: ${requestId}`, { 
      requestId, 
      error: error.message,
      stack: error.stack 
    });
    this.emit('error', error, requestId);
  }

  // ── EventEmitter typed overrides ─────────────────────────────────────────────

  override emit<K extends keyof PipeXEventMap>(
    event: K,
    ...args: PipeXEventMap[K]
  ): boolean {
    return super.emit(event, ...args);
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
