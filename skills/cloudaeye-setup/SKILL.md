---
name: cloudaeye-setup
description: Diagnose a CloudAEye install — plugin version, MCP connection, credentials, and which repo baseline it would review against — and print the one next step. It is read-only, and never asks for, prints, or writes a password or an API key.
when_to_use: Use when a CloudAEye skill reports cloudaeye_error=not_configured or auth_failed, when the user asks how to set up, connect or sign in to CloudAEye, or right after installing the plugin.
---

## What this skill is for

CloudAEye needs one credential — a product API key — before any review can run. This
skill finds out what is present, what is missing, and prints the single command that
fixes it. It changes nothing.

## Hard rules

These are not preferences. Breaking one puts a live credential in a place it cannot be
removed from.

- **Never run `npx @cloudaeye/cli login`, or any other sign-in command, yourself.** It
  prompts for a password on a terminal. Your shell has no TTY, so it cannot succeed —
  and if it could, the password would be typed into a transcript. The user runs it in
  their own terminal.
- **Never ask the user for a password, an API key, or a token in chat**, and never
  offer to write one into a file for them. If the user pastes a key or password anyway,
  tell them plainly: it is now in this transcript, they should treat it as leaked and
  rotate it on the console before doing anything else.
- **Never edit `~/.claude.json`, `~/.cloudaeye/config.json`, or any settings file.**
- Report only what the block below prints. It deliberately prints the *presence* and
  *source* of the key, never its value.

## Steps

1. Run this entire block as one Bash call. It reads config, prints a status report, and
   makes one unauthenticated request to see whether the server answers. It writes
   nothing, and sends no credential anywhere.

   ```bash
   # python3 on Windows is often an alias stub, python is absent on many Linux
   # images: pick one that actually runs rather than guessing.
   for c in python python3 py; do command -v $c >/dev/null 2>&1 && $c -c "" 2>/dev/null && { PY=$c; break; }; done
   [ -n "$PY" ] || { echo "cloudaeye_error=python_not_found"; exit 1; }
   # Same per-field resolution the review skills use — environment, then the
   # cloudaeye entry in ~/.claude.json, then ~/.cloudaeye/config.json — but this
   # copy reports the LAYER and never the key. api_key is printed as
   # present/malformed/missing; tenant and user name are not secrets and are
   # printed in full because a wrong tenant is the most common misconfiguration.
   REPORT=$($PY -c "import json,os,re,glob;L=lambda p:(json.load(open(p,encoding='utf-8')) if os.path.exists(p) else {});H=os.path.expanduser('~');C=L(os.path.join(H,'.claude.json'));M=lambda d:((d or {}).get('mcpServers') or {}).get('cloudaeye') or {};S=M((C.get('projects') or {}).get(os.getcwd())) or M(C);D=S.get('headers') or {};E=os.environ.get;LAY=[('env',{'api_key':E('CLOUDAEYE_API_KEY'),'tenant_key':E('CLOUDAEYE_TENANT_KEY'),'user_name':E('CLOUDAEYE_USER_NAME'),'url':E('CLOUDAEYE_URL')}),('claude',{'api_key':D.get('X-Product-API-Key'),'tenant_key':D.get('X-Tenant-Key'),'user_name':D.get('X-User-Name'),'url':re.sub(r'/mcp/?\Z','',str(S.get('url') or ''))}),('home',L(os.path.join(H,'.cloudaeye','config.json')))];P=lambda f:next(((str(l.get(f) or '').strip(),n) for n,l in LAY if str(l.get(f) or '').strip()),('','none'));k,o=P('api_key');ok=bool(re.fullmatch(r'[A-Za-z0-9._-]{8,128}',k));print('auth_from=%s'%(o if ok else 'none'));print('api_key=%s'%('present' if ok else ('malformed' if k else 'missing')));print('tenant_key=%s'%(P('tenant_key')[0] or 'missing'));print('user_name=%s'%(P('user_name')[0] or 'missing'));print('url=%s'%(P('url')[0] or 'http://localhost:8000'));print('url_from=%s'%P('url')[1]);print('home_config=%s'%('present' if os.path.exists(os.path.join(H,'.cloudaeye','config.json')) else 'absent'));print('claude_json_entry=%s'%('present' if S else 'absent'));print('legacy_skills=%d'%len(glob.glob(os.path.join(H,'.claude','skills','cloudaeye-*'))))")
   [ -n "$REPORT" ] || { echo "cloudaeye_error=bad_config"; exit 1; }
   echo "$REPORT"
   echo "cli_installed=$(command -v cloudaeye >/dev/null 2>&1 && echo yes || echo no)"
   echo "git_repo=$(git rev-parse --show-toplevel >/dev/null 2>&1 && echo yes || echo no)"
   # \r is stripped: Windows python emits CRLF and a stray carriage return
   # corrupts the URL silently.
   CE=$(printf '%s\n' "$REPORT" | sed -n 's/^url=//p' | tr -d '\r\n')
   case "$CE" in
     https://*|http://localhost*|http://127.0.0.1*) ;;
     *) echo "server_probe=insecure_url url=$CE"; CE="";;
   esac
   # Deliberately NO -K curl.cfg here: this request carries no API key. A 401 is
   # the expected, healthy answer — it proves the server is up and enforcing auth.
   [ -n "$CE" ] && echo "server_probe=$(curl -s -o /dev/null -m 8 -w '%{http_code}' \
     -X POST "$CE/session" -H 'Content-Type: application/json' -d '{}')"
   ```

