# Encryption v4 migration

`EncryptionPlugin` v4 introduces the versioned `PXAE` authenticated-frame
format. `KmsEncryptionPlugin` v2 similarly introduces the versioned `PXKM`
envelope. Both changes alter newly written ciphertext and are semver-major at
the plugin/data-format boundary.

## Why the format changed

The old encryption packet stored one algorithm byte, IV, authentication tag,
and ciphertext. A stream therefore had to buffer the complete input or output,
and its header was not authenticated. The old KMS envelope likewise lacked a
version and did not authenticate its length and key-envelope metadata.

The new formats provide:

- explicit magic, format version, algorithm, and bounded lengths;
- authenticated headers and metadata;
- a random 128-bit salt and HKDF-SHA256-derived key per `PXAE` stream;
- a deterministic nonce derived from the frame sequence under that per-stream
  key;
- independently authenticated data frames and an authenticated final frame;
- rejection of reordered, duplicated, trailing, and truncated frames.

`maxFrameBytes` includes the 13-byte frame header and 16-byte authentication
tag. The default plaintext frame size is 64 KiB and is automatically reduced
when the configured frame limit is smaller. `maxFrames`, aggregate input, and
aggregate output limits are checked before frame allocation and cryptography.

## Rolling migration

1. Deploy v4 readers while leaving `allowLegacyDecrypt` at its default `true`.
2. New writes immediately use `PXAE` or `PXKM`; no legacy ciphertext is emitted.
3. Re-encrypt retained legacy records by decrypting them with the migration
   reader and writing them again with the current plugin.
4. After all retained ciphertext has been migrated, set
   `allowLegacyDecrypt: false` on both encryption plugin types.

Legacy stream decryption is compatibility-only and still buffers the complete
legacy packet up to the configured aggregate limit. Disable it after migration
to guarantee framed, bounded-memory decryption for every accepted stream.

Do not infer whole-message success from receiving the first plaintext frame.
Every emitted frame has passed its own authentication, but the operation is
complete only when the authenticated final frame and stream completion succeed.
