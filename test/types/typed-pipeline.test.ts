import { typedPipeline, TypedPipeline, CompressionPlugin, HashingPlugin, EncryptionPlugin } from '../../src/index.js';
import type { CompressionOptions, EncryptionOptions, HashingOptions, TypedTransform } from '../../src/index.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

const chain = typedPipeline((value: string) => value.length)
  .pipe(async (length) => length > 5)
  .pipe((large) => large ? 'large' : 'small');

type InputType = Parameters<typeof chain.run>[0];
type OutputType = Awaited<ReturnType<typeof chain.run>>;
type CheckInput = Assert<Equal<InputType, string>>;
type CheckOutput = Assert<Equal<OutputType, string>>;
void (0 as unknown as CheckInput);
void (0 as unknown as CheckOutput);
const result: Promise<string> = chain.run('hello');
void result;

// @ts-expect-error first stage only accepts string
chain.run(123);
// @ts-expect-error next stage must consume number (not object)
typedPipeline((text: string) => text.length).pipe((obj: { name: string }) => obj.name);

const none: CompressionOptions = { type: 'none' };
const gzip: CompressionOptions = { type: 'gzip', level: 6 };
const aes: EncryptionOptions = { algorithm: 'aes-256-gcm', key: Buffer.alloc(32) };
const hmac: HashingOptions = { algorithm: 'sha512', secret: 'a-long-enough-secret' };
new CompressionPlugin(none);
new CompressionPlugin(gzip);
new EncryptionPlugin(aes);
new HashingPlugin(hmac);
// @ts-expect-error pass-through compression cannot set level
const invalidNone: CompressionOptions = { type: 'none', level: 5 };
// @ts-expect-error unsupported encryption algorithm
const invalidEncryption: EncryptionOptions = { algorithm: 'aes-128-gcm', key: Buffer.alloc(16) };
// @ts-expect-error unsupported HMAC algorithm
const invalidHash: HashingOptions = { algorithm: 'md5', secret: 'long-enough-secret' };
void invalidNone; void invalidEncryption; void invalidHash;

const validStep: TypedTransform<number, Promise<number>> = async n => n * 2;
const inferred = typedPipeline((n: number) => n + 1).pipe(validStep);
type CheckAsync = Assert<Equal<Awaited<ReturnType<typeof inferred.run>>, number>>;
void (0 as unknown as CheckAsync);
void (null as unknown as TypedPipeline<number, number>);
