---
name: inspect
description: Bug-hunting CloudAEye pass over the uncommitted changes in this repo — logic errors, edge cases, input validation, error handling, concurrency, dead imports. No security prompts, so it is the cheap pass to run after finishing a coding task. Reports findings; it never edits code on its own.
when_to_use: Use after completing a coding task and before reporting done, or when the user asks you to check or review what you just changed. Security categories are opt-in — use /cloudaeye:security or /cloudaeye:review for those.
allowed-tools: mcp__cloudaeye__inspect_diff
---

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
   # X-User-Name, plus `url` minus its /mcp suffix) — the entry `claude mcp add`
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
   $PY -c "import json,os,re,sys;L=lambda p:(json.load(open(p,encoding='utf-8')) if os.path.exists(p) else {});H=os.path.expanduser('~');C=L(os.path.join(H,'.claude.json'));M=lambda d:((d or {}).get('mcpServers') or {}).get('cloudaeye') or {};S=M((C.get('projects') or {}).get(os.getcwd())) or M(C);D=S.get('headers') or {};E=os.environ.get;LAY=[('env',{'api_key':E('CLOUDAEYE_API_KEY'),'tenant_key':E('CLOUDAEYE_TENANT_KEY'),'user_name':E('CLOUDAEYE_USER_NAME'),'url':E('CLOUDAEYE_URL')}),('claude',{'api_key':D.get('X-Product-API-Key'),'tenant_key':D.get('X-Tenant-Key'),'user_name':D.get('X-User-Name'),'url':re.sub(r'/mcp/?\Z','',str(S.get('url') or ''))}),('home',L(os.path.join(H,'.cloudaeye','config.json')))];P=lambda f:next(((str(l.get(f) or '').strip(),n) for n,l in LAY if str(l.get(f) or '').strip()),('','none'));k,o=P('api_key');k=k if re.fullmatch(r'[A-Za-z0-9._-]{8,128}',k) else '';W=lambda n,b:open(os.path.join(sys.argv[5],n),'wb').write(b);json.dump({'repo':sys.argv[1],'branch':sys.argv[2],'head':sys.argv[3],'language':sys.argv[4],'tenant_key':P('tenant_key')[0],'user_name':P('user_name')[0]},open('.cloudaeye/session/req.json','w'));W('curl.cfg',('header = \"X-Product-API-Key: %s\"\n' % k).encode() if k else b'');W('base_url',(P('url')[0] or 'http://localhost:8000').encode());W('origin',(o if k else 'none').encode())" "$REPO" "$BRANCH" "$HEAD_SHA" "$LANG_HINT" "$CE_TMP"
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
   | `diff_bytes=0` | Nothing pending — report "nothing to inspect" and stop. |
   | `base_source=fork_point` | Correct baseline: the fork point off the integrated branch, not its tip. Name the branch and `base_age` — a year-old `base_age` means anything merged since is invisible here. |
   | `base_source=head` | Degraded: only working-tree edits are in the diff. Say so, and pass on `target_branch_error` from the JSON if it is set. |
   | `upload_http=` not `200` | The diff never reached the server. Stop — the call would run against absent or stale content and still look clean. |
   | `auth_from=` | Which layer supplied the key — `home` (`~/.cloudaeye/config.json`), `env`, or `claude` (`~/.claude.json`). `auth_from=none` can only reach this line against a localhost server, and means that server has auth switched off; anywhere else it short-circuits above as `not_configured`. |
   | a `target_branch_error` about `tenant_key` | The tenant authenticated but the repo isn't integrated under it: no baseline branch, no code-context graph. It still runs, against local `HEAD`. Say it once. |

   **Which baseline applied must reach the user.** Every degradation still produces output that looks correct, so silence about it is the one failure mode that misleads. Keeping the clone current is the developer's job — the skill never forces a fetch, it just refuses to hide what it used.
