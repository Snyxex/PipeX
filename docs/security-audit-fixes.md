# Security audit corrections

This change addresses the eight findings and two integration defects in the
7 October 2026 audit. It does not change the AEAD or KMS ciphertext formats.

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| F1: plaintext in parser errors and mutable result type | Content-free conversion errors without parser causes; allowed type list; locally trusted Buffer identity or explicit application-owned expectedType for transported results. Null/undefined reject nonempty payloads. | audit-binary: E, EH and CEH with short/long secrets, modified types, raw JSON decoding and transported results |
| F2: leaked operation capacity | Validate result data/metadata before reserving capacity; idempotent request cleanup; safe tracer wrappers. | audit-binary: malformed results followed by healthy work with one slot |
| F3: incomplete deadlines/cancellation | Central abortable await, initial/final and post-synchronous deadline checks, typed abort/timeout errors, and accounting for still-running promises. Late results are discarded; capacity stays reserved until the underlying work settles. | audit-binary: deferred work, pre-abort, synchronous overrun and native gzip; audit-files: cancellation and retained capacity |
| F4: inconsistent binary limits | Final output bounds independent of plugin count; structural bounds before binary object decoding and validation decoding; output bounds for packing. | audit-binary, audit-parser and existing resource-limits suite |
| F5: mismatched MessagePack extension boundaries | Set/Error/RegExp consume their subsequent value inside the same scanned frame. Payload-only extensions have an explicit allowlist; record/bundle/reference/custom formats are excluded. Writers preserve supported contextual types and disable records, bundles and structured cloning. | audit-parser: exact/oversize and byte-fragmented extensions, unsupported references, and writer roundtrips |
| F6: filesystem path race | Native root/directory capabilities, no-follow/reparse-point handling, opened-object I/O, identity checks, handle-relative commit and cleanup. | audit-files: controlled directory exchange, hard-link aliases, failure cleanup and cancellation, on Windows and Linux |
| F7: observer process termination | Logger/tracer wrappers isolate synchronous throws and rejected promises; event delivery isolates each listener and retains once/removal semantics. Audit-sink errors remain visible. | audit-observers: isolated process with strict unhandled-rejection policy, listener lifecycle and audit failure |
| F8: inaccurate pipeline metadata | Capture the executed chain per request; build binary results from that snapshot; await audit before releasing normal completion capacity. | audit-binary: end-listener reconfiguration; controller audit lifecycle changes |
| Worker stream corruption | PXWK v1 length-prefixed records preserve task boundaries independently of transport chunking. Size/count limits and an end marker reject malformed frames. | worker integration: byte-fragmented transport, truncation/trailing/oversize cases and W-C-E-H roundtrip |
| Reverse validation mismatch | Stream reverse bypass honors validateOnReverse just like buffer reverse; decoded paths retain frame limits. | audit-parser: rejecting schema with reverse bypass in both APIs |

## Compatibility and operating requirements

- Received/reconstructed EngineResult objects require a trusted expectedType.
  Derive it from application configuration, never from received metadata.
  Locally produced results keep the convenience overload while Buffer identity
  is retained. Raw-buffer forceType must also be application-owned.
- WorkerPoolPlugin 5 changes only its stream representation. The binary worker
  transform remains raw. Existing unframed worker streams must be decoded with
  their original application/chunk contract before re-encoding; the new reader
  does not guess boundaries. See the worker migration section in enterprise.md.
- MessagePack readers retain supported Set, Error and RegExp extensions and
  bound each complete logical value. Structured references and custom
  extension registration are outside the wire profile.
- Koffi 3.3.2 and its matching platform binary provide file-controller bindings.
  Native loading is deferred until file use and has no path-only fallback.
  Keep roots under service-account control. See the file-system boundary in
  enterprise.md for the precise directory-capability and OS trust model.
- Non-cooperative plugin code cannot be forcibly stopped in-process. Deadlines
  stop waiting, while concurrency accounting prevents unlimited background
  admission. Use worker tasks when physical termination is required.

## Verification

The regression sources are in test/security/audit-*.test.mjs and
test/integration/worker.test.mjs. The original combination matrix is also
repeated separately: 192 C/E/H roundtrips, 960 manipulation/wrong-key checks,
six KMS orders, and the worker/validation combinations. Accepted outer
compression changes are required to preserve the exact plaintext; they do not
claim authentication of outer transport-container bytes.

The pre-existing deletion of .github/workflows/ci.yml is excluded from this
change. A full quality run of the working directory therefore fails the tooling
check for that missing file. Isolated validation copies restore that unchanged
file from HEAD solely as a test fixture, preserving the user's working tree.


Verified runtime matrix: Linux Node 20.19.0, 22.23.3 and 24.21.0, with npm
11.16.0. Each isolated quality run passed 111 tests across tooling, unit,
integration, security, package, external-consumer and performance suites.
Windows Node 26.3.0 also passed the full isolated 111-test quality suite,
including the Windows-specific handle path. Fresh packed and Git-installed
consumers additionally execute native file sessions on all four runtimes.

The repeated interaction matrix passed all 192 roundtrips and six mocked-KMS
orders. Of 960 manipulation/wrong-key cases, 928 rejected; the remaining 32
preserved exactly the original plaintext and involved unauthenticated outer
compression-container bytes. Worker stream reversibility and validation also
passed. A current npm audit reported zero advisories. Node 20's development
build dependencies emit engine/deprecation warnings even though the locked
build and consumer checks succeeded. macOS/BSD native paths and real cloud KMS
are not claimed as runtime-tested here.
