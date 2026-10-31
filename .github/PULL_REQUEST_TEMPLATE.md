## Summary

What changed, why, and which issue does this address?

## Public API and compatibility

- [ ] No breaking API/ESM/CJS/declaration changes, or migration steps are documented.
- [ ] Relevant README, API docs, changelog and runnable examples are updated.

## Verification

- [ ] `npm ci --ignore-scripts --no-audit --no-fund`
- [ ] `npm run typecheck` and `npm run build`
- [ ] `npm run quality:ci`
- [ ] `npm run lint:ci` and `npm run typecheck:ci` (where available)
- [ ] `npm run test:examples` for affected examples
- [ ] `node scripts/validate-ai-skills.mjs` for AI skill edits
- [ ] Tested on Node.js versions/OS noted below (do not claim untested targets)

**Versions and platforms tested:**

**Checks omitted and reasons:**

## Security and review

- [ ] No keys, credentials, tokens, `.env` data or private infrastructure details added.
- [ ] Files, streams, input limits, cancellation, backpressure and cryptographic invariants reviewed where relevant.
- [ ] This PR does not disclose a privately reportable vulnerability.
- [ ] Jenkins is the only CI system; no GitHub Actions workflows added.

**Residual risks and migration notes:**

> For vulnerabilities, follow [SECURITY.md](../SECURITY.md) privately.