2. Write a one-paragraph intent summary describing **the code change you just made in this round of edits** — not the broader task, not a re-statement of the original ask. The planner uses this verbatim to decide what to focus on. Intent is also the **only** mechanism for telling the inspector to leave a previously-flagged issue alone — there's no separate suppression channel. Be specific so the user can see, in your visible intent, what you're asking the inspector to skip.
   - **First inspect on a review session:** describe what you implemented and why.
   - **Re-inspect after the user asked you to fix something:** say which prior findings you addressed and how, plus any you intentionally left and why. Reference the prior finding's tag so the planner can map it back. Example: "Fixed `tests/test_transformers.py/issue-1` by adding `assert` around `np.array_equal`. Left `sklearn_pandas/transformers.py/issue-2` alone because the user said pandas metadata loss is acceptable for this transformer." Don't repeat the original task — the planner already saw it.
   - **Trade-offs and surprises** worth flagging belong here too (e.g. "switched serialization to pickle instead of joblib because of a Windows path issue").
3. Call the `mcp__cloudaeye__inspect_diff` MCP tool with:
   - `session_id`: the `session_id` printed by step 1
   - `intent`: the summary from step 2
   - `profile`: `"inspect"` — **always this value from this skill.** It runs the bug categories only. Do not pass `"security"` or `"review"` here; those belong to `/cloudaeye:security` and `/cloudaeye:review`, which the user invokes deliberately.
   - `context`: optional — only set for `pr_title`. Identity fields (repo/branch/head/language) are already on the review session, and `review_config` / `report_types` would override the profile.

   You do **not** need to read the changed source files yourself before calling — the server already has the post-edit file contents staged and will examine them via its own tooling. Reading them in the agent just burns tokens.
4. Report the response to the user:
   - **First: `verdict` is `error`, or the response carries a `degraded` block.** The review ran with no post-edit source staged, so every prompt saw an empty file and the secret scan never picked a detector (`secret_scan.detector: "none"` is the tell). **Report it as a failed run and stop — do not present the findings, and never call it clean.** `degraded.cause` names the upstream reason when there is one; `context_refresh.status` of `skipped`/`failed` carries it verbatim, and an expired GitHub installation token is the usual culprit. The server does not cache a degraded run, so re-running once the cause is fixed gives a real review.
   - The `verdict` (`approve` / `request_changes`).
   - **Report what came back, not what didn't.** Don't list report types that produced no findings, don't quote timings, file counts or detector names that worked, and don't explain which prompts didn't fire. The response deliberately omits that metadata; narrating its absence turns a three-line result into a wall of caveats. A diagnostic field the response *does* carry is there precisely because it changes what the result means — those you report.
   - The full list of `findings` (file, line, severity, message).
   - If there are findings, ask the user which (if any) they'd like you to fix — list them by number or tag so the user can pick. Do not start editing until the user replies. If the user picks some to fix, do those edits and then re-invoke `/cloudaeye:inspect` (the server will resume the same review session).

## Notes

- This is a **single-shot** skill — one call, report the output, done. No fix-and-retry loop inside the skill.
- **Bugs only.** This profile runs: logic errors, syntax/compile breaks, edge cases, input validation, concurrency safety, error handling, code clarity, naming consistency, and code signatures. Code signatures include a **compiler type check** over the AST graph, which catches callers broken by a changed definition even when those callers are in files this diff never touched — so a `code_signature` finding may point at a file you didn't edit. That's the point; don't dismiss it as out of scope. Security prompts are **not** part of it — they cost real tokens on every scanned file, so they are routed behind `/cloudaeye:security` (security surface only) and `/cloudaeye:review` (bugs + security). If the change touches authentication, input handling from untrusted sources, deserialization, secrets, crypto, LLM prompts, tool definitions, or agent orchestration, say so and suggest `/cloudaeye:security` — don't silently skip it, and don't run it uninvited.
- **Re-inspection is user-driven.** The user may say "fix issue X and run inspect again" — that's fine, just re-invoke this skill. The server resumes the same review session automatically from `(tenant_key, repo, user_name)`, so iteration continuity is server-handled. Your job on re-invocation is just to write a sharp intent (step 2) that describes only the most recent change.
- Pre-commit only: the diff is always `git diff` (working tree vs `HEAD`). Committing moves `HEAD`, but the review session persists — its recorded `head` is refreshed on the next call, and prior intent and task context carry across.
- If `inspect_diff` is unavailable (MCP not connected), warn the user and skip.
