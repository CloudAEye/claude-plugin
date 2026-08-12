// Native fetch only. No axios, no node-fetch — a tool that asks for a password
// should have a dependency tree a reviewer can read in one sitting.

export class ApiError extends Error {
  constructor(message, { status, body, url } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

// A password crosses this wire. Plain http to anything but the local machine is
// refused rather than warned about.
export function assertSecure(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new ApiError(`Not a valid URL: ${url}`);
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1';
  if (u.protocol !== 'https:' && !local) {
    throw new ApiError(
      `Refusing to use ${u.protocol}//${u.host} — credentials would cross the network in clear. Use https.`
    );
  }
  return u;
}

export async function request(url, { method = 'GET', token, body, timeoutMs = 30000 } = {}) {
  assertSecure(url);
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError(`Timed out after ${timeoutMs / 1000}s: ${url}`, { url });
    throw new ApiError(`Could not reach ${url} — ${err.cause?.code || err.message}`, { url });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  if (!res.ok) {
    const detail = typeof parsed === 'string' ? parsed : parsed?.message || parsed?.error || '';
    throw new ApiError(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`, {
      status: res.status, body: parsed, url,
    });
  }
  return { data: parsed, headers: res.headers, status: res.status };
}
