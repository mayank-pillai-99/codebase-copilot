import { z } from 'zod';

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit from a /tree/… or /commit/… URL, if present. */
  ref?: string;
}

// GitHub's own rules: owners are alphanumeric with single hyphens, up to 39 chars.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Accepts `https://github.com/owner/repo` (with optional `.git`, trailing slash,
 * `/tree/<ref>` or `/commit/<sha>`), the same without a scheme, or `owner/repo`.
 * Anything on another host returns null, so the server never fetches a URL the
 * user controls.
 */
export function parseGitHubUrl(input: string): GitHubRepoRef | null {
  let value = input.trim();
  if (!value) return null;

  if (/^[\w.-]+\/[\w.-]+$/.test(value)) value = `https://github.com/${value}`;
  if (!/^[a-z]+:\/\//i.test(value)) value = `https://${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null;
  if (url.username || url.password || url.port) return null;

  const [owner, rawRepo, kind, ...rest] = url.pathname.split('/').filter(Boolean);
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.replace(/\.git$/, '');
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null;

  if (kind === undefined) return { owner, repo };
  if ((kind === 'tree' || kind === 'commit') && rest.length > 0) {
    return { owner, repo, ref: decodeURIComponent(rest.join('/')) };
  }
  return null;
}

export const addRepositoryRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Paste a GitHub repository URL')
    .max(500, 'That URL is too long')
    .refine((value) => parseGitHubUrl(value) !== null, {
      message: 'Enter a public GitHub repository URL, like https://github.com/owner/repo',
    }),
});

export type AddRepositoryRequest = z.infer<typeof addRepositoryRequestSchema>;
