import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const skillRoot = join(root, 'skills');
const catalog = readFileSync(join(skillRoot, 'README.md'), 'utf8');
const names = readdirSync(skillRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();

assert.ok(names.length >= 24, 'Expected all documented PipeX skills');
for (const name of names) {
  const path = join(skillRoot, name, 'SKILL.md');
  assert.ok(existsSync(path), `Missing skill file: ${name}`);
  const text = readFileSync(path, 'utf8');
  assert.match(text, /^---\r?\nname: [a-z0-9-]+\r?\ndescription: .+\r?\n---\r?\n/, `Invalid frontmatter: ${name}`);
  assert.match(text, new RegExp(`^name: ${name}$`, 'm'), `Skill name mismatch: ${name}`);
  assert.ok(catalog.includes(`(${name}/SKILL.md)`), `Missing catalog entry: ${name}`);
}
for (const path of ['AGENTS.md', 'CLAUDE.md']) {
  assert.ok(existsSync(join(root, path)), `Missing agent entrypoint: ${path}`);
}
for (const path of ['skills/README.md', 'AGENTS.md', 'CLAUDE.md']) {
  const absolute = join(root, path);
  const text = readFileSync(absolute, 'utf8');
  for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    const link = match[1];
    if (/^[a-z]+:/i.test(link)) continue;
    assert.ok(existsSync(resolve(dirname(absolute), link)), `Broken link in ${path}: ${link}`);
  }
}
console.log(`Validated ${names.length} PipeX AI skills, agent entrypoints, and catalog links.`);
