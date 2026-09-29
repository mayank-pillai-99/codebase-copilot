export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function githubBlobUrl(
  repo: { owner: string; name: string },
  sha: string,
  path: string,
  startLine?: number,
  endLine?: number,
): string {
  const lines =
    startLine === undefined
      ? ''
      : endLine && endLine !== startLine
        ? `#L${startLine}-L${endLine}`
        : `#L${startLine}`;
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${repo.owner}/${repo.name}/blob/${sha}/${encodedPath}${lines}`;
}

export function percent(part: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((part / total) * 100)}%`;
}

const SKIP_LABELS: Record<string, string> = {
  'ignored-directory': 'dependency or build folders',
  lockfile: 'lockfiles',
  minified: 'minified',
  'source-map': 'source maps',
  'unsupported-type': 'other file types',
  'too-large': 'too large',
  binary: 'binary',
  generated: 'generated',
  'unsafe-path': 'unsafe paths',
  'not-a-regular-file': 'links',
};

export function describeSkipped(skipped: Record<string, number>): string | null {
  const parts = Object.entries(skipped)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([reason, count]) => `${count.toLocaleString('en-US')} ${SKIP_LABELS[reason] ?? reason}`);
  return parts.length ? `Skipped ${parts.join(', ')}.` : null;
}

/** Tests, fixtures and examples: real code, but rarely what someone onboarding wants first. */
export function isSupportingPath(path: string): boolean {
  // Next.js route files are endpoints even in a folder called "test" (/api/test).
  if (/(^|\/)(app\/.*\/route|pages\/api\/.*)\.[cm]?[jt]sx?$/.test(path)) return false;
  return (
    /(^|\/)(tests?|__tests__|spec|e2e|fixtures?|__mocks__|examples?|samples?|benchmarks?)\//i.test(
      path,
    ) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(path)
  );
}
