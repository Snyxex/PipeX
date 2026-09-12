export type PipeXErrorCode =
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
  | 'WORKER_TASK_FAILURE';

export class PipeXError extends Error {
  public override readonly name: string = 'PipeXError';

  constructor(
    public readonly code: PipeXErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
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

export class OperationAbortedError extends PipeXError {
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

export class WorkerTaskError extends PipeXError {
  public override readonly name: string = 'WorkerTaskError';
  constructor(public readonly taskName: string, options?: ErrorOptions) {
    super('WORKER_TASK_FAILURE', `[PipeX] Worker task ${taskName} failed`, options);
  }
}
