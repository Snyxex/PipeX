export type PipeXErrorCode =
  | 'VALIDATION_FAILED'
  | 'COMPRESSION_FAILED'
  | 'ENCRYPTION_FAILED'
  | 'HASHING_FAILED'
  | 'UNSUPPORTED_ALGORITHM'
  | 'UNSUPPORTED_REVERSE'
  | 'UNSUPPORTED_STREAMING'
  | 'INVALID_PLUGIN_CAPABILITY'
  | 'OPERATION_ABORTED'
  | 'OPERATION_TIMEOUT'
  | 'KMS_PROVIDER_FAILURE'
  | 'KMS_AUTHENTICATION_FAILED'
  | 'KMS_PROVIDER_AUTHENTICATION_FAILED'
  | 'KMS_PROVIDER_UNAVAILABLE'
  | 'UNSUPPORTED_KMS_OPERATION'
  | 'INVALID_KMS_PROVIDER_CAPABILITY'
  | 'WORKER_POOL_CLOSED'
  | 'WORKER_QUEUE_FULL'
  | 'WORKER_POOL_CLOSE_FAILURE'
  | 'WORKER_TASK_FAILURE';

export class PipeXError extends Error {
  public override readonly name: string = 'PipeXError';

  readonly transformName?: string;
  readonly stage?: string;
  constructor(
    public readonly code: PipeXErrorCode,
    message: string,
    options?: ErrorOptions & { transformName?: string; stage?: string },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.transformName = options?.transformName;
    this.stage = options?.stage;
  }
}


/** Domain failures use fixed, non-sensitive messages. Never include input, keys or arbitrary provider errors. */
export class ValidationError extends PipeXError {
  override readonly name = 'ValidationError';
  constructor(options?: ErrorOptions & { transformName?: string; stage?: string }) {
    super('VALIDATION_FAILED', '[PipeX] Validation failed', options);
  }
}
export class CompressionError extends PipeXError {
  override readonly name = 'CompressionError';
  constructor(options?: ErrorOptions & { transformName?: string; stage?: string }) {
    super('COMPRESSION_FAILED', '[PipeX] Compression failed', options);
  }
}
export class EncryptionError extends PipeXError {
  override readonly name = 'EncryptionError';
  constructor(options?: ErrorOptions & { transformName?: string; stage?: string }) {
    super('ENCRYPTION_FAILED', '[PipeX] Encryption failed', options);
  }
}
export class HashingError extends PipeXError {
  override readonly name = 'HashingError';
  constructor(options?: ErrorOptions & { transformName?: string; stage?: string }) {
    super('HASHING_FAILED', '[PipeX] Hashing failed', options);
  }
}
export class UnsupportedAlgorithmError extends PipeXError {
  override readonly name = 'UnsupportedAlgorithmError';
  constructor(options?: ErrorOptions & { transformName?: string; stage?: string }) {
    super('UNSUPPORTED_ALGORITHM', '[PipeX] Unsupported algorithm', options);
  }
}
/** Alias hierarchy: existing OperationAbortedError retains its code and instanceof contract. */
export class PipelineAbortedError extends PipeXError {
  override readonly name: string = 'PipelineAbortedError';
  constructor(options?: ErrorOptions & { transformName?: string; stage?: string }) {
    super(options);
  }
}

export class UnsupportedReverseError extends PipeXError {
  public override readonly name: string = 'UnsupportedReverseError';

  constructor(public readonly plugin: string) {
    super('UNSUPPORTED_REVERSE', `[PipeX] Plugin ${plugin} does not support reverse operations`);
  }
}

export class UnsupportedStreamingError extends PipeXError {
  public override readonly name: string = 'UnsupportedStreamingError';
  constructor(public readonly plugin: string) {
    super('UNSUPPORTED_STREAMING', `[PipeX] Plugin ${plugin} does not support stream operations`);
  }
}

export type InvalidPluginCapabilityIssue =
  | 'MUST_BE_BOOLEAN'
  | 'MISSING_IMPLEMENTATION'
  | 'CONFLICTING_IMPLEMENTATION';

export class InvalidPluginCapabilityError extends PipeXError {
  public override readonly name: string = 'InvalidPluginCapabilityError';

