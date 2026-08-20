---
name: check-task
description: Check whether the uncommitted changes in this repo actually do what the task asked. Takes a GitHub issue URL, Jira ticket IDs, a mixed reference list, or freeform task text, and returns a DONE / NOT DONE verdict with a per-requirement checklist and the gaps.
when_to_use: Use before marking work complete, or when the user asks whether the change satisfies an issue, a ticket, or the request they made. Accepts an issue URL, IDs like BETA-5225, a list of both, or plain text.
argument-hint: "[issue URL | TICKET-123 | task description]"
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__check_task", "mcp__cloudaeye__check_task"]
---

## Arguments

The skill accepts an optional task spec as its invocation argument. When present, use it as the task input and **do not re-prompt** the user (still confirm before reusing a `prior_task`). Recognised forms:

- **Jira ticket IDs** — a bracketed or bare comma list of `PROJECT-NUMBER` keys, e.g. `/cloudaeye:check-task [BETA-5225, BETA-5223]` or `/cloudaeye:check-task BETA-5225`. Detect with `\b[A-Z][A-Z0-9]+-\d+\b`. Route to `task_source="jira"`.
- **GitHub issue URL** — `https://github.com/<owner>/<repo>/issues/<n>`. Route to `task_source="github-issue"`. Short refs (`#42`, `owner/repo#42`) and mixed Jira+GitHub lists (`[BETA-5225, #42]`) also resolve server-side.
- **Freeform text** — anything else. Route to `task_source="user-text"` (or `jira`/`spec` if the text is clearly that). Text that merely *mentions* tickets ("verify BETA-5225 is handled, keep retries intact") is fine as-is — a server-side triage model extracts the references and keeps the extra requirements; don't restructure it.

With no argument, fall back to asking the user (step 2).

## Steps

