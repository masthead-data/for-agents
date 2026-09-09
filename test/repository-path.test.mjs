import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveRepositoryPath } from '../scripts/repository-path.mjs';

const rootDir = path.resolve('repository-path-test-root');

test('resolves ordinary and nested repository-relative paths', () => {
  assert.equal(
    resolveRepositoryPath(rootDir, 'plugin.json'),
    path.join(rootDir, 'plugin.json')
  );
  assert.equal(
    resolveRepositoryPath(rootDir, 'skills/example/SKILL.md'),
    path.join(rootDir, 'skills', 'example', 'SKILL.md')
  );
});

test('rejects paths outside the repository', () => {
  assert.equal(resolveRepositoryPath(rootDir, '../outside.json'), null);

  const siblingPath = path.relative(
    rootDir,
    path.join(path.dirname(rootDir), `${path.basename(rootDir)}-sibling`, 'config.json')
  );
  assert.equal(resolveRepositoryPath(rootDir, siblingPath), null);
});

test('rejects absolute paths both inside and outside the repository', () => {
  assert.equal(resolveRepositoryPath(rootDir, path.join(rootDir, 'plugin.json')), null);
  assert.equal(resolveRepositoryPath(rootDir, path.resolve(rootDir, '..', 'outside.json')), null);
});
