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

   **The reverse does not hold, so do not say it.** The tool being present does not
   mean anyone is signed in: where the server has sign-in switched off it exposes every
   tool to every caller, and that is the normal state until the CloudAEye console's
   endpoints go live. Only step 2's answer tells you whether there is an identity
   behind this call. Announcing "the tool is available, so CloudAEye is authenticated"
   is wrong and contradicts the refusal you are about to read out.

2. **Run the setup block below with `CE_CODE` and `CE_CLAIM_URL` left empty.**

   This is a probe. On a machine that is already set up it does the whole job —
   confirms the credentials work, checks whether *this repository* is connected, and
   opens the browser if it is not. Most re-runs of `init` end here, having fetched
   nothing.

   Read the output:

   - **`setup=absent`** — no credentials on this machine. Go to step 3.
   - **anything else** — already set up. Skip steps 3 and 4 entirely and report
     (step 5). Do not fetch a credential nobody needs.

   ```bash
   export CE_CODE='' CE_CLAIM_URL=''   # step 2 leaves these empty; step 4 fills them in
   # The environment, not the argument list: argv is world-readable in the process
   # table on most systems.
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
   CE_DIR=$($PY -c "
import glob, os
H = os.path.expanduser('~')
d = os.environ.get('CLAUDE_PLUGIN_DATA') or ''
if not d:
    base = os.path.join(H, '.claude', 'plugins', 'data')
    found = sorted(glob.glob(os.path.join(base, '*', 'cloudaeye-creds.json')))
    d = os.path.dirname(found[0]) if found else (
        (sorted(glob.glob(os.path.join(base, 'cloudaeye*'))) or [os.path.join(base, 'cloudaeye')])[0])
os.makedirs(d, exist_ok=True)     # curl -o will not create the parent directory
print(d)
" | tr -d '\r\n')
   [ -n "$CE_DIR" ] || { echo "cloudaeye_error=no_data_dir"; exit 1; }
   OUT="$CE_DIR/cloudaeye-creds.json"
   # The exchange, only when a code was supplied. With none, this is the probe
   # pass: everything below still runs, and reports what is already set up.
   if [ -n "$CE_CODE" ]; then
   # curl writes the response body straight to a file — the key is never in a
   # variable, never on a command line, and never in anything you read. Do not
   # cat this file afterwards.
   R_HTTP=$(curl -s -m 30 -o "$OUT.tmp" -w '%{http_code}' -X POST "$CE_CLAIM_URL" \
     -H 'Content-Type: application/json' --data-binary "$($PY -c "
import json, os
print(json.dumps({'code': os.environ.get('CE_CODE', '')}))")")
   unset CE_CODE
   case "$R_HTTP" in
     200) ;;
     403) rm -f "$OUT.tmp"; echo "cloudaeye_error=claim_rejected http=403 — the setup code was already used or expired; run /cloudaeye:init again"; exit 1;;
     *)   rm -f "$OUT.tmp"; echo "cloudaeye_error=claim_failed http=$R_HTTP url=$CE_CLAIM_URL"; exit 1;;
   esac
   # Validate before it becomes the live file: a truncated or error body would
   # otherwise replace working credentials with something that fails much later.
   $PY -c "
import json, os, sys
tmp = sys.argv[1]
try:
    cfg = json.load(open(tmp, encoding='utf-8'))
except Exception:
    print('cloudaeye_error=claim_unreadable'); sys.exit(1)
if not str(cfg.get('api_key', '')).strip() or not str(cfg.get('tenant_key', '')).strip():
    print('cloudaeye_error=claim_incomplete'); sys.exit(1)
try:
    os.chmod(tmp, 0o600)          # no-op on Windows, matters everywhere else
except OSError:
    pass
os.replace(tmp, sys.argv[2])      # atomic: a concurrent session never reads a torn file
print('stored=' + sys.argv[2])
" "$OUT.tmp" "$OUT" || { rm -f "$OUT.tmp"; exit 1; }
   fi
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
   # No code was given and nothing resolved: this machine is not set up yet, which
   # on the first pass is the expected answer, not an error.
   if [ -z "$CE_CODE" ] && [ "$ORIGIN" = "none" ]; then echo "setup=absent"; exit 0; fi
   [ "$PDATA_OK" = "1" ] || { echo "cloudaeye_error=not_readable_back url=$CE"; exit 1; }
   rm -f .cloudaeye/session/session.json
   S_HTTP=$(curl -s -m 30 -K "$CE_TMP/curl.cfg" -o .cloudaeye/session/session.json -w '%{http_code}' \
     -X POST "$CE/session" -H 'Content-Type: application/json' -d @.cloudaeye/session/req.json)
   echo "verify_http=$S_HTTP stored_resolves=$PDATA_OK auth_from=$ORIGIN url=$CE"
   # Is THIS repository connected? The server answers it on every session, and
   # supplies the link — the client never builds a CloudAEye URL of its own.
   INTEG=$($PY -c "
import json, sys
try:
    d = json.load(open('.cloudaeye/session/session.json', encoding='utf-8'))
except Exception:
    sys.exit(0)
if d.get('target_branch_error'):
    print('no ' + (d.get('integration_url') or ''))
elif d.get('target_branch'):
    print('yes ' + d['target_branch'])
" 2>/dev/null)
   set -- $INTEG
   echo "integrated=${1:-unknown} ${2:+link=$2}"
   # Open it, because the whole point of noticing is to get them there. The link
   # is printed above regardless, so this is a convenience, never load-bearing —
   # and browser_open= reports what actually happened rather than assuming.
   #
   # cmd.exe takes //c, not /c. Under MSYS a leading-slash argument is rewritten
   # as a path, so `cmd.exe /c start ...` arrives as `cmd.exe C:/ start ...`:
   # an interactive shell that opens nothing and then waits. That is both why no
   # tab appeared and why an earlier synchronous version hung for two minutes.
   #
   # All three streams are redirected on every branch. A launched browser
   # inherits this shell's stdout, and an inherited pipe is not closed when the
   # block ends — whatever reads this output would wait on a browser window.
   BROWSER_OPENED=no
   if [ "${1:-}" = "no" ] && [ -n "${2:-}" ]; then
     if   command -v open      >/dev/null 2>&1; then open "$2"     </dev/null >/dev/null 2>&1 && BROWSER_OPENED=yes
     elif command -v xdg-open  >/dev/null 2>&1; then xdg-open "$2" </dev/null >/dev/null 2>&1 && BROWSER_OPENED=yes
     elif command -v cmd.exe   >/dev/null 2>&1; then cmd.exe //c start "" "$2" </dev/null >/dev/null 2>&1 && BROWSER_OPENED=yes
     fi
     echo "browser_open=$BROWSER_OPENED"
   fi
   cat .cloudaeye/session/session.json 2>/dev/null; echo
   ```

