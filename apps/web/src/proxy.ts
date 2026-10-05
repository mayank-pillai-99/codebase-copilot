import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from '@codebase-copilot/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { forwardingHeaders } from '@/lib/forwarding';

/** Tells the API who the visitor is on requests rewritten to it (next.config.ts). */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Never pass on values a visitor sent themselves.
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(PROXY_SECRET_HEADER);
  for (const [name, value] of Object.entries(forwardingHeaders(request.headers))) {
    headers.set(name, value);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: '/api/:path*' };
