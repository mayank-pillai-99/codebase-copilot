import { AppError } from '../lib/errors';

export interface GitHubRepository {
  owner: string;
  name: string;
  defaultBranch: string;
  isPrivate: boolean;
  /** GitHub's approximate repository size in KB (includes history). */
  sizeKb: number;
}

export interface GitHubClient {
  getRepository(owner: string, repo: string): Promise<GitHubRepository>;
  /** Resolves a branch, tag or (short) SHA to a full commit SHA. */
  resolveCommit(owner: string, repo: string, ref: string): Promise<string>;
  /** gzip-compressed tar stream of the repository at `sha`. */
  downloadTarball(owner: string, repo: string, sha: string): Promise<ReadableStream<Uint8Array>>;
}

const API = 'https://api.github.com';
const SHA = /^[0-9a-f]{40}$/;

export function createGitHubClient(
  options: { token?: string | undefined; fetch?: typeof fetch } = {},
): GitHubClient {
  const doFetch = options.fetch ?? fetch;

  async function request(path: string, init: { accept: string; timeoutMs: number }) {
    let res: Response;
    try {
      res = await doFetch(`${API}${path}`, {
        headers: {
          accept: init.accept,
          'user-agent': 'codebase-copilot',
          'x-github-api-version': '2022-11-28',
          ...(options.token && { authorization: `Bearer ${options.token}` }),
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(init.timeoutMs),
      });
    } catch {
      throw new AppError(502, 'Could not reach GitHub. Try again in a moment.');
    }
    if (res.ok) return res;

    if (res.status === 404) {
      throw new AppError(
        404,
        'Repository not found. Only public GitHub repositories are supported.',
      );
    }
    if (
      (res.status === 403 || res.status === 429) &&
      res.headers.get('x-ratelimit-remaining') === '0'
    ) {
      throw new AppError(503, 'GitHub rate limit reached. Try again later.');
    }
    if (res.status === 422) {
      throw new AppError(404, 'Branch, tag or commit not found in this repository.');
    }
    throw new AppError(502, `GitHub returned an unexpected error (${res.status}).`);
  }

  return {
    async getRepository(owner, repo) {
      const res = await request(`/repos/${enc(owner)}/${enc(repo)}`, {
        accept: 'application/vnd.github+json',
        timeoutMs: 10_000,
      });
      const body = (await res.json()) as {
        owner: { login: string };
        name: string;
        default_branch: string;
        private: boolean;
        size: number;
      };
      return {
        owner: body.owner.login,
        name: body.name,
        defaultBranch: body.default_branch,
        isPrivate: body.private,
        sizeKb: body.size,
      };
    },

    async resolveCommit(owner, repo, ref) {
      const refPath = ref.split('/').map(enc).join('/');
      const res = await request(`/repos/${enc(owner)}/${enc(repo)}/commits/${refPath}`, {
        accept: 'application/vnd.github.sha',
        timeoutMs: 10_000,
      });
      const sha = (await res.text()).trim();
      if (!SHA.test(sha)) throw new AppError(502, 'GitHub returned an unexpected commit id.');
      return sha;
    },

    async downloadTarball(owner, repo, sha) {
      if (!SHA.test(sha)) throw new Error(`Refusing to download non-SHA ref: ${sha}`);
      const res = await request(`/repos/${enc(owner)}/${enc(repo)}/tarball/${sha}`, {
        accept: 'application/vnd.github+json',
        timeoutMs: 120_000,
      });
      if (!res.body) throw new AppError(502, 'GitHub returned an empty archive.');
      return res.body;
    },
  };
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}