3. **Only if `setup=absent`: call CloudAEye's `get_credentials` MCP tool.** It takes no arguments, on purpose:
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

     On that first one, add one line about what is **not** broken: if a key is already
     resolving on this machine, the review commands keep working, because they
     authenticate to `/session` with the product API key and never needed a sign-in
     token. Only `init` is blocked. Say it — otherwise a failed setup reads as
     "CloudAEye is down" when nothing of theirs is.
   - `"status": "ok"` — carry `claim_code` and `claim_url` into step 4.

   **There is no API key in that response, and that is deliberate.** A tool result is
   part of this conversation, and Claude Code writes conversations to disk — so a key
   returned here would land in a transcript every time anyone runs setup. Instead you
   get a **single-use code, valid for two minutes**, which step 3 exchanges for the real
   credentials directly into a file. You never see the key, so you cannot leak it.

   Spend the code promptly — run step 3 as your next action, not after other work.

4. **Re-run the exact same block from step 2**, with the two values filled in:

   ```bash
   export CE_CODE='<claim_code>' CE_CLAIM_URL='<claim_url>'
   ```

   …and every other line unchanged. This time it redeems the code into the config file
   before doing the same verification and integration check.

5. **Report the outcome.** Read the printed lines; do not re-derive any of it.

   | output | what it means |
   |---|---|
   | `stored=<path>` | Where the credentials went. Worth showing the user — it is the file to delete if they ever want to sign out on this machine. |
   | `verify_http=200` | Setup is complete and proven: a real review session opened. Say so plainly. |
   | `verify=skipped reason=not_a_git_repo` | Credentials are stored, but nothing was proven. Tell the user to run `/cloudaeye:inspect` inside a repository to confirm. |
   | `cloudaeye_error=not_readable_back` | The file was written but the review skills cannot see it. **Do not call setup complete.** Report the `stored=` path and that it did not resolve — this is a bug worth reporting, not something the user can fix. |
   | `auth_from=` not `pdata` | Setup worked, but a higher layer is in charge: `env` means a `CLOUDAEYE_API_KEY` is exported in this shell, `plugin` means a key is set in the plugin's own settings. Both override the file this skill just wrote. Say which one is winning in a single line — if the user came here because reviews were failing, that layer is the thing to fix, and `init` will not have changed anything they can see. |
   | `verify_http=` 401/403 | The key the server just issued was refused by the server. Report it as a server-side problem, not a user one. |
   | `verify_http=` anything else | The server did not answer. Credentials are stored; the review server may be down. Retrying later is reasonable. |
   | `setup=absent` | No credentials on this machine — this is step 2 telling you to go to step 3, not an error. |
   | `integrated=yes` | This repository is connected: reviews get the real baseline and the code-context graph. Nothing to say beyond confirming it. |
   | `integrated=no link=<url>` | The tenant is fine but **this repository is not connected**. Give them the link and say what it is for: installing the CloudAEye GitHub App and selecting this repository. Reviews still work meanwhile, against local `HEAD`, with no baseline branch and no code graph, so this is "worth doing", not "must do first". |
   | `browser_open=yes` | A tab was opened at that link. Only say a browser opened if you see this line — **it is the one fact you cannot infer.** Claiming a tab opened when none did sends the user looking for a window that is not there. |
   | `browser_open=no` | No handler, or the launch failed. Say nothing about browsers; just give them the link to open themselves. Nothing else is wrong. |
   | `integrated=unknown` | The session response had neither field — usually an older server. Ignore it rather than guessing. |

   Then tell them what they can run — **all six, with a few words each on when**.
   This is the only moment the plugin gets to tell someone what it does, so a
   name they never see here is a command they never run:

   - `/cloudaeye:inspect` — bug pass, cheap enough for after every coding task
   - `/cloudaeye:security` — security pass: OWASP, LLM/agent surfaces, leaked secrets
   - `/cloudaeye:review` — both of the above, before a significant PR
   - `/cloudaeye:describe` — a PR description or commit message for the pending diff
   - `/cloudaeye:ask` — a question about the change, answered against the code graph
   - `/cloudaeye:check-task` — does this diff actually do what the ticket asked?

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
