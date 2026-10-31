import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const project = process.cwd();
const npm = process.env.npm_execpath;
assert.ok(npm, 'Run through npm to obtain npm_execpath');
const sandbox = await mkdtemp(join(tmpdir(), 'pipex-dual-consumer-'));
const entrypoints = ['.', './compression', './encryption', './hashing', './validation', './parallel', './native', './plugins/kms'];
const modules = ['@snyxex/pipex', ...entrypoints.slice(1).map(s => '@snyxex/pipex/' + s.slice(2))];
const run = (cmd, args, cwd = sandbox) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

try {
  const metadata = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--dry-run', '--json', '--ignore-scripts'], {cwd:project, encoding:'utf8'}));
  const paths = metadata[0].files.map(file => file.path);
  const allowed = new Set(['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md']);
  for (const path of paths) assert.ok(allowed.has(path) || path.startsWith('dist/'), 'Unexpected npm file: ' + path);
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  for (const subpath of entrypoints) {
    const target = manifest.exports[subpath];
    assert.ok(target?.import?.types && target?.require?.types && target?.import?.default && target?.require?.default, subpath);
    for (const file of [target.import.types, target.require.types, target.import.default, target.require.default]) {
      assert.ok(paths.includes(file.replace(/^\.\//, '')), 'Missing packed export ' + file);
    }
  }
  const archiveDir = join(sandbox, 'archive');
  await import('node:fs/promises').then(fs => fs.mkdir(archiveDir));
  const archive = execFileSync(process.execPath, [npm, 'pack', '--ignore-scripts', '--pack-destination', archiveDir], {cwd:project, encoding:'utf8'}).trim().split('\n').at(-1);
  await writeFile(join(sandbox, 'package.json'), JSON.stringify({name:'pipex-dual-consumer',private:true,type:'module'}));
  run(process.execPath, [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(archiveDir, archive)]);
  for (const specifier of modules) {
    run(process.execPath, ['--input-type=module','--eval', 'const m=await import('+JSON.stringify(specifier)+'); if(!Object.keys(m).length)throw Error("Empty import");']);
    run(process.execPath, ['--eval', 'const m=require('+JSON.stringify(specifier)+'); if(!Object.keys(m).length)throw Error("Empty require");']);
  }
  await writeFile(join(sandbox,'esm.mts'), 'import { DataEngine } from "@snyxex/pipex"; import { CompressionPlugin } from "@snyxex/pipex/compression"; const e: DataEngine = new DataEngine().use(new CompressionPlugin({type:"gzip"})); void e;\n');
  await writeFile(join(sandbox,'cjs.cts'), 'import { DataEngine } from "@snyxex/pipex"; import { HashingPlugin } from "@snyxex/pipex/hashing"; const e: DataEngine = new DataEngine().use(new HashingPlugin({algorithm:"sha256",secret:"not-a-production-secret"})); void e;\n');
  const typescript = resolve(project, 'node_modules/typescript/bin/tsc');
  run(process.execPath,[typescript,'--strict','--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','--skipLibCheck','esm.mts','cjs.cts']);
  console.log('Dry-run package allowlist and fresh ESM, CJS, TypeScript consumers passed.');
} finally {
  await rm(sandbox,{recursive:true,force:true});
}
