import { hostname, userInfo } from 'node:os';
import { readConfig, writeConfig, removeConfig, redact, CONFIG_PATH } from './config.js';
import { hasTty, ask, askSecret } from './prompt.js';
import { request, assertSecure, ApiError } from './http.js';
import { signIn, currentTenant, mintApiKey, DEFAULT_AUTH_URL, REQUIRED_PRODUCT } from './api.js';

const DEFAULT_REVIEW_URL = 'http://localhost:8000';

export async function login(opts) {
  const authUrl = (opts.authUrl || process.env.CLOUDAEYE_AUTH_URL || DEFAULT_AUTH_URL).replace(/\/+$/, '');
  const reviewUrl = (opts.url || process.env.CLOUDAEYE_URL || DEFAULT_REVIEW_URL).replace(/\/+$/, '');
  assertSecure(authUrl);
  assertSecure(reviewUrl);

  // Non-interactive path: a key you already hold, for CI. No password is ever
  // accepted this way — only an already-minted key.
  if (opts.apiKey) {
    if (!opts.tenant) throw new ApiError('--api-key needs --tenant as well; the key is checked against a tenant.');
    const path = writeConfig({
      api_key: opts.apiKey,
      tenant_key: String(opts.tenant),
      user_name: opts.user || userInfo().username,
      url: reviewUrl,
    });
    console.log(`Saved ${redact(opts.apiKey)} for tenant ${opts.tenant} to ${path}`);
    return doctor({ quiet: false });
  }

  if (!hasTty()) {
    // The enforcement, not a policy: an agent shell lands here, so a password
    // cannot be typed into a transcript.
    throw new ApiError(
      'No terminal attached, so there is nowhere safe to type a password.\n' +
      'Run this in your own terminal. For CI, mint a key on the console and pass\n' +
      '  cloudaeye login --api-key <key> --tenant <tenant>\n' +
      'or set CLOUDAEYE_API_KEY and CLOUDAEYE_TENANT_KEY in the environment.'
    );
  }

  console.log(`Signing in to ${authUrl}`);
  const email = opts.email || (await ask('Email:    '));
  if (!email) throw new ApiError('An email is required.');
  const password = await askSecret('Password: ');
  if (!password) throw new ApiError('A password is required.');

  let token;
  try {
    token = await signIn(authUrl, email, password);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      throw new ApiError('Sign-in was rejected. Check the email and password on the console.');
    }
    throw err;
  }

  const tenantKey = await currentTenant(authUrl, token);
  const keyName = opts.name || `claude-code@${hostname()}`;
  const apiKey = await mintApiKey(authUrl, token, tenantKey, keyName);
  // The bearer is deliberately not persisted anywhere. It dies with this process.

  const path = writeConfig({
    api_key: apiKey,
    tenant_key: tenantKey,
    user_name: opts.user || email.split('@')[0],
    url: reviewUrl,
  });

  console.log(`\nMinted a "${REQUIRED_PRODUCT}" key named ${keyName} for tenant ${tenantKey}.`);
  console.log(`Wrote ${path} (0600). The key is shown only at creation — it is not printed here.\n`);
  return doctor({ quiet: false });
}

export function status() {
  const cfg = readConfig();
  if (!cfg) {
    console.log(`No credentials on this machine (${CONFIG_PATH} does not exist).`);
    console.log('Run: cloudaeye login');
    return 1;
  }
  if (cfg._malformed) {
    console.log(`${CONFIG_PATH} is not valid JSON. Delete it and run: cloudaeye login`);
    return 1;
  }
  console.log(`config      ${CONFIG_PATH}`);
  console.log(`api_key     ${redact(cfg.api_key)}`);
  console.log(`tenant_key  ${cfg.tenant_key || '(missing)'}`);
  console.log(`user_name   ${cfg.user_name || '(missing)'}`);
  console.log(`url         ${cfg.url || '(missing)'}`);
  console.log('\nThe environment and ~/.claude.json override this file, in that order.');
  return 0;
}

// Proves the key works against the review server, which is the only thing that
// matters — a key that signs in fine and is refused by /session is still broken.
export async function doctor({ quiet = false } = {}) {
  const cfg = readConfig() || {};
  const apiKey = process.env.CLOUDAEYE_API_KEY || cfg.api_key;
  const tenantKey = process.env.CLOUDAEYE_TENANT_KEY || cfg.tenant_key;
  const url = (process.env.CLOUDAEYE_URL || cfg.url || DEFAULT_REVIEW_URL).replace(/\/+$/, '');

  if (!apiKey) {
    console.log('credentials  none found. Run: cloudaeye login');
    return 1;
  }
  if (!tenantKey) {
    console.log('credentials  key present but no tenant_key — the server cannot check it. Run: cloudaeye login');
    return 1;
  }

  // Separate from the fetch below on purpose: a refused URL is a configuration
  // problem, and telling someone to "start the server" would send them the wrong way.
  try {
    assertSecure(url);
  } catch (err) {
    console.log(`server       ${err.message}`);
    return 1;
  }

  let res;
  try {
    res = await fetch(`${url}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Product-API-Key': apiKey },
      body: JSON.stringify({
        repo: 'cloudaeye-cli-doctor',
        branch: 'doctor',
        head: '0'.repeat(40),
        language: 'unknown',
        tenant_key: String(tenantKey),
        user_name: cfg.user_name || userInfo().username,
      }),
    });
  } catch (err) {
    console.log(`server       unreachable at ${url} — ${err.cause?.code || err.message}`);
    console.log('             Start the review server, or set CLOUDAEYE_URL to a reachable one.');
    return 1;
  }

  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }

  if (res.status === 200) {
    console.log(`server       ${url} OK`);
    console.log(`tenant       ${tenantKey}`);
    console.log(`key          ${redact(apiKey)} accepted`);
    const target = body?.target_branch;
    console.log(`baseline     ${target ? `origin/${target}` : 'none — this repo is not integrated, reviews fall back to HEAD'}`);
    if (body?.target_branch_error && !quiet) console.log(`note         ${body.target_branch_error}`);
    return 0;
  }
  if (res.status === 401 || res.status === 403) {
    const detail = typeof body === 'string' ? body : body?.detail || body?.message || '';
    console.log(`key          refused by ${url} (${res.status}) ${detail}`);
    console.log('             An unknown, inactive or expired key, a tenant it does not belong to,');
    console.log(`             or a key without the "${REQUIRED_PRODUCT}" product. Re-run: cloudaeye login`);
    return 1;
  }
  console.log(`server       ${url} answered ${res.status} — not a CloudAEye review server?`);
  return 1;
}

export function logout() {
  const removed = removeConfig();
  console.log(removed ? `Removed ${CONFIG_PATH}` : 'Nothing to remove.');
  console.log('The key still exists server-side — revoke it on the console if it should not be usable.');
  return 0;
}
