# 0002: Authentication with stateless session cookies

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Users need accounts to index repositories and keep chat history private (SPEC §15). The web app (Vercel) and API (Render) run on different hosts, and the free tiers rule out anything that needs extra infrastructure. Auth has to be simple, but it shouldn't have the usual security holes.

## Decision

- **Email and password, hashed with Argon2id** (`@node-rs/argon2`, which ships prebuilt binaries so there's no native build step). It uses the library defaults (19 MiB, t=2, p=1), which meet OWASP's minimum. The parameters are stored in each hash, so they can be raised later without invalidating existing passwords.
- **Stateless sessions:** a JWT whose subject is the user id, signed with `JWT_SECRET` (at least 32 characters) and valid for 7 days. It's stored in an **httpOnly, SameSite=Lax cookie** that is Secure in production. JavaScript never sees the token.
- **One origin.** The browser only talks to the web app, and Next.js rewrites `/api/*` to the API. So the cookie is first-party on the web domain, with no CORS credentials and no third-party-cookie problems.
- **Only the API verifies tokens.** Server components forward the cookie to `GET /api/auth/me`, so the web app never needs the JWT secret.
- **CSRF defense:** SameSite=Lax keeps the cookie off cross-site POSTs. On top of that, the API refuses `text/plain` bodies, since an HTML form on another site can send that content type but can't send JSON.
- **Limiting account discovery:** login returns one generic error for "no such email" and "wrong password". When the email doesn't exist, it still runs a hash verification, so the response time doesn't give the answer away. Registration does report a duplicate email (409). That's accepted for an MVP; hiding it would need email verification.
- **Rate limiting:** 10 login/register attempts per minute per IP, with counters in Redis so they're shared across instances. If Redis is down, requests are served rather than rejected. `TRUST_PROXY=true` is needed behind a proxy so limits apply to the real client IP.
- **Ownership:** `assertOwnedBy()` answers **404** (not 403) for resources owned by another user, so ids can't be probed.
- **Open redirects:** `?next=` after login only accepts same-site paths.

## Alternatives considered

- **Server-side sessions in Redis/Postgres:** these allow instant revocation, but need a lookup on every request and add a dependency that's hard to keep on free tiers. It can be revisited if revocation becomes a requirement.
- **Token in localStorage and an `Authorization` header:** any XSS could read the token, and every fetch would need wiring.
- **An auth library such as Auth.js, or a hosted provider:** less code, but more hidden behavior and a less interesting interview story for a project whose scope is deliberately small.

## Consequences

- Logging out clears the cookie, but a stolen token stays valid until it expires (7 days). There's no server-side revocation list yet.
- Rotating `JWT_SECRET` signs everyone out.
- There's no email verification or password reset yet. GitHub OAuth is a stretch goal (SPEC §21).
