// The CloudAEye auth API, as used by `login`. Three calls, in this order:
//
//   1. POST {auth}/api/auth/sign-in/email   → bearer token   (the only unauthenticated call)
//   2. GET  {auth}/api/v1/tenants/current   → tenantKey
//   3. POST {auth}/api/v1/tenants/{k}/api-key → the product API key
//
// UNVERIFIED, and the first thing to check when this breaks: whether step 3 is
// /api/v1/... or /v1/... — every other route on this API carries the /api prefix,
// but the endpoint was documented to us without it. Rather than guess, tryBoth()
// attempts the prefixed form and falls back to the bare one on a 404. Delete the
// fallback once someone confirms which is real.

import { request, ApiError } from './http.js';

export const DEFAULT_AUTH_URL = 'https://api.cloudaeye.com';

// The exact string the review server checks for. api_key_auth.py does an exact
// `in` against key.products, and keys stored as "CODE-REVIEW" are refused — a key
// this CLI mints must never land in that state.
export const REQUIRED_PRODUCT = 'Code Review';

async function tryBoth(paths, opts) {
  let last;
  for (const path of paths) {
    try {
      return await request(path, opts);
    } catch (err) {
      last = err;
      if (!(err instanceof ApiError) || err.status !== 404) throw err;
    }
  }
  throw last;
}

export async function signIn(authUrl, email, password) {
  const { data, headers } = await request(`${authUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    body: { email, password },
  });
  // Documented to arrive in the set-auth-token header, and also in the body.
  // Read both, because one of them is going to change.
  const token =
    headers.get('set-auth-token') ||
    data?.token ||
    data?.data?.token ||
    data?.session?.token;
  if (!token) {
    throw new ApiError('Signed in, but no auth token came back — the sign-in response shape has changed.');
  }
  return token;
}

export async function currentTenant(authUrl, token) {
  const { data } = await request(`${authUrl}/api/v1/tenants/current`, { token });
  const tenantKey = data?.tenantKey ?? data?.data?.tenantKey ?? data?.tenant_key ?? data?.data?.tenant_key;
  if (tenantKey === undefined || tenantKey === null || tenantKey === '') {
    // Signed up but never finished onboarding. Say so, rather than failing later
    // with a 403 that reads like a rejected key.
    throw new ApiError(
      'Your account has no tenant yet. Finish onboarding on the console, then run this again.'
    );
  }
  return String(tenantKey);
}

export async function mintApiKey(authUrl, token, tenantKey, name) {
  const { data } = await tryBoth(
    [
      `${authUrl}/api/v1/tenants/${encodeURIComponent(tenantKey)}/api-key`,
      `${authUrl}/v1/tenants/${encodeURIComponent(tenantKey)}/api-key`,
    ],
    { method: 'POST', token, body: { name, products: [REQUIRED_PRODUCT] } }
  );
  const key = data?.data?.key ?? data?.key;
  if (!key) {
    throw new ApiError('The key was created but not returned. It is only shown at creation — check the console.');
  }
  return key;
}
