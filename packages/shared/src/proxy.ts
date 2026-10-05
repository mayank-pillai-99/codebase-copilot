/**
 * Headers the Next.js server adds when it forwards a request to the API: the visitor's
 * IP, and a shared secret proving the IP came from our own server rather than a client.
 * The API ignores the IP header unless the secret matches.
 */
export const CLIENT_IP_HEADER = 'x-client-ip';
export const PROXY_SECRET_HEADER = 'x-proxy-secret';
