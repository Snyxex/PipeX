import type { KmsOperation, KmsProvider, KmsProviderCapabilities } from './types.js';
import { InvalidKmsProviderCapabilityError, UnsupportedKmsOperationError } from './errors.js';

const OPERATIONS = ['encrypt', 'decrypt', 'generateDataKey'] as const satisfies readonly KmsOperation[];

/**
 * Returns an immutable, runtime-validated view of a generic KMS provider.
 * Explicit false declarations support legacy provider stubs that exist only
 * to throw; such methods are never invoked through PipeX.
 */
export function getKmsProviderCapabilities(provider: KmsProvider): Readonly<KmsProviderCapabilities> {
  if (!provider || typeof provider !== 'object') throw new TypeError('[PipeX] Invalid KMS provider');
  if (provider.capabilities !== undefined
    && (!provider.capabilities || typeof provider.capabilities !== 'object')) {
    throw new TypeError('[PipeX] Invalid KMS provider capabilities');
  }

  const capabilities = {} as Record<KmsOperation, boolean>;
  for (const operation of OPERATIONS) {
    const declared = provider.capabilities?.[operation];
    const implemented = typeof provider[operation] === 'function';
    if (declared !== undefined && typeof declared !== 'boolean') {
      throw new InvalidKmsProviderCapabilityError(operation, 'MUST_BE_BOOLEAN');
    }
    if (declared === true && !implemented) {
      throw new InvalidKmsProviderCapabilityError(operation, 'MISSING_IMPLEMENTATION');
    }
    capabilities[operation] = declared ?? implemented;
  }
  return Object.freeze(capabilities);
}

export function supportsKmsOperation(provider: KmsProvider, operation: KmsOperation): boolean {
  if (!OPERATIONS.includes(operation)) throw new TypeError('[PipeX] Unknown KMS operation');
  return getKmsProviderCapabilities(provider)[operation];
}

export function assertKmsOperation(provider: KmsProvider, operation: KmsOperation): void {
  if (!supportsKmsOperation(provider, operation)) throw new UnsupportedKmsOperationError(operation);
}
