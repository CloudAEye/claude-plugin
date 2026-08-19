---
name: init
description: Finish CloudAEye setup on this machine — fetches your API key and tenant from the review server once you are signed in, stores them outside every git repository, and confirms by opening a real review session. Run once per machine; it needs no key, no tenant number and nothing pasted.
when_to_use: Use when the user runs /cloudaeye:init, asks how to set up or sign in to CloudAEye, or when another CloudAEye skill stopped with cloudaeye_error=not_configured or cloudaeye_error=auth_failed.
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__get_credentials", "mcp__cloudaeye__get_credentials"]
---

## What this does

Sign-in itself is not yours to run and not the user's to configure. Claude Code does it:
the review server refuses an unauthenticated connection and points at the CloudAEye
console, Claude Code opens the browser, and the token lands in its own credential store.
**That has to have happened before this skill can do anything.**

This skill is the step after. It asks the review server for the developer's API key and
tenant — the server already knows whose, because the request carries their token — and
stores them where the review skills read them.

Never ask the user for an API key, a tenant number, a password or an email. If this
skill cannot get what it needs, the answer is always to send them through the browser
flow, never to collect a credential in the chat.

## Steps

1. **Check the tool is there.** If CloudAEye's `get_credentials` tool is not available,
   the server is not authenticated yet — Claude Code lists it as **Needs
   authentication** and exposes none of its tools. Stop and tell the user exactly this,
   then wait:

   > CloudAEye isn't signed in on this machine yet. Run `/mcp`, select **CloudAEye**,
   > choose **Authenticate**, and sign in (or create an account) in the browser tab that
   > opens. Then run `/cloudaeye:init` again.

   Do not work around it. There is no key to ask for, no file to hand-write, and no
   other command that helps — everything downstream needs the token that flow produces.

2. **Call CloudAEye's `get_credentials` MCP tool.** It takes no arguments, on purpose:
   the account and organisation come from the token, so there is nothing to point at
   somebody else.

   Its full name depends on how CloudAEye was installed —
   `mcp__plugin_cloudaeye_cloudaeye__get_credentials` from the plugin marketplace,
   `mcp__cloudaeye__get_credentials` if the server was registered by hand with
   `claude mcp add`. Both are pre-approved in this skill's frontmatter, so use whichever
   one is in your tool list and don't ask for permission first.

   - `"status": "error"` — report the `error` string to the user verbatim and stop. It
     is written for them and says whether to retry, re-authenticate, or report it.
     Two you will see while the console side is still being built: *"this review server
     does not have sign-in configured"* (the server has not enabled it yet — nothing
     the user can fix), and *"not signed in"* (go back to step 1).
   - `"status": "ok"` — carry `api_key`, `tenant_key`, `user_name` and `url` into
     step 3.

   **`api_key` is a live credential.** Put it in the command in step 3 and nowhere
   else: not in your reply, not in a summary, not in a "here's what I stored" line, not
   even truncated. The user does not need to see it and never has to type it.

