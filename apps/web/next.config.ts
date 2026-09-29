import path from 'node:path';
import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image; Vercel ignores this.
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // The shared workspace package ships TypeScript source.
  transpilePackages: ['@codebase-copilot/shared'],
  // The browser only ever talks to this origin; /api/* is proxied to the Fastify API.
  // Keeping one origin lets auth cookies work even though web and API are hosted separately.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
