---
name: review
description: Full CloudAEye review of the uncommitted changes in this repo — bugs and security in one pass. Reports findings with file, line and severity, grouped by kind; it never edits code on its own. The widest and most expensive of the CloudAEye passes.
when_to_use: Use before opening a significant PR, or when the user asks for a full, complete or thorough review. For the routine check after finishing a task use /cloudaeye:inspect; for the security surface alone use /cloudaeye:security.
allowed-tools: mcp__cloudaeye__inspect_diff
---

## When to run

The user invoked `/cloudaeye:review`, or asked for a full/complete/thorough review. This is the widest pass: everything `/cloudaeye:inspect` checks **plus** everything `/cloudaeye:security` checks, in a single call.

It costs more than either alone — every enabled category rides in the per-file scan prompt. For the routine after-a-coding-task check, `/cloudaeye:inspect` is the right skill. Reach for this one before a significant PR, on a change large enough to warrant the extra passes, or when the user asks for it by name.

## Steps

1. Bootstrap the review session. **Run this entire block as one Bash call, as the first thing you do** — don't split it into steps, and don't "check first" with `ls`, `git status`, or `git diff`. Every extra call is another permission prompt and another round-trip before any work starts.

   ```bash
   LANG_HINT=python                      # <- this repo's primary language
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
   # server URL resolve per field from, in order: the environment; the cloudaeye
   # entry in ~/.claude.json (headers X-Product-API-Key / X-Tenant-Key /
   # X-User-Name, plus `url` verbatim: the transport is served at the ingress
   # prefix itself, so the base URL and the transport URL are one string) — the
   # entry `claude mcp add`
   # writes, which a hand-registered server has and a plugin install does not;
   # then ~/.cloudaeye/config.json, which is the layer a plugin install
   # normally resolves from.
   # Read projects[cwd] before the root mcpServers,
   # matching how Claude Code resolves local scope over user scope. NOT
   # ~/.claude/mcp.json: that file is inert, Claude Code never reads it, and a key
   # placed there would authenticate these curl calls while every MCP tool call
   # went out bare. The outer two layers are an escape hatch, not a feature —
   # .claude.json is Claude Code's file, so a change to its shape would otherwise
   # break every skill at once with no way to supply a key.
   # Everything is written to files, never read back through a shell var: Windows
   # python emits CRLF and a stray \r corrupts JSON, the URL and any git ref.
   # The key goes to a curl config file rather than the command line so it stays
   # out of the process table, and is filtered to key characters first: an
   # unfiltered value injects curl directives (output/upload-file/proxy).
   $PY -c "import json,os,re,sys;L=lambda p:(json.load(open(p,encoding='utf-8')) if os.path.exists(p) else {});H=os.path.expanduser('~');C=L(os.path.join(H,'.claude.json'));M=lambda d:((d or {}).get('mcpServers') or {}).get('cloudaeye') or {};S=M((C.get('projects') or {}).get(os.getcwd())) or M(C);D=S.get('headers') or {};E=os.environ.get;LAY=[('env',{'api_key':E('CLOUDAEYE_API_KEY'),'tenant_key':E('CLOUDAEYE_TENANT_KEY'),'user_name':E('CLOUDAEYE_USER_NAME'),'url':E('CLOUDAEYE_URL')}),('claude',{'api_key':D.get('X-Product-API-Key'),'tenant_key':D.get('X-Tenant-Key'),'user_name':D.get('X-User-Name'),'url':str(S.get('url') or '').rstrip('/')}),('home',L(os.path.join(H,'.cloudaeye','config.json')))];P=lambda f:next(((str(l.get(f) or '').strip(),n) for n,l in LAY if str(l.get(f) or '').strip()),('','none'));k,o=P('api_key');k=k if re.fullmatch(r'[A-Za-z0-9._-]{8,128}',k) else '';W=lambda n,b:open(os.path.join(sys.argv[5],n),'wb').write(b);json.dump({'repo':sys.argv[1],'branch':sys.argv[2],'head':sys.argv[3],'language':sys.argv[4],'tenant_key':P('tenant_key')[0],'user_name':P('user_name')[0]},open('.cloudaeye/session/req.json','w'));W('curl.cfg',('header = \"X-Product-API-Key: %s\"\n' % k).encode() if k else b'');W('base_url',(P('url')[0] or 'http://localhost:8000').encode());W('origin',(o if k else 'none').encode())" "$REPO" "$BRANCH" "$HEAD_SHA" "$LANG_HINT" "$CE_TMP"
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

   Set `LANG_HINT` to the repo's primary language. The block resets the scratch workspace, mints or resumes the review session on the server, resolves the baseline, captures the diff and uploads it. If the `mcp__cloudaeye__inspect_diff` schema is not loaded yet, load it **in the same message** as this command so the two overlap instead of queueing.

   It prints two summary lines and then the raw session JSON. Read them — don't re-derive any of it:

   | output | what to do with it |
   |---|---|
   | `cloudaeye_error=…` | Stop and report it. **Every one of these lines carries `auth_from=` — read it rather than inferring whether credentials resolved.** A failure that is not about credentials still prints the layer that supplied them. `auth_failed` = the key was refused and the JSON body below says which (missing/invalid/inactive key, a tenant the key does not belong to, or a key without the `Code Review` product) — the fix is a credential change, not a retry, so tell the user the key on this machine has to change. `not_configured` = no credentials on this machine at all (see the next row). `insecure_url` = an off-box server over plain `http`, refused because the key would cross the network in clear. `session_failed` = nothing answered at that URL. `bad_config` = the config JSON is malformed. `python_not_found` = no usable interpreter on PATH. |
   | `cloudaeye_error=not_configured` | No CloudAEye credentials were found on this machine. Nothing else in this skill can run. Tell the user CloudAEye is not set up on this machine, then stop — don't substitute your own reading of the diff for the CloudAEye run. |
   | `session_id=…` | Pass it to the MCP tool. |
   | `diff_bytes=0` | Nothing pending — report "nothing to review" and stop. |
   | `base_source=fork_point` | Correct baseline: the fork point off the integrated branch, not its tip. Name the branch and `base_age` — a year-old `base_age` means anything merged since is invisible here. |
   | `base_source=head` | Degraded: only working-tree edits are in the diff. Say so, and pass on `target_branch_error` from the JSON if it is set. |
   | `upload_http=` not `200` | The diff never reached the server. Stop — the call would run against absent or stale content and still look clean. |
   | `auth_from=` | Which layer supplied the key — `home` (`~/.cloudaeye/config.json`), `env`, or `claude` (`~/.claude.json`). `auth_from=none` can only reach this line against a localhost server, and means that server has auth switched off; anywhere else it short-circuits above as `not_configured`. |
   | a `target_branch_error` about `tenant_key` | The tenant authenticated but the repo isn't integrated under it: no baseline branch, no code-context graph. It still runs, against local `HEAD`. Say it once. |

   **Which baseline applied must reach the user.** Every degradation still produces output that looks correct, so silence about it is the one failure mode that misleads. Keeping the clone current is the developer's job — the skill never forces a fetch, it just refuses to hide what it used.
2. Write a one-paragraph intent summary describing **the code change you just made in this round of edits** — what you implemented and why, plus any security-relevant surface it touches (untrusted input, auth, secrets, serialization, prompts, tool definitions). Not a re-statement of the original ask. The planner uses this verbatim to prioritise within the full category set, and it is the **only** channel for telling the reviewer to leave a previously-flagged issue alone — so if you are asking it to skip something, say which finding and why, in words the user can see.
   - **Do not read the diff to write this.** No `cat .cloudaeye/session/session.diff`, no `git diff`. You made these edits — the intent comes from your own working context. The diff is already uploaded and the server is what analyses it, so reading it back spends the developer's context window re-deriving what you already know, on a file that can run to thousands of lines. If you genuinely did not make the changes (a resumed session, or the user edited by hand), say that in one line and use `git diff --stat` for the file list — never the full diff.
3. Call the `mcp__cloudaeye__inspect_diff` MCP tool with:
   - `session_id`: the `session_id` printed by step 1
   - `intent`: the summary from step 2
   - `profile`: `"review"` — **always this value from this skill.** It selects every valid prompt: the bug categories and the full security surface.
   - `context`: optional — only set for `pr_title` / `pr_description`. Do not pass `review_config` or `report_types`; either one overrides the profile and narrows the review you were asked to run.

   You do **not** need to read the changed source files yourself before calling — the server has the post-edit contents staged and examines them with its own tooling.
4. Report the response to the user:
   - **First: `verdict` is `error`, or the response carries a `degraded` block.** The review ran with no post-edit source staged, so every prompt saw an empty file and the secret scan never picked a detector (`secret_scan.detector: "none"` is the tell). **Report it as a failed run and stop — do not present the findings, and never call it clean.** `degraded.cause` names the upstream reason when there is one; `context_refresh.status` of `skipped`/`failed` carries it verbatim, and an expired GitHub installation token is the usual culprit. The server does not cache a degraded run, so re-running once the cause is fixed gives a real review.
   - The `verdict` (`approve` / `request_changes`).
   - **Report what came back, not what didn't.** Don't list report types that produced no findings, don't quote timings, file counts or detector names that worked, and don't explain which prompts didn't fire. The response deliberately omits that metadata; narrating its absence turns a three-line result into a wall of caveats. A diagnostic field the response *does* carry is there precisely because it changes what the result means — those you report.
   - Every finding, **grouped by `report_type`** — leaked secrets first (a committed credential has a clock on it), then bugs, then application security, then LLM / AI-agent / MCP security. Within each group give file, line, severity, and message. The grouping is what makes a long list readable; don't flatten it.
   - The `counts` roll-up, so the user sees the shape before the detail.
   - If there are findings, ask which (if any) to fix — list them by number or tag. Do not start editing until the user replies. After fixing, re-invoke this skill (the server resumes the same review session) and write a fresh intent naming the findings you addressed.

## What this profile runs

Everything the pipeline supports:

- **BUG_REPORT** — logic errors, syntax/compile breaks, edge cases, input validation, concurrency safety, error handling, code clarity, naming consistency, code signatures, performance, dead imports.
- **SECURITY_REPORT** — injection, auth and access, sensitive-data handling, deserialization, security misconfiguration, XXE.
- **LLM_SECURITY_REPORT / AIAGENT_SECURITY_REPORT / MCP_REPORT** — the LLM, agent, and MCP security surfaces. Pattern-gated server-side: the planner attaches them only to file groups with matching evidence, so a repo with no LLM/agent/MCP code pays nothing for them.
- **SECRET_REPORT** — hardcoded credentials on the changed lines, found by gitleaks (or a regex fallback) and validated by the model. Report these **first**; a committed credential is the one finding with a clock on it.

Duplicate-code detection is not part of any profile here — it needs the vector store that the pre-commit server doesn't run.

## Notes

- **Single-shot** — one call, report the output, done. No fix-and-retry loop inside the skill.
- Expect more findings, and more low-severity ones, than `/cloudaeye:inspect`. Present them by severity within each report type so the user can triage rather than wade.
- Pre-commit only: the diff is always `git diff` (working tree vs `HEAD`). Committing moves `HEAD`, but the review session persists — its recorded `head` is refreshed on the next call, and prior intent carries across.
- If `inspect_diff` is unavailable (MCP not connected), warn the user and skip.
