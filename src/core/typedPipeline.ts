/**
 * Strongly typed, in-process application transforms. This API is separate from
 * DataEngine's binary plugin chain, which always processes Buffer payloads.
 */
import type { OperationOptions } from './types.js';
import { OperationAbortedError } from './errors.js';

/** A synchronous or asynchronous transformation from Input to Output. */
export type TypedTransform<Input, Output> =
  (input: Input, options: Readonly<OperationOptions>) => Output | Promise<Output>;

/** Cancellation options for typed application pipelines. */
export type TypedPipelineOptions = Readonly<OperationOptions>;

/** An immutable pipeline whose input and output types are preserved across steps. */
export class TypedPipeline<Input, Output> {
  private constructor(
    private readonly transforms: readonly TypedTransform<never, unknown>[],
  ) {}

  /**
   * Start a pipeline from an initial typed transform.
   * @param transform First transformation; its input type becomes the pipeline input.
   */
  static from<Input, Output>(transform: TypedTransform<Input, Output>): TypedPipeline<Input, Awaited<Output>> {
    // The runtime invokes each function with the preceding step's output.
    // Type safety is enforced at the public pipe() boundary.
    return new TypedPipeline<Input, Awaited<Output>>([transform as TypedTransform<never, unknown>]);
  }

  /**
   * Append a transform. Its input must accept this pipeline's current output.
   * The returned pipeline infers the appended asynchronous or synchronous output.
   */
  pipe<Next>(transform: TypedTransform<Output, Next>): TypedPipeline<Input, Awaited<Next>> {
    return new TypedPipeline<Input, Awaited<Next>>([...this.transforms, transform as TypedTransform<never, unknown>]);
  }

  /** Execute all transforms in order, honouring cancellation between awaits. */
  async run(input: Input, options: TypedPipelineOptions = {}): Promise<Output> {
    let current: unknown = input;
    const signal = options.signal;
    const check = () => {
      if (signal?.aborted) throw new OperationAbortedError();
    };
    check();
    for (const transform of this.transforms) {
      check();
      const pending = Promise.resolve(transform(current as never, options));
      if (signal) {
        current = await new Promise<unknown>((resolve, reject) => {
          const onAbort = () => reject(new OperationAbortedError());
          signal.addEventListener('abort', onAbort, { once: true });
          pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort)).catch(() => {});
          if (signal.aborted) onAbort();
        });
      } else {
        current = await pending;
      }
    }
    check();
    // At runtime every step has been checked at the typed pipe boundary.
    return current as Output;
  }
}

/** Create a typed pipeline with automatic end-to-end transform inference. */
export function typedPipeline<Input, Output>(first: TypedTransform<Input, Output>): TypedPipeline<Input, Awaited<Output>> {
  return TypedPipeline.from(first);
}
