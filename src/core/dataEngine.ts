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
import type { ProcessorPlugin } from './types.js';
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
  // Plugins are readonly from outside; controllers access via #plugins
  readonly #plugins: ProcessorPlugin[] = [];

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
  startRequest(): string {
    const requestId = randomUUID();
    this.emit('start', requestId);
    return requestId;
  }

  /** Emits 'end' with optional duration. */
  endRequest(requestId: string, durationMs?: number): void {
    this.emit('end', requestId, durationMs);
  }

  /** Emits 'progress'. */
  emitProgress(bytes: number, requestId: string): void {
    this.emit('progress', bytes, requestId);
  }

  /** Normalises unknown throws → Error and emits 'error'. */
  emitError(err: unknown, requestId: string): void {
    const error = err instanceof Error ? err : new Error(String(err));
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