import path from 'node:path';

/**
 * Resolve a repository-relative path only when it remains within rootDir.
 *
 * This is a lexical check and does not resolve symlinks.
 */
export function resolveRepositoryPath(rootDir, requestedPath) {
  if (typeof requestedPath !== 'string' || path.isAbsolute(requestedPath)) {
    return null;
  }

  const resolvedRootDir = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRootDir, requestedPath);
  const relativePath = path.relative(resolvedRootDir, resolvedPath);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  return resolvedPath;
}
