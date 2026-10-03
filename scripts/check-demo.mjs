import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

// Run after build:demo. CI builds with dummy Firebase configuration to prove
// that compile-time demo selection excludes the cloud adapter entirely.
const assets = await readdir(new URL('../dist/assets/', import.meta.url));
assert.ok(assets.some(name => name.startsWith('demo-') && name.endsWith('.js')), 'Demo adapter missing');
assert.ok(!assets.some(name => name.startsWith('firebase-')), 'Cloud adapter included in demo');
for (const name of assets.filter(name => name.endsWith('.js'))) {
  const source = await readFile(new URL(`../dist/assets/${name}`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /googleapis\.com|firebaseio\.com|demo-privacy-canary/, 'Firebase code/configuration leaked into demo');
}
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
assert.doesNotMatch(html, /(?:src|href)="\/assets\//, 'Assets would break on a project subpath');
console.log('Demo artifact verified: fictional adapter, no Firebase bundle, relative assets.');