  constructor(
    public readonly plugin: string,
    public readonly capability: 'reversible' | 'streaming',
    public readonly issue: InvalidPluginCapabilityIssue,
  ) {
    const details = issue === 'MUST_BE_BOOLEAN'
      ? 'must be a boolean when declared'
      : issue === 'MISSING_IMPLEMENTATION'
        ? 'is declared but its implementation is missing'
        : 'is disabled but its implementation is present';
    super(
      'INVALID_PLUGIN_CAPABILITY',
      `[PipeX] Plugin ${plugin} has an invalid ${capability} capability: ${details}`,
    );
  }
}

export class OperationAbortedError extends PipelineAbortedError {
  public override readonly name: string = 'OperationAbortedError';
  constructor(options?: ErrorOptions) {
    super('OPERATION_ABORTED', '[PipeX] Operation aborted', options);
  }
}

export class OperationTimeoutError extends PipeXError {
  public override readonly name: string = 'OperationTimeoutError';
  constructor(options?: ErrorOptions) {
    super('OPERATION_TIMEOUT', '[PipeX] Operation timed out', options);
  }
}

export class KmsProviderError extends PipeXError {
  public override readonly name: string = 'KmsProviderError';
  constructor(public readonly operation: 'generateDataKey' | 'decrypt' | 'encrypt', options?: ErrorOptions) {
    super('KMS_PROVIDER_FAILURE', `[PipeX] KMS ${operation} failed`, options);
  }
}

export class KmsAuthenticationError extends PipeXError {
  public override readonly name: string = 'KmsAuthenticationError';
  constructor() {
    super('KMS_AUTHENTICATION_FAILED', '[PipeX] KMS envelope authentication failed');
  }
}

export class KmsProviderAuthenticationError extends PipeXError {
  public override readonly name: string = 'KmsProviderAuthenticationError';
  constructor(public readonly operation: 'generateDataKey' | 'decrypt' | 'encrypt') {
    super('KMS_PROVIDER_AUTHENTICATION_FAILED', `[PipeX] KMS ${operation} authentication failed`);
  }
}

export class KmsProviderUnavailableError extends PipeXError {
  public override readonly name: string = 'KmsProviderUnavailableError';
  constructor(public readonly operation: 'generateDataKey' | 'decrypt' | 'encrypt') {
    super('KMS_PROVIDER_UNAVAILABLE', `[PipeX] KMS ${operation} provider unavailable`);
  }
}

export class UnsupportedKmsOperationError extends PipeXError {
  public override readonly name: string = 'UnsupportedKmsOperationError';
  constructor(public readonly operation: 'generateDataKey' | 'decrypt' | 'encrypt') {
    super('UNSUPPORTED_KMS_OPERATION', `[PipeX] KMS provider does not support ${operation}`);
  }
}

export type InvalidKmsProviderCapabilityIssue = 'MUST_BE_BOOLEAN' | 'MISSING_IMPLEMENTATION';

export class InvalidKmsProviderCapabilityError extends PipeXError {
  public override readonly name: string = 'InvalidKmsProviderCapabilityError';
  constructor(
    public readonly operation: 'generateDataKey' | 'decrypt' | 'encrypt',
    public readonly issue: InvalidKmsProviderCapabilityIssue,
  ) {
    const details = issue === 'MUST_BE_BOOLEAN'
      ? 'must be a boolean when declared'
      : 'is declared but its implementation is missing';
    super('INVALID_KMS_PROVIDER_CAPABILITY', `[PipeX] Invalid KMS ${operation} capability: ${details}`);
  }
}

export class WorkerPoolClosedError extends PipeXError {
  public override readonly name: string = 'WorkerPoolClosedError';
  constructor() {
    super('WORKER_POOL_CLOSED', '[PipeX] Worker pool is closed');
  }
}

export class WorkerQueueFullError extends PipeXError {
  public override readonly name: string = 'WorkerQueueFullError';
  constructor(public readonly maxQueue: number) {
    super('WORKER_QUEUE_FULL', `[PipeX] Worker queue is full (maximum ${maxQueue} waiting tasks)`);
  }
}

export class WorkerPoolCloseError extends PipeXError {
  public override readonly name: string = 'WorkerPoolCloseError';
  constructor(options?: ErrorOptions) {
    super('WORKER_POOL_CLOSE_FAILURE', '[PipeX] Worker pool failed to close cleanly', options);
  }
}

export class WorkerTaskError extends PipeXError {
  public override readonly name: string = 'WorkerTaskError';
  constructor(public readonly taskName: string, options?: ErrorOptions) {
    super('WORKER_TASK_FAILURE', `[PipeX] Worker task ${taskName} failed`, options);
  }
}
