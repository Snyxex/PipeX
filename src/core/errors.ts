export type PipeXErrorCode =
  | 'UNSUPPORTED_REVERSE'
  | 'UNSUPPORTED_STREAMING'
  | 'OPERATION_ABORTED'
  | 'OPERATION_TIMEOUT'
  | 'KMS_PROVIDER_FAILURE'
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
  constructor(public readonly operation: 'generateDataKey' | 'decrypt', options?: ErrorOptions) {
    super('KMS_PROVIDER_FAILURE', `[PipeX] KMS ${operation} failed`, options);
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