3. **Store and verify**, as one Bash call. Substitute the four values from step 2 into
   the first line, each inside single quotes, and change nothing else.

   ```bash
   export CE_KEY='<api_key>' CE_TENANT='<tenant_key>' CE_USER='<user_name>' CE_URL='<url>'
   # The environment, not the argument list: argv is world-readable in the process
   # table on most systems and this value is the whole credential.
   for c in python python3 py; do command -v $c >/dev/null 2>&1 && $c -c "" 2>/dev/null && { PY=$c; break; }; done
   [ -n "$PY" ] || { echo "cloudaeye_error=python_not_found"; exit 1; }
   # Written to the plugin's own data directory: outside every git repository, so it
   # can never be committed or shipped in a diff; owned by this user; and removed with
   # the plugin's data if they uninstall it. CLAUDE_PLUGIN_DATA names that directory
   # when Claude Code exports it, which it does not do for every process kind — so
   # fall back to the one an existing creds file already lives in, then to a
   # cloudaeye* directory, then create one. Every one of those is matched by the glob
   # the review skills read, and they take the NEWEST file, so this write wins over a
   # stale one wherever it landed.
   $PY -c "
import glob, json, os, sys
H = os.path.expanduser('~')
d = os.environ.get('CLAUDE_PLUGIN_DATA') or ''
if not d:
    base = os.path.join(H, '.claude', 'plugins', 'data')
    found = sorted(glob.glob(os.path.join(base, '*', 'cloudaeye-creds.json')))
    if found:
        d = os.path.dirname(found[0])
    else:
        dirs = sorted(glob.glob(os.path.join(base, 'cloudaeye*')))
        d = dirs[0] if dirs else os.path.join(base, 'cloudaeye')
os.makedirs(d, exist_ok=True)
out = os.path.join(d, 'cloudaeye-creds.json')
cfg = {'api_key': os.environ.get('CE_KEY', ''), 'tenant_key': os.environ.get('CE_TENANT', ''),
       'user_name': os.environ.get('CE_USER', ''), 'url': os.environ.get('CE_URL', '')}
if not cfg['api_key'] or not cfg['tenant_key']:
    print('cloudaeye_error=nothing_to_store'); sys.exit(1)
tmp = out + '.tmp'
with open(tmp, 'w', encoding='utf-8') as f:
    json.dump(cfg, f)
try:
    os.chmod(tmp, 0o600)          # no-op on Windows, matters everywhere else
except OSError:
    pass
os.replace(tmp, out)              # atomic: a concurrent session never reads a torn file
print('stored=' + out)
" || exit 1
   # The key is out of this shell from here on. Everything below resolves it the way
   # the review skills do, through the file just written — so "setup complete" means
   # the path they actually use works, not that a file exists.
   unset CE_KEY CE_TENANT CE_USER CE_URL
   git rev-parse --show-toplevel >/dev/null 2>&1 || { echo "verify=skipped reason=not_a_git_repo"; exit 0; }
   cd "$(git rev-parse --show-toplevel)" || exit 1
   mkdir -p .cloudaeye/session && printf '*\n' > .cloudaeye/.gitignore
   CE_TMP=$(mktemp -d 2>/dev/null) || CE_TMP="${TMPDIR:-${TMP:-/tmp}}/cloudaeye-$$"
   mkdir -p "$CE_TMP" || { echo "cloudaeye_error=bad_config"; exit 1; }
   trap 'rm -rf "$CE_TMP"' EXIT INT TERM
   REPO=$(basename -s .git "$(git config --get remote.origin.url)"); [ -n "$REPO" ] || REPO=$(basename "$PWD")
   $PY -c "import glob,json,os,re,sys;L=lambda p:(json.load(open(p,encoding='utf-8')) if p and os.path.exists(p) else {});H=os.path.expanduser('~');C=L(os.path.join(H,'.claude.json'));M=lambda d:((d or {}).get('mcpServers') or {}).get('cloudaeye') or {};S=M((C.get('projects') or {}).get(os.getcwd())) or M(C);D=S.get('headers') or {};E=os.environ.get;PO=lambda f:E('CLAUDE_PLUGIN_OPTION_'+f.upper());GL=glob.glob(os.path.join(H,'.claude','plugins','data','*','cloudaeye-creds.json'));G=max(GL,key=os.path.getmtime) if GL else '';LAY=[('env',{'api_key':E('CLOUDAEYE_API_KEY'),'tenant_key':E('CLOUDAEYE_TENANT_KEY'),'user_name':E('CLOUDAEYE_USER_NAME'),'url':E('CLOUDAEYE_URL')}),('plugin',{'api_key':PO('api_key'),'tenant_key':PO('tenant_key'),'user_name':PO('user_name'),'url':PO('url')}),('pdata',L(G)),('claude',{'api_key':D.get('X-Product-API-Key'),'tenant_key':D.get('X-Tenant-Key'),'user_name':D.get('X-User-Name'),'url':str(S.get('url') or '').rstrip('/')})];P=lambda f:next(((str(l.get(f) or '').strip(),n) for n,l in LAY if str(l.get(f) or '').strip()),('','none'));k,o=P('api_key');k=k if re.fullmatch(r'[A-Za-z0-9._-]{8,128}',k) else '';W=lambda n,b:open(os.path.join(sys.argv[4],n),'wb').write(b);json.dump({'repo':sys.argv[1],'branch':sys.argv[2],'head':sys.argv[3],'language':'','tenant_key':P('tenant_key')[0],'user_name':P('user_name')[0]},open('.cloudaeye/session/req.json','w'));W('curl.cfg',('header = \"X-Product-API-Key: %s\"\n' % k).encode() if k else b'');W('base_url',(P('url')[0] or 'https://api.cloudaeye.com/mcp').encode());W('origin',(o if k else 'none').encode());W('pdata_ok',b'1' if str((L(G) or {}).get('api_key') or '').strip() else b'0')" "$REPO" "$(git rev-parse --abbrev-ref HEAD)" "$(git rev-parse HEAD)" "$CE_TMP"
   CE=$(cat "$CE_TMP/base_url" | tr -d '\r\n'); ORIGIN=$(cat "$CE_TMP/origin" | tr -d '\r\n')
   # Reported separately from auth_from on purpose. A higher layer (an exported
   # CLOUDAEYE_API_KEY, or a key in the plugin's settings) shadows the file just
   # written, so the session below can succeed on somebody else's credential and
   # say nothing about whether this run actually worked. That is the one way
   # "setup complete" could be a lie.
   PDATA_OK=$(cat "$CE_TMP/pdata_ok" | tr -d '\r\n')
   case "$CE" in https://*|http://localhost*|http://127.0.0.1*) ;; *) echo "cloudaeye_error=insecure_url url=$CE auth_from=$ORIGIN"; exit 1;; esac
   [ "$PDATA_OK" = "1" ] || { echo "cloudaeye_error=not_readable_back url=$CE"; exit 1; }
   rm -f .cloudaeye/session/session.json
   S_HTTP=$(curl -s -m 30 -K "$CE_TMP/curl.cfg" -o .cloudaeye/session/session.json -w '%{http_code}' \
     -X POST "$CE/session" -H 'Content-Type: application/json' -d @.cloudaeye/session/req.json)
   echo "verify_http=$S_HTTP stored_resolves=$PDATA_OK auth_from=$ORIGIN url=$CE"
   cat .cloudaeye/session/session.json 2>/dev/null; echo
   ```

