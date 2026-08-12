// Where the credential lives, and nothing else. One file, one machine, 0600.
//
// This is the `home` layer the plugin's skills resolve from — see the bootstrap
// block in any skills/cloudaeye-*/SKILL.md. The skills also read env vars and
// ~/.claude.json, but this CLI writes only here: ~/.claude.json belongs to Claude
// Code and nothing of ours should be editing it.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, rmSync } from 'node:fs';

export const CONFIG_DIR = join(homedir(), '.cloudaeye');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export function readConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { _malformed: true };
  }
}

export function writeConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  // writeFileSync only applies mode when creating; chmod covers the overwrite case.
  try { chmodSync(CONFIG_PATH, 0o600); } catch { /* windows ACLs, not much to do */ }
  return CONFIG_PATH;
}

export function removeConfig() {
  if (!existsSync(CONFIG_PATH)) return false;
  rmSync(CONFIG_PATH);
  return true;
}

// Never print a key. Enough to tell two keys apart in a bug report, not enough to use.
export function redact(key) {
  if (!key) return '(none)';
  return `${key.slice(0, 3)}…${key.slice(-2)} (${key.length} chars)`;
}
