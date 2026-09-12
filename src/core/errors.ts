export type PipeXErrorCode = 'UNSUPPORTED_REVERSE';

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