4. **Report the outcome.** Read the printed lines; do not re-derive any of it.

   | output | what it means |
   |---|---|
   | `stored=<path>` | Where the credentials went. Worth showing the user — it is the file to delete if they ever want to sign out on this machine. |
   | `verify_http=200` | Setup is complete and proven: a real review session opened. Say so plainly. |
   | `verify=skipped reason=not_a_git_repo` | Credentials are stored, but nothing was proven. Tell the user to run `/cloudaeye:inspect` inside a repository to confirm. |
   | `cloudaeye_error=not_readable_back` | The file was written but the review skills cannot see it. **Do not call setup complete.** Report the `stored=` path and that it did not resolve — this is a bug worth reporting, not something the user can fix. |
   | `auth_from=` not `pdata` | Setup worked, but a higher layer is in charge: `env` means a `CLOUDAEYE_API_KEY` is exported in this shell, `plugin` means a key is set in the plugin's own settings. Both override the file this skill just wrote. Say which one is winning in a single line — if the user came here because reviews were failing, that layer is the thing to fix, and `init` will not have changed anything they can see. |
   | `verify_http=` 401/403 | The key the server just issued was refused by the server. Report it as a server-side problem, not a user one. |
   | `verify_http=` anything else | The server did not answer. Credentials are stored; the review server may be down. Retrying later is reasonable. |
   | `target_branch_error` in the JSON | The tenant is fine but **this repository is not connected to CloudAEye**. Reviews still run, against local `HEAD`, with no baseline branch and no code-context graph. Tell the user to connect it at <https://console.cloudaeye.com> — installing the CloudAEye GitHub App and selecting this repository — and that reviews work in the meantime. |

   Then tell them what they can run: `/cloudaeye:inspect` after a coding task,
   `/cloudaeye:review` before a PR, `/cloudaeye:describe`, `/cloudaeye:ask`,
   `/cloudaeye:check-task`.

   **Never print the API key** in the summary, whole or partial.

## Notes

- **Once per machine, not once per repository.** The credentials live in the plugin's
  data directory, so every repository on the machine is covered. Re-running is safe and
  idempotent — it re-fetches the same key and rewrites the same file, which is also the
  right first move if a review starts failing with `auth_failed`.
- **This skill never mints anything.** The console owns key lifecycle; the review server
  asks it on the user's behalf. So a key revoked in the console is revoked everywhere,
  and re-running `init` is what picks up the replacement.
- **Signing out** means removing the `stored=` file and disconnecting CloudAEye in
  `/mcp`. Uninstalling the plugin removes the file too, unless they pass `--keep-data`.
- If the user already has a key from the console and wants to use it directly, they do
  not need this skill at all — the plugin's own settings (`/plugin`) take an API key and
  tenant, and the `CLOUDAEYE_*` environment variables still work for CI and on-prem.