2. Turn the output into this report. Keep the four lines and this order — it is the
   order things have to be fixed in, so a user reading top to bottom stops at their
   first `✗`.

   ```text
   ✓ plugin installed        cloudaeye v0.1.0
   ✓ MCP server connected    <url>/mcp
   ✗ credentials             none found
   – repo integration        unknown (needs credentials first)
   ```

   How to fill each line:

   | line | mark it ✓ when | mark it ✗ when |
   |---|---|---|
   | plugin installed | you are running this skill at all — say the version from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` if you can read it | never |
   | MCP server connected | `mcp__cloudaeye__inspect_diff` is in your own tool list | it is absent — the plugin loaded but the server did not connect. Name the URL and `server_probe` |
   | credentials | `api_key=present` | `api_key=missing` or `malformed` |
   | repo integration | a review has resolved `base_source=fork_point` in this session | otherwise `–` with "unknown until the first review" |

   `server_probe` readings:

   | value | means |
   |---|---|
   | `401` / `403` | Server is up and enforcing auth. This is the healthy answer for an unauthenticated probe — do not report it as a failure. |
   | `400` / `422` | Server is up with auth switched off (a local dev server). Say so once: reviews will run without checking any key. |
   | `000` | Nothing answered. The server is not running at that URL, or the URL is wrong. |
   | `404` | Something answers there, but it is not a CloudAEye review server. |
   | `insecure_url` | Off-box server over plain `http`. Every skill refuses this, because the key would cross the network in clear. |

3. Print exactly one **Next** block — the first unmet condition, not a list of
   everything that could be improved.

   | condition | next step to print |
   |---|---|
   | `api_key=missing` | 1. Create an account at https://console.cloudaeye.com/signup — 2. run `npx @cloudaeye/cli login` in **their own terminal**, not here — 3. come back and run `/cloudaeye-review` |
   | `api_key=malformed` | The stored key is not a plausible key string. Re-run `npx @cloudaeye/cli login` to replace it. |
   | `tenant_key=missing` but key present | The key cannot be checked without a tenant. Re-run `npx @cloudaeye/cli login`; if it persists, the account has no tenant yet and onboarding is unfinished on the console. |
   | `server_probe=000` and the URL is localhost | The review server is not running on this machine. Either start it, or point at a hosted one by exporting `CLOUDAEYE_URL`. |
   | `server_probe=000` and the URL is remote | The server is unreachable — VPN, firewall, or a wrong `CLOUDAEYE_URL`. |
   | MCP tools absent | The plugin's MCP server did not connect. `CLOUDAEYE_URL` must be set **before** Claude Code starts, because `.mcp.json` reads it at connect time; after exporting it, restart Claude Code. |
   | everything ✓ | Run `/cloudaeye-inspect` on a change and stop. Nothing else needs doing. |

4. Report these only if they are true — each one is a real problem, not a nag:

   - `legacy_skills` greater than 0 — an older hand-install left skills in
     `~/.claude/skills/cloudaeye-*`. Those shadow or duplicate the plugin's, and they
     will drift apart silently. Tell the user to delete that directory; do not delete
     it yourself.
   - `claude_json_entry=present` — a `cloudaeye` MCP server is also registered in
     `~/.claude.json`. Two servers under one name is ambiguous. It is only worth
     removing if the MCP tools are missing or pointing somewhere unexpected; if it is
     also where the key comes from (`auth_from=claude`), say that first, because
     removing it takes the credential with it.
   - `url_from=claude` or `env` while `home_config=present` — two sources disagree
     about which server to talk to. Name both and say which one wins.

## Notes

- This skill never fixes anything. Every remedy is a command the user runs, or a file
  the user edits. That is deliberate: the one thing that would make it convenient — 
  handling the credential for them — is the one thing it must not do.
- `npx @cloudaeye/cli login` is interactive and needs a terminal. If the user reports
  it exiting immediately with a message about no TTY, they ran it through an agent or a
  CI shell rather than their own terminal.
- The CLI is not required for reviews to work; it is a convenience for getting the key
  onto the machine. A key already in the environment (`CLOUDAEYE_API_KEY`,
  `CLOUDAEYE_TENANT_KEY`) works exactly as well, which is what CI should use.
