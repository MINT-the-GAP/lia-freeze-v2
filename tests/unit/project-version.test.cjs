const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '..', '..');
const expectedVersion = '1.0.0';

test('keeps every project release version explicitly pinned to 1.0.0', () => {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
  const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const header = readme.match(/^\uFEFF?\s*<!--([\s\S]*?)-->/)?.[1] ?? '';
  const readmeVersion = header.match(/^\s*version\s*:\s*(.*?)\s*$/im)?.[1] ?? null;

  assert.deepEqual({
    packageJson: packageJson.version,
    packageLock: packageLock.version,
    packageLockRoot: packageLock.packages?.['']?.version,
    readme: readmeVersion,
  }, {
    packageJson: expectedVersion,
    packageLock: expectedVersion,
    packageLockRoot: expectedVersion,
    readme: expectedVersion,
  });
});
