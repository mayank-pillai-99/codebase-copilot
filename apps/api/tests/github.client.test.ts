import { describe, expect, it, vi } from 'vitest';
import { createGitHubClient } from '../src/github/client';

const SHA = 'a'.repeat(40);

function fakeFetch(response: Response | (() => never)) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    typeof response === 'function' ? response() : response,
  );
}

describe('GitHub client', () => {
  it('fetches repository metadata with auth and API version headers', async () => {
    const fetch = fakeFetch(
      Response.json({
        owner: { login: 'Octo' },
        name: 'Hello',
        default_branch: 'main',
        private: false,
        size: 1234,
      }),
    );
    const client = createGitHubClient({ token: 'ghp_test', fetch });

    await expect(client.getRepository('octo', 'hello')).resolves.toEqual({
      owner: 'Octo',
      name: 'Hello',
      defaultBranch: 'main',
      isPrivate: false,
      sizeKb: 1234,
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/octo/hello');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer ghp_test',
      'x-github-api-version': '2022-11-28',
    });
  });

  it('omits the authorization header without a token', async () => {
    const fetch = fakeFetch(new Response(SHA));
    await createGitHubClient({ fetch }).resolveCommit('o', 'r', 'main');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty('authorization');
  });

  it('resolves refs with slashes to a full SHA', async () => {
    const fetch = fakeFetch(new Response(`${SHA}\n`));
    await expect(
      createGitHubClient({ fetch }).resolveCommit('o', 'r', 'feature/a b'),
    ).resolves.toBe(SHA);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/o/r/commits/feature/a%20b');
  });

  it('rejects a response that is not a SHA', async () => {
    const fetch = fakeFetch(new Response('<html>'));
    await expect(createGitHubClient({ fetch }).resolveCommit('o', 'r', 'main')).rejects.toThrow(
      /unexpected commit id/,
    );
  });

  it.each([
    [new Response('', { status: 404 }), 404, /Only public GitHub repositories/],
    [new Response('', { status: 422 }), 404, /Branch, tag or commit not found/],
    [
      new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
      503,
      /rate limit/,
    ],
    [new Response('', { status: 500 }), 502, /unexpected error \(500\)/],
  ])('maps GitHub errors to client-safe messages (%#)', async (response, status, message) => {
    const client = createGitHubClient({ fetch: fakeFetch(response) });
    await expect(client.resolveCommit('o', 'r', 'main')).rejects.toMatchObject({
      statusCode: status,
      message: expect.stringMatching(message),
    });
  });

  it('reports network failures without leaking details', async () => {
    const client = createGitHubClient({
      fetch: fakeFetch(() => {
        throw new TypeError('getaddrinfo ENOTFOUND api.github.com');
      }),
    });
    await expect(client.getRepository('o', 'r')).rejects.toMatchObject({
      statusCode: 502,
      message: 'Could not reach GitHub. Try again in a moment.',
    });
  });

  it('only downloads tarballs for full commit SHAs', async () => {
    const client = createGitHubClient({ fetch: fakeFetch(new Response('x')) });
    await expect(client.downloadTarball('o', 'r', 'main')).rejects.toThrow(/non-SHA/);
    await expect(client.downloadTarball('o', 'r', SHA)).resolves.toBeInstanceOf(ReadableStream);
  });
});
