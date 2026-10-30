# PipeX coding agent instructions

Before working on PipeX, read [skills/README.md](skills/README.md) and select the relevant `skills/*/SKILL.md` files. For any public API usage, also read [skills/api-reference-navigation/SKILL.md](skills/api-reference-navigation/SKILL.md).

## Project invariants
- PipeX is a Node.js ESM data transformation engine, not a durable queue, scheduler, or transport.
- Use the public exports from `src/index.ts` and installed package; do not invent APIs.
- `binary.pack/unpack` and stream/file pack/unpack are serialization only, not encryption.
- Received `binary.undo` results require an application-owned trusted `expectedType`.
- Preserve `dlq`/`setDlq()` semantics as caller-owned failure sinks; no internal storage or replay.
- Protect encryption keys, output roots, file boundaries, limits, cancellation and stream backpressure.
- Never run untrusted PR code on shared Jenkins agents; Jenkins is the CI system.
- Never publish to npm, merge, or tag releases without explicit approval.

## Development
Read `README.md`, `docs/enterprise.md`, `src/core/types.ts`, controllers and tests as needed. Run `npm run quality:ci` for the standard checks. Run `node scripts/validate-ai-skills.mjs` when changing skills. Report actual execution status, not assumed success.
