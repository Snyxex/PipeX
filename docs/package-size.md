# npm package size optimization

## Baseline and measurement limits

The previously reported unpacked size was **443.1 kB** (npm package UI). The local attempt to fetch and dry-run the published package failed with registry DNS `EAI_AGAIN`; published v1.0.2's exact per-file inventory was not available in this environment. Recent Jenkins logs indicate that `.map` files represent a substantial part of the ESM and CJS artifacts.

**Implementation:** `tsdown` disables source maps, and `package.json.files` narrows the list to runtime ESM/CJS chunks and `.d.mts`/`.d.cts` declaration artifacts, plus README/CHANGELOG/LICENSE. No tests, source, TS configs or CI files should be included. Type declarations remain essential. Both runtime formats remain essential for documented ESM and CommonJS support.

## Run and verify

```sh
npm ci --ignore-scripts
npm run build
npm run report:bundle-size
npm run test:dual-package
npm run test:package:built
npm run test:consumer:built
```

The report command actually calls `npm pack --dry-run --json --ignore-scripts` using the local npm CLI, lists every packed file and its byte size, checks for maps and forbidden source/config/test directories, and writes `bundle-size-report.md` (untracked output). Its four entry reports are **static imported-JS footprints**, not installed npm sizes or actual bundle contents created by a downstream bundler.

## Dependencies and architecture

| Dependency | Current use | Splitting possibility |
| --- | --- | --- |
| `msgpackr` | Core serialization | Keep in core |
| `zod` | Optional validation plugin / schema typing | Potential validation adapter package; dependent code refactor required |
| `piscina` | Optional worker pool plugin | Potential worker adapter package |
| `koffi` | Native features | Potential native adapter package |

The current root module imports and registers plugins eagerly; subpath imports change consumer import graph but **do not remove direct npm dependencies**. Removing or moving packages without refactoring/compatibility tests would be breaking.

## Estimated impact, not a measurement

Based on the broad build file mix, excluding ESM/CJS source maps could plausibly save **160–240 kB** of the existing **443.1 kB** unpacked size, leaving approximately **203–283 kB** (about **36–54%** smaller). Exact savings must be taken from the generated pack report after CI and from the published npm version. The installed `node_modules` footprint will still be dominated by dependencies and transitive packages.