1. Bootstrap the review session. **Run this entire block as one Bash call, as the first thing you do** — don't split it into steps, and don't "check first" with `ls`, `git status`, or `git diff`. Every extra call is another permission prompt and another round-trip before any work starts.

   ```bash
   cd "$(git rev-parse --show-toplevel)" || exit 1
   # python3 on Windows is often an alias stub, python is absent on many Linux
   # images: pick one that actually runs rather than guessing.
   for c in python python3 py; do command -v $c >/dev/null 2>&1 && $c -c "" 2>/dev/null && { PY=$c; break; }; done
   [ -n "$PY" ] || { echo "cloudaeye_error=python_not_found"; exit 1; }
   # Self-gitignore BEFORE the intent-to-add below, or the review reads its own scratch.
   mkdir -p .cloudaeye/session && printf '*\n' > .cloudaeye/.gitignore
   # Nothing but session files lives in the working tree. The API key and the
   # resolved config go to a private temp dir instead, created 0700 by mktemp and
   # removed however this block ends — a live credential has no business sitting
   # in someone's checkout, gitignored or not.
   CE_TMP=$(mktemp -d 2>/dev/null) || CE_TMP="${TMPDIR:-${TMP:-/tmp}}/cloudaeye-$$"
   mkdir -p "$CE_TMP" || { echo "cloudaeye_error=bad_config"; exit 1; }
   trap 'rm -rf "$CE_TMP"' EXIT INT TERM
   REPO=$(basename -s .git "$(git config --get remote.origin.url)"); [ -n "$REPO" ] || REPO=$(basename "$PWD")
   BRANCH=$(git rev-parse --abbrev-ref HEAD); HEAD_SHA=$(git rev-parse HEAD)
   # Nothing about the developer lives in the project. The key, tenant, user and
   # server URL resolve per field from, in order:
   #
   #   env     CLOUDAEYE_* in the environment. The escape hatch for CI and
   #           on-prem, and the only layer settable without the plugin.
   #   plugin  CLAUDE_PLUGIN_OPTION_*, the values Claude Code prompts for at
   #           install time from `userConfig` in plugin.json, with the key held
   #           in the OS keychain rather than a file. Storing a plugin's own
   #           credential is what that mechanism is for, so it is the intended
   #           path for a normal install.
   #   pdata   the file scripts/sync-creds.sh writes into the plugin data dir
   #           from those same values. Needed only if CLAUDE_PLUGIN_OPTION_* does
   #           not reach a Bash tool call: it is documented as reaching hook and
   #           MCP subprocesses, which is not the same thing. auth_from= names
   #           whichever of the two answered, so the first install settles it and
   #           the loser can be deleted.
   #   claude  headers on the cloudaeye entry in ~/.claude.json, which
   #           `claude mcp add` writes and a plugin install does not. An escape
   #           hatch, not a feature: .claude.json is Claude Code's file, so a
   #           change to its shape would otherwise break every skill at once.
   #
   # Read projects[cwd] before the root mcpServers, matching how Claude Code
   # resolves local scope over user scope. NOT ~/.claude/mcp.json: that file is
   # inert, Claude Code never reads it, and a key placed there would authenticate
   # these curl calls while every MCP tool call went out bare.
   #
   # There is deliberately no "set these environment variables" step any more.
   # On Windows a process inherits its parent's environment block, so `setx`
   # never reaches a Claude Code that is already running. Observed 2026-08-17:
   # every claude.exe on the machine descended from one root process older than
   # the setx, so each restart re-inherited the same stale block and the failure
   # presented as a server fault for hours. Not tested on macOS or Linux -- the
   # plugin path sidesteps the question rather than answering it.
   #
   # Everything is written to files, never read back through a shell var: Windows
   # python emits CRLF and a stray \r corrupts JSON, the URL and any git ref.
   # The key goes to a curl config file rather than the command line so it stays
   # out of the process table, and is filtered to key characters first: an
   # unfiltered value injects curl directives (output/upload-file/proxy).
   $PY -c "import glob,json,os,re,sys;L=lambda p:(json.load(open(p,encoding='utf-8')) if p and os.path.exists(p) else {});H=os.path.expanduser('~');C=L(os.path.join(H,'.claude.json'));M=lambda d:((d or {}).get('mcpServers') or {}).get('cloudaeye') or {};S=M((C.get('projects') or {}).get(os.getcwd())) or M(C);D=S.get('headers') or {};E=os.environ.get;PO=lambda f:E('CLAUDE_PLUGIN_OPTION_'+f.upper());GL=glob.glob(os.path.join(H,'.claude','plugins','data','*','cloudaeye-creds.json'));G=max(GL,key=os.path.getmtime) if GL else '';LAY=[('env',{'api_key':E('CLOUDAEYE_API_KEY'),'tenant_key':E('CLOUDAEYE_TENANT_KEY'),'user_name':E('CLOUDAEYE_USER_NAME'),'url':E('CLOUDAEYE_URL')}),('plugin',{'api_key':PO('api_key'),'tenant_key':PO('tenant_key'),'user_name':PO('user_name'),'url':PO('url')}),('pdata',L(G)),('claude',{'api_key':D.get('X-Product-API-Key'),'tenant_key':D.get('X-Tenant-Key'),'user_name':D.get('X-User-Name'),'url':str(S.get('url') or '').rstrip('/')})];P=lambda f:next(((str(l.get(f) or '').strip(),n) for n,l in LAY if str(l.get(f) or '').strip()),('','none'));k,o=P('api_key');k=k if re.fullmatch(r'[A-Za-z0-9._-]{8,128}',k) else '';W=lambda n,b:open(os.path.join(sys.argv[4],n),'wb').write(b);json.dump({'repo':sys.argv[1],'branch':sys.argv[2],'head':sys.argv[3],'tenant_key':P('tenant_key')[0],'user_name':P('user_name')[0]},open('.cloudaeye/session/req.json','w'));W('curl.cfg',('header = \"X-Product-API-Key: %s\"\n' % k).encode() if k else b'');W('base_url',(P('url')[0] or 'https://api.cloudaeye.com/mcp').encode());W('origin',(o if k else 'none').encode())" "$REPO" "$BRANCH" "$HEAD_SHA" "$CE_TMP"
   [ -s .cloudaeye/session/req.json ] || { echo "cloudaeye_error=bad_config"; exit 1; }
   CFG="$CE_TMP/curl.cfg"; [ -f "$CFG" ] || : > "$CFG"
   CE=$(cat "$CE_TMP/base_url" | tr -d '\r\n'); ORIGIN=$(cat "$CE_TMP/origin" | tr -d '\r\n')
   # The key travels in a header, so anything off-box must be https or it crosses
   # the network in clear. Refuse rather than leak; localhost has no hop to sniff.
   case "$CE" in https://*|http://localhost*|http://127.0.0.1*) ;; *) echo "cloudaeye_error=insecure_url url=$CE auth_from=$ORIGIN"; exit 1;; esac
   # No key resolved from any layer. Fail here in milliseconds rather than after a
   # round-trip, and name it as "never set up" rather than "key rejected" — the fix
   # is a credential, not a retry. Localhost is exempt: a dev server started
   # with CLOUDAEYE_AUTH_DISABLED takes unauthenticated sessions.
   case "$ORIGIN:$CE" in
     none:http://localhost*|none:http://127.0.0.1*|none:https://localhost*|none:https://127.0.0.1*) ;;
     none:*) echo "cloudaeye_error=not_configured url=$CE"; exit 1;;
   esac
   # Removed first: on a connection failure curl leaves the previous run's file
   # in place, and a stale session id parses fine and reviews the wrong session.
   rm -f .cloudaeye/session/session.json
   S_HTTP=$(curl -s -m 30 -K "$CFG" -o .cloudaeye/session/session.json -w '%{http_code}' \
     -X POST "$CE/session" -H 'Content-Type: application/json' -d @.cloudaeye/session/req.json)
   # Only 200 continues. Auth failures are named as themselves rather than as
   # "the server never answered": the fix is a config edit, not a retry.
   case "$S_HTTP" in
     200) ;;
     400|401|403) echo "cloudaeye_error=auth_failed http=$S_HTTP auth_from=$ORIGIN"; cat .cloudaeye/session/session.json 2>/dev/null; echo; exit 1;;
     *) echo "cloudaeye_error=session_failed http=$S_HTTP url=$CE auth_from=$ORIGIN"; cat .cloudaeye/session/session.json 2>/dev/null; echo; exit 1;;
   esac
   SESSION_ID=$($PY -c "import json;print(json.load(open('.cloudaeye/session/session.json'))['session_id'])" 2>/dev/null | tr -d '\r\n')
   [ -n "$SESSION_ID" ] || { echo "cloudaeye_error=session_failed url=$CE auth_from=$ORIGIN"; cat .cloudaeye/session/session.json 2>/dev/null; exit 1; }
   TARGET=$($PY -c "import json;print(json.load(open('.cloudaeye/session/session.json')).get('target_branch') or '')" | tr -d '\r\n')
   # TARGET is server-supplied and reaches `git fetch` in argument position, where a
   # leading dash is parsed as an option: `--upload-pack=<cmd>` is arbitrary command
   # execution. Anything that is not a plain branch name is dropped, degrading to HEAD.
   case "$TARGET" in ''|-*|*[!A-Za-z0-9._/-]*) TARGET="";; esac
   BASE=""; SRC=fork_point
   if [ -n "$TARGET" ]; then
     # Fetch only when the ref is missing; every credential prompt is disarmed so a
     # missing credential fails in milliseconds instead of hanging the skill.
     git rev-parse --verify -q "origin/$TARGET" >/dev/null 2>&1 || \
       GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never GIT_ASKPASS=echo \
       git -c credential.helper= fetch -q origin "$TARGET" 2>/dev/null
     BASE=$(git merge-base "origin/$TARGET" HEAD 2>/dev/null)   # fork point, not the tip
   fi
   [ -n "$BASE" ] || { BASE=$HEAD_SHA; SRC=head; }
   git add --intent-to-add . >/dev/null 2>&1     # non-destructive; makes new files visible
   git diff "$BASE" > .cloudaeye/session/session.diff
   UP=$(curl -s -m 120 -K "$CFG" -o /dev/null -w '%{http_code}' -F "file=@.cloudaeye/session/session.diff" \
     -F "base_sha=$BASE" "$CE/upload/$SESSION_ID")
   echo "session_id=$SESSION_ID base_source=$SRC base_age=$(git log -1 --format=%cr "origin/$TARGET" 2>/dev/null || echo unknown)"
   echo "diff_bytes=$(wc -c < .cloudaeye/session/session.diff) diff_files=$(git diff --name-only "$BASE" | wc -l) upload_http=$UP auth_from=$ORIGIN url=$CE"
   cat .cloudaeye/session/session.json; echo
   ```

   The block resets the scratch workspace, mints or resumes the review session on the server, resolves the baseline, captures the diff and uploads it. If CloudAEye's `check_task` tool schema is not loaded yet, load it **in the same message** as this command so the two overlap instead of queueing.

   It prints two summary lines and then the raw session JSON. Read them — don't re-derive any of it:

   | output | what to do with it |
   |---|---|
   | `cloudaeye_error=…` | Stop and report it. **Every one of these lines carries `auth_from=` — read it rather than inferring whether credentials resolved.** A failure that is not about credentials still prints the layer that supplied them. `auth_failed` = the key was refused and the JSON body below says which (missing/invalid/inactive key, a tenant the key does not belong to, or a key without the `Code Review` product) — the fix is a credential change, not a retry, so tell the user the key on this machine has to change. `not_configured` = no credentials on this machine at all (see the next row). `insecure_url` = an off-box server over plain `http`, refused because the key would cross the network in clear. `session_failed` = nothing answered at that URL. `bad_config` = the config JSON is malformed. `python_not_found` = no usable interpreter on PATH. |
   | `cloudaeye_error=not_configured` | No CloudAEye credentials were found on this machine. Nothing else in this skill can run. Tell the user to run `/cloudaeye:init`, which signs them in through the browser and stores them, then stop — don't substitute your own reading of the diff for the CloudAEye run. |
   | `session_id=…` | Pass it to the MCP tool. |
   | `diff_bytes=0` | Nothing pending — report "nothing to check — no pending changes" and stop. |
   | `base_source=fork_point` | Correct baseline: the fork point off the integrated branch, not its tip. Name the branch and `base_age` — a year-old `base_age` means anything merged since is invisible here. |
   | `base_source=head` | Degraded: only working-tree edits are in the diff. Say so, and pass on `target_branch_error` from the JSON if it is set. |
   | `upload_http=` not `200` | The diff never reached the server. Stop — the call would run against absent or stale content and still look clean. |
   | `auth_from=` | Which layer supplied the key — `env`, `plugin` (the plugin's own settings), `pdata` (the file `/cloudaeye:init` wrote), or `claude` (`~/.claude.json`). `auth_from=none` can only reach this line against a localhost server, and means that server has auth switched off; anywhere else it short-circuits above as `not_configured`. |
   | a `target_branch_error` about `tenant_key` | The tenant authenticated but the repo isn't integrated under it: no baseline branch, no code-context graph. It still runs, against local `HEAD`. Say it once. |
   | `prior_task` in the JSON | A task this review session was already checked against. Offer it for reuse in step 2 — never reuse it silently. |

   **Which baseline applied must reach the user.** Every degradation still produces output that looks correct, so silence about it is the one failure mode that misleads. Keeping the clone current is the developer's job — the skill never forces a fetch, it just refuses to hide what it used.
2. Establish the task to verify against. This is the one input the user must supply:
   - **If an invocation argument was given** (see Arguments above), use it — skip the prompt.
   - **Else if step 1 printed a non-empty `prior_task`** (a `check_task` ran against this review session before, no commit since), offer to reuse it: show `prior_task.task_description` (truncated) and ask "verify against this same task again, or a new one?" Don't silently reuse — confirm first.
   - **Otherwise ask the user** for one of:
     - a **GitHub issue URL** (`https://github.com/<owner>/<repo>/issues/<n>`) → set `task_source="github-issue"` and pass the URL verbatim as `task_description`. The server re-fetches title + body + comments on every call, so new collaborator comments flow through automatically — never paste the issue body yourself when a URL is available.
     - **Jira ticket IDs** (`[BETA-5225, BETA-5223]`) → set `task_source="jira"` and pass the comma-separated keys (brackets stripped, e.g. `BETA-5225, BETA-5223`) as `task_description`. Each ticket is fetched server-side (summary + description, re-pulled every call).
     - **freeform task text** (a spec excerpt or plain description) → pass it verbatim as `task_description` and set `task_source` to `spec` or `user-text`.
   - Do not summarise or paraphrase the task. The server extracts requirements from the exact text.
3. Write a one-paragraph `intent` describing **the code change you just made in this round of edits** — used by the verifier as a focus signal (it still verifies every claim against the actual diff).
   - **Do not read the diff to write this.** No `cat .cloudaeye/session/session.diff`, no `git diff`. You made these edits — the intent comes from your own working context. The diff is already uploaded and the server is what analyses it, so reading it back spends the developer's context window re-deriving what you already know, on a file that can run to thousands of lines. If you genuinely did not make the changes (a resumed session, or the user edited by hand), say that in one line and use `git diff --stat` for the file list — never the full diff.
   - **First check on a review session:** describe what you implemented and why.
   - **Re-check after the user asked you to close gaps:** reference the prior gaps by number and explain how each was addressed, or why it was intentionally left. Don't restate the original task — the verifier already has it via `task_description`.
4. Call CloudAEye's `check_task` MCP tool with:
   - `session_id`: the `session_id` printed by step 1
   - `task_description`: the URL (github-issue) or verbatim task text from step 2
   - `task_source`: `github-issue` / `jira` / `spec` / `user-text` (defaults to `user-supplied` if omitted)
   - `intent`: the summary from step 3
   - `context`: optional — only for `pr_title` / `pr_description`. Identity fields are already on the review session.

   Its full name depends on how CloudAEye was installed — `mcp__plugin_cloudaeye_cloudaeye__check_task` from the plugin marketplace, `mcp__cloudaeye__check_task` if the server was registered by hand with `claude mcp add`. Both are pre-approved in this skill's frontmatter, so use whichever one is in your tool list and don't ask for permission first.

   You do **not** need to read the changed source files yourself before calling — the server has the post-edit file contents staged and examines them via its own tooling.
5. Print the `report` field from the response verbatim. It is rendered markdown — a `# Task Completion Check` heading, a status line, a progress bar over met requirements, a per-requirement table (✅ done / ⚠️ partial / ❌ not done), gaps, and any out-of-scope changes. Don't re-summarise or re-format it; the counts and the bar are computed server-side and re-typing them is how they drift.

   Check `context_refresh.status` first. On `skipped` or `failed` the stored code graph was not refreshed with this diff, so the answer is based on the pre-edit code plus the diff text alone — say so in one line and quote `context_refresh.reason`. It is usually an expired GitHub installation token, which the user has to fix server-side.

   The response also carries a machine-readable `verdict`: **`DONE`** (every requirement met), **`NOT_DONE`** (anything less — a single partial requirement is not "done"), or **`ERROR`** (the check could not run; not a judgement on the change). On `NOT_DONE`, ask the user whether they'd like you to close the listed gaps. Don't start editing until the user replies; if they say yes, make the edits and re-invoke `/cloudaeye:check-task` (the server resumes the same review session and offers the prior task for reuse). On `ERROR`, say what failed and offer the workaround — usually pasting the ticket body as freeform text.

## Notes

- This is a **single-shot** skill — one call, print the output, done. No fix-and-retry loop inside the skill.
- **The task is persisted on the review session.** After a successful check, a later `POST /session` resume surfaces it as `prior_task` so the user isn't re-prompted. For `github-issue` the stored value is the URL (re-fetched each call), not a frozen snapshot — so a re-check picks up new issue comments.
- **GitHub fetch requires `client_git_token` on the server.** If it's missing, or the URL is malformed / the token lacks access, `check_task` returns a structured `error` (not a verdict) — surface it and offer to let the user paste the issue body as freeform `user-text` instead.
- **Jira fetch goes through the tenant's CloudAEye Jira (Forge) app — same integration as cloud reviews.** The tenant number is **client-supplied**: `tenant_key` comes from the machine's own config — the environment, the `cloudaeye` entry in `~/.claude.json`, or `~/.cloudaeye/config.json` — never from anything inside the repo, and it rides along on the `POST /session` in step 1. The server side needs `BITBUCKET_FUNCTION_KEY` and the Mongo store (`TEST_RCA_MONGODB_URL`), and the tenant must have the CloudAEye Jira app installed. Missing tenant key → Jira refs return a clear error telling the client to pass it. When they're missing or a key doesn't resolve: a task that is *only* ticket refs returns a structured `error` (nothing to judge — surface it and offer pasting the ticket body as `user-text`); a task that also carries prose proceeds against the prose with a visible "reference(s) not checked" note in the report. A partially-resolved list likewise carries a note — a verdict never silently implies an unfetched ticket was verified.
- Pre-commit only: the diff is always `git diff` (working tree vs `HEAD`). Committing moves `HEAD`, but the review session persists — its recorded `head` is refreshed on the next call, and the stored task carries across, so `prior_task` still comes back after a commit.
- Without `client_git_token` / `client_git_owner` configured, the code-context refresh is skipped and verification falls back to diff-only analysis (still works, just less precise on end-to-end wiring).
- If `check_task` is unavailable (MCP not connected), warn the user and skip — do not attempt to judge the diff against the task yourself from `git diff` output.
- The full investigation trace is logged on the server under `query_logs/` keyed by `run_id` (included in the response's `eval_summary`).
