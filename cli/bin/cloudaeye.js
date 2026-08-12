#!/usr/bin/env node
// CloudAEye CLI — puts a Code Review API key on this machine for the Claude Code
// plugin, and proves it works. Nothing else. See ../README.md.

import { login, status, doctor, logout } from '../src/commands.js';
import { ApiError } from '../src/http.js';

const USAGE = `cloudaeye — credentials for the CloudAEye Claude Code plugin

  cloudaeye login              sign in, mint a key, save it (needs a terminal)
  cloudaeye login --api-key <key> --tenant <t>
                               non-interactive, for CI — no password involved
  cloudaeye doctor             check the saved key against the review server
  cloudaeye status             show what is saved (key redacted)
  cloudaeye logout             delete the saved credential

Options
  --url <url>        review server; default $CLOUDAEYE_URL or http://localhost:8000
  --auth-url <url>   auth API; default $CLOUDAEYE_AUTH_URL or https://api.cloudaeye.com
  --email <addr>     skip the email prompt (never the password prompt)
  --name <label>     name for the minted key; default claude-code@<hostname>
  --user <name>      user_name recorded on review sessions
  -h, --help         this
  -v, --version      version

A password is only ever read from a terminal, never from a flag or an environment
variable. Without a terminal, login refuses and points you at --api-key.`;

function parseArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      if (a === '-h') { opts.help = true; continue; }
      if (a === '-v') { opts.version = true; continue; }
      rest.push(a);
      continue;
    }
    const [flag, inline] = a.slice(2).split(/=(.*)/s);
    const key = flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (flag === 'help' || flag === 'version') { opts[key] = true; continue; }
    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined) throw new ApiError(`--${flag} needs a value`);
    opts[key] = value;
  }
  return { command: rest[0], opts };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const { command, opts } = parsed;

  if (opts.help) { console.log(USAGE); return 0; }
  if (opts.version) {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    console.log(JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version);
    return 0;
  }

  switch (command || 'login') {
    case 'login':  return (await login(opts)) ?? 0;
    case 'doctor': return await doctor({});
    case 'status': return status();
    case 'logout': return logout();
    default:
      console.error(`Unknown command: ${command}\n`);
      console.error(USAGE);
      return 2;
  }
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    // An ApiError is a message written for the person reading it. Anything else
    // is a bug, and gets its stack so it can be reported.
    if (err instanceof ApiError) console.error(err.message);
    else console.error(err);
    process.exit(1);
  });
