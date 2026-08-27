---
name: security
description: Security review of the uncommitted changes in this repo, of one file or directory of them, or of an open pull request given its number — OWASP-style application security plus the LLM, AI-agent and MCP surfaces, and secrets leaked on the changed lines. Reports findings with file, line and severity; it never edits code on its own.
when_to_use: Use when the change touches auth, untrusted input, secrets, crypto, deserialization, prompts, tool definitions or agent orchestration, or whenever the user asks for a security review.
argument-hint: "[optional: a path like src/auth/, or a PR number like #5]"
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__initialize_repository", "mcp__cloudaeye__initialize_repository","mcp__plugin_cloudaeye_cloudaeye__start_session", "mcp__cloudaeye__start_session", "mcp__plugin_cloudaeye_cloudaeye__inspect_diff", "mcp__cloudaeye__inspect_diff"]
---

## When to run

The user invoked `/cloudaeye:security`, or asked for a security review of the pending change. This is the **only** skill that turns the security prompts on for a security-only pass — `/cloudaeye:inspect` deliberately runs bugs only, and `/cloudaeye:review` runs both.

Do not run this uninvited after an ordinary coding task. Do suggest it (without running it) when the change touches:

- authentication, authorization, session or token handling
- input arriving from an untrusted source (HTTP, queue, file upload, CLI)
- deserialization, XML parsing, template rendering, shell or SQL construction
- secrets, credentials, crypto, or anything written to logs
- LLM prompts, tool/function definitions, MCP servers, or agent loops

## Three modes

The argument decides which. Read it before anything else:

| Argument | Mode |
|---|---|
| *none* | **Working tree** — every uncommitted change. This is the usual one. |
| `#405`, or bare digits like `405` | **Pull request** — PR 405 of this repository. |
| anything else — `src/auth/login.ts`, `src/auth/`, `src/auth` | **Path** — only the changes under that file or directory. |

Digits mean a pull request. If the user really means a directory named `405`, they write `./405` and you treat it as a path.

### Path mode

The scope is applied where the diff is made — `git diff <base> -- <path>` — so only that subtree is ever uploaded. A directory covers everything beneath it; a file covers just that file.

**Say what was excluded.** The scoped diff is a subset, so `approve` here means "approve for that path" and reads exactly like "approve". Always name the scope and how many of the changed files it left out — "reviewed 2 of 7 changed files (src/auth/)". The response echoes a `scope` field for the same reason; do not drop it.

**A scoped review is blind outside the scope by construction.** The cross-file checks — the compiler pass that catches callers broken by a changed signature — can only see files in the diff, so a break in a file the path excluded will not be found. Worth one line to the user when the excluded count is not zero.

If the path matches nothing in the diff, say so naming the path and stop. Do not silently widen to the whole change.

### Pull-request mode

Reviews an open pull request of *this* repository. The server fetches the diff from GitHub itself, so there is no upload step and no diff leaves the machine; only the repository identity is read locally.

A pull request must be **open** (drafts are fine), must merge into this repository's **integrated branch** — the one connected to CloudAEye — must **not come from a fork**, and must change **at most 50 files**. The server checks all four before doing any review work and refuses with a reason naming what to do. Report that reason as written and stop — never fall back to reviewing the working tree, which is a different change and would read as an answer to the question the user asked.

## Steps

### Repository initialization gate

Before creating a session, run the bundled preflight helper and call the
session-free initialization tool. This is required before every operational command.

```bash
   for c in python python3 py; do command -v "$c" >/dev/null 2>&1 && "$c" -c "" 2>/dev/null && { PY=$c; break; }; done
   [ -n "$PY" ] || { echo "cloudaeye_error=python_not_found"; exit 1; }
   META=$("$PY" "${CLAUDE_PLUGIN_ROOT}/scripts/repository_preflight.py") || { printf '%s\n' "$META"; exit 1; }
printf '%s\n' "$META"
```

Call `mcp__plugin_cloudaeye_cloudaeye__initialize_repository` with the detected
`provider`, `repo_url`, and an empty `monitor_branch`, and keep its response as
`INIT`. If it returns `branch_required`, ask `Branch to monitor [base_branch]:`;
Enter keeps the displayed base branch. Set `BRANCH` to that answer (or the
displayed base branch); if there is no base branch, require a non-empty answer.
Rerun the helper with `--branch "$BRANCH"`, set
`MONITOR_BRANCH` from that helper result, and call initialization again with
`monitor_branch=MONITOR_BRANCH`. Keep the same `MONITOR_BRANCH` for every retry.

If initialization returns `setup_required`, validate and open `integration_url`
below, then poll every 10 seconds for at most 30 attempts. Each poll must call
initialization with the original `provider` and `repo_url` and the same
`monitor_branch=MONITOR_BRANCH`; replace `INIT` with each response. Continue
only after `INIT.status` is `ready` or `initialized`; stop on errors, conflicts,
or timeout. Never treat `provider_connected` alone as success.

When `INIT.status` is `ready` or `initialized`, use `INIT.repo_full` as the
authoritative `repo` for `start_session`. Do not recompute it from local Git.

```bash
LINK='<integration_url from the tool>'
case "$LINK" in
  https://*|http://localhost/*|http://localhost:*|http://127.0.0.1/*|http://127.0.0.1:*) ;;
  *) echo "cloudaeye_error=insecure_integration_url"; exit 1 ;;
esac
if command -v open >/dev/null 2>&1; then open "$LINK"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$LINK"
elif command -v powershell.exe >/dev/null 2>&1; then
  CE_LINK="$LINK" powershell.exe -NoProfile -Command 'Start-Process -LiteralPath $env:CE_LINK'
elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start "" "$LINK"
else printf 'quick_link=%s\n' "$LINK"
fi
```

Do not start a session until this gate reports `ready` or `initialized`.


1. Prepare and upload the review session.

   First collect the current local branch and HEAD with one Bash call.

   ```bash
   cd "$(git rev-parse --show-toplevel)" || exit 1
   for c in python python3 py; do command -v "$c" >/dev/null 2>&1 && "$c" -c "" 2>/dev/null && { PY=$c; break; }; done
   [ -n "$PY" ] || { echo "cloudaeye_error=python_not_found"; exit 1; }
   mkdir -p .cloudaeye/session && printf '*\n' > .cloudaeye/.gitignore
   BRANCH=$(git rev-parse --abbrev-ref HEAD); HEAD_SHA=$(git rev-parse HEAD)
   "$PY" -c "import json,sys;print(json.dumps(dict(branch=sys.argv[1],head=sys.argv[2])))" "$BRANCH" "$HEAD_SHA"
   ```

   Call `mcp__plugin_cloudaeye_cloudaeye__start_session` with `INIT.repo_full`, the
   current `branch`, and `head` — no `language`; the server derives the
   tech-stack hint from the uploaded diff. If the tool is unavailable or returns
   `status: error`, stop and tell the user to authenticate CloudAEye through `/mcp`.

   **Pull-request mode:** also pass `pr_number` — the digits the user gave, with any `#` stripped. Then **stop here and go to step 2**: the diff is already on the server, so the whole upload block below is skipped, and running it would compute a working-tree diff nobody asked for.

   On `status: error` in this mode, print the `error` field as written and stop. It is the eligibility refusal — closed pull request, wrong base branch, fork, or over the 50-file limit — and each names a different thing to do. Do not paraphrase it into "the PR could not be reviewed", and do not review the working tree instead.

   On success the response carries a `pull_request` block: number, title, `draft`, `base`, `head`, `head_sha` and `changed_files`. Say which pull request you are reviewing, and say so if it is a draft — the user may have meant a different one, and the head SHA is what makes the review reproducible.

   **Working-tree and path modes only, from here to the end of step 1.** Validate the returned values before substituting them below: `session_id` must contain only hex digits and dashes, `upload_token` exactly 64 hex characters, `upload_url` must be HTTPS or localhost HTTP, and `target_branch` must match `[A-Za-z0-9._/-]+` without starting with `-`; use an empty target when it does not. Then run this as one Bash call. The upload token is written only to a private temporary curl config and is never printed or stored in the repository.

   ```bash
   CE_SESSION='<session_id>'
   CE_UPLOAD_URL='<upload_url>'
   CE_UPLOAD_TOKEN='<upload_token>'
   TARGET='<validated target_branch or empty>'
   SCOPE='<the path the user gave, or empty for the whole change>'
   cd "$(git rev-parse --show-toplevel)" || exit 1
   case "$SCOPE" in *..*|/*|~*|[A-Za-z]:*) echo "cloudaeye_error=scope_outside_repo"; exit 1;; esac
   case "$CE_SESSION" in ''|*[!0-9A-Fa-f-]*) echo "cloudaeye_error=bad_session"; exit 1;; esac
   case "$CE_UPLOAD_TOKEN" in *[!0-9A-Fa-f]*|'') echo "cloudaeye_error=bad_upload_token"; exit 1;; esac
   [ "${#CE_UPLOAD_TOKEN}" = 64 ] || { echo "cloudaeye_error=bad_upload_token"; exit 1; }
   case "$CE_UPLOAD_URL" in https://*|http://localhost/*|http://localhost:*|http://127.0.0.1/*|http://127.0.0.1:*) ;; *) echo "cloudaeye_error=insecure_url"; exit 1;; esac
   CE_TMP=$(mktemp -d 2>/dev/null) || CE_TMP="${TMPDIR:-${TMP:-/tmp}}/cloudaeye-$$"
   mkdir -p "$CE_TMP" || { echo "cloudaeye_error=bad_config"; exit 1; }
   trap 'rm -rf "$CE_TMP"' EXIT INT TERM
   printf 'header = "X-Upload-Token: %s"\n' "$CE_UPLOAD_TOKEN" > "$CE_TMP/curl.cfg"
   chmod 600 "$CE_TMP/curl.cfg" 2>/dev/null || true
   case "$TARGET" in ''|-*|*[!A-Za-z0-9._/-]*) TARGET="";; esac
   HEAD_SHA=$(git rev-parse HEAD); BASE=""; SRC=fork_point
   if [ -n "$TARGET" ]; then
     git rev-parse --verify -q "origin/$TARGET" >/dev/null 2>&1 || \
       GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never GIT_ASKPASS=echo \
       git -c credential.helper= fetch -q origin "$TARGET" 2>/dev/null
     BASE=$(git merge-base "origin/$TARGET" HEAD 2>/dev/null)
   fi
   [ -n "$BASE" ] || { BASE=$HEAD_SHA; SRC=head; }
   git add --intent-to-add . >/dev/null 2>&1
   if [ -n "$SCOPE" ]; then
     git diff "$BASE" -- "$SCOPE" > .cloudaeye/session/session.diff
     SCOPED=$(git diff --name-only "$BASE" -- "$SCOPE" | wc -l)
   else
     git diff "$BASE" > .cloudaeye/session/session.diff
     SCOPED=$(git diff --name-only "$BASE" | wc -l)
   fi
   TOTAL=$(git diff --name-only "$BASE" | wc -l)
   UP=$(curl -s -m 120 -K "$CE_TMP/curl.cfg" -o /dev/null -w '%{http_code}' \
     -F "file=@.cloudaeye/session/session.diff" -F "base_sha=$BASE" "$CE_UPLOAD_URL")
   echo "session_id=$CE_SESSION base_source=$SRC base_age=$(git log -1 --format=%cr "origin/$TARGET" 2>/dev/null || echo unknown)"
   echo "diff_bytes=$(wc -c < .cloudaeye/session/session.diff) diff_files=$SCOPED total_files=$TOTAL scope=${SCOPE:--} upload_http=$UP"
   ```

   Read the two summary lines and the `start_session` result; don't re-derive them:

   | output | what to do with it |
   |---|---|
   | `start_session` unavailable or `status: error` | Stop and tell the user to authenticate CloudAEye through `/mcp`. |
   | `cloudaeye_error=…` | Stop and report it. Never print `upload_token`. |
   | `session_id=…` | Pass it to the MCP tool. |
   | `diff_bytes=0`, `scope=-` | Nothing pending — report "nothing to review" and stop. |
   | `diff_bytes=0` with a scope | Nothing has changed under that path. Say so **naming the path**, and stop. Do not widen to the whole change — they asked about one place. |
   | `diff_files` below `total_files` | A scoped review. Report both — "reviewed 2 of 7 changed files (src/auth/)" — and say the cross-file checks cannot see the excluded ones. `approve` here means approve *for that path*, and nothing else in the output says so. |
   | `cloudaeye_error=scope_outside_repo` | The path escaped the repository (`..`, absolute, or `~`). Report it and stop. |
   | `base_source=fork_point` | Correct baseline: the fork point off the integrated branch, not its tip. Name the branch and `base_age`; a very old baseline may miss newer merged work. |
   | `base_source=head` | Degraded: only working-tree edits are in the diff. Say so. If `start_session` returned `setup_required`, report its `reason` and `remedy` verbatim — that is the actionable form. Do **not** quote `target_branch_error`: it names an internal record ("no datastore credentials for tenant 99") and tells the user nothing they can act on. |
   | `upload_http=` not `200` | The diff never reached the server. Stop; otherwise a stale result can look clean. |

   **Which baseline applied must reach the user.** Every degradation still produces output that looks correct, so silence about it is the one failure mode that misleads. Keeping the clone current is the developer's job — the skill never forces a fetch, it just refuses to hide what it used.
2. Write a one-paragraph intent summary.

   **Pull-request mode:** you did not write this change, so do not pretend to. Use the pull request's own title and description — the server already put them on the session — and say in one line that the intent is the author's stated purpose rather than yours. Do not open the changed files to invent a better one; the server analyses the diff and reading it back spends the user's context window on work the server is doing anyway.

   **Working-tree and path modes:** describe **the code change you just made in this round of edits**, with the security-relevant surface named explicitly — which inputs are now trusted, what the new code authenticates or authorizes, what it serializes, logs, or passes to a shell/query/prompt. The planner uses this verbatim to decide which of the security report types to attach to which files. Intent is also the **only** mechanism for telling the reviewer to leave a previously-flagged issue alone; if the user has accepted a risk, say so here in plain words so it is visible to them.
   - **Do not read the diff to write this.** No `cat .cloudaeye/session/session.diff`, no `git diff`. You made these edits — the intent comes from your own working context. The diff is already uploaded and the server is what analyses it, so reading it back spends the developer's context window re-deriving what you already know, on a file that can run to thousands of lines. If you genuinely did not make the changes (a resumed session, or the user edited by hand), say that in one line and use `git diff --stat` for the file list — never the full diff.
3. Call CloudAEye's `inspect_diff` MCP tool with:
   - `session_id`: the `session_id` printed by step 1
   - `intent`: the summary from step 2
   - `profile`: `"security"` — **always this value from this skill.**
   - `context`: in **path mode**, set `scope_path` to the path the user gave. It filters nothing — you already narrowed the diff — but it is what makes the response say what it covered, and a narrowed `approve` that does not say so is the one result that misleads. Otherwise only `pr_title`. Do not pass `review_config` or `report_types`; they override the profile and are how you accidentally ship a half-configured security pass.

   Call `mcp__plugin_cloudaeye_cloudaeye__inspect_diff`; it is pre-approved in this skill's frontmatter.

   You do **not** need to read the changed source files yourself before calling — the server has the post-edit contents staged and examines them with its own tooling.
4. Report the response to the user:
   - **First: `verdict` is `error`, or the response carries a `degraded` block.** The review ran with no post-edit source staged, so every prompt saw an empty file and the secret scan never picked a detector (`secret_scan.detector: "none"` is the tell). **Report it as a failed run and stop — do not present the findings, and never call it clean.** `degraded.cause` names the upstream reason when there is one; `context_refresh.status` of `skipped`/`failed` carries it verbatim, and an expired GitHub installation token is the usual culprit. The server does not cache a degraded run, so re-running once the cause is fixed gives a real review.
   - The `verdict` (`approve` / `request_changes`).
   - **Report what came back, not what didn't.** Don't list report types that produced no findings, don't quote timings, file counts or detector names that worked, and don't explain which prompts didn't fire. The response deliberately omits that metadata; narrating its absence turns a three-line result into a wall of caveats. A diagnostic field the response *does* carry is there precisely because it changes what the result means — those you report.
   - Every finding, grouped by `report_type`, with file, line, severity, and message. Keep the report-type grouping — "application security", "LLM/agent security", and "leaked secret" are different audiences and different fixes. Put `SECRET_REPORT` findings **first**: a committed credential is the one finding here with a clock on it.
   - **Print each finding with its `n`, exactly as the server numbered it** — `1.`, `2.`, `3.` — and never renumber. That number is what the user types back at `/cloudaeye:implement [1,3]`, and the server resolves it against its own stored report, so a list you renumbered would aim the fix at the wrong finding. The numbers already run 1..N in the order you are told to present them, so grouping and numbering do not fight.
   - When the response carries `secret_scan.detector == "regex-scanner"`, say so in one line alongside a clean secret result: gitleaks isn't installed on the server, so only prefixed tokens were checked, not high-entropy strings. Don't mention it when secrets *were* found, and don't mention it at all when the detector was gitleaks.
   - If there are findings, ask which (if any) to fix, and say they can answer with the numbers — "1 and 3", or `/cloudaeye:implement [1,3]` for a plan. Do not start editing until the user replies.

## What this profile runs

- **SECURITY_REPORT** — injection protection, auth and access control, sensitive-data handling, deserialization, security misconfiguration, XXE.
- **LLM_SECURITY_REPORT** — prompt injection, improper output handling, sensitive-data exposure, vector/embedding weaknesses, system-prompt leakage, misinformation, unbounded consumption.
- **AIAGENT_SECURITY_REPORT** — intent breaking, memory poisoning, tool misuse, privilege compromise, resource overload, cascading hallucination, repudiation, human-in-the-loop overload, unexpected RCE, rogue-agent injection.
- **MCP_REPORT** — server metadata, tool/resource/prompt definitions, parameter descriptions and constraints, error handling, timeouts, tool safety, elicitation patterns.
- **SECRET_REPORT** — hardcoded credentials. Not a prompt set: gitleaks (or a regex fallback when it isn't installed) scans the post-edit files, hits are filtered to the diff's changed lines, and the survivors go to the model to separate real credentials from placeholders and test fixtures. The secret value itself is never carried anywhere — not in the finding, not in the prompt.

The three extended security report types are **pattern-gated server-side**: the planner attaches them only to file groups with matching evidence (LLM API calls, an agent framework, MCP server/client code). A repo with none of that pays nothing for them, so there is no reason to pre-filter on the client.

## Notes

- **A pull-request review is its own session,** separate from the working-tree one for the same repository, so it can never overwrite unfinished local work. Re-running the same PR resumes that PR's session; if the PR has new commits the server re-fetches, and if it does not, nothing is re-derived.
- **`/cloudaeye:implement` does not work on a pull-request review.** Its plans describe edits to a working tree, and the source for a PR lives on GitHub. If the user wants to fix what the review found, they check the branch out and review again locally. Say that rather than offering a plan that cannot be applied.
- **Single-shot** — one call, report the output, done. No fix-and-retry loop inside the skill.
- Bug-only categories (performance, dead imports, duplicate code) do **not** run here. For bugs and security in one pass, use `/cloudaeye:review`.
- Pre-commit only: the diff is always `git diff` (working tree vs `HEAD`). Committing moves `HEAD`; the review session persists and its recorded `head` is refreshed on the next call.
- A clean `approve` means no finding cleared the reviewer's confidence bar on the changed lines — it is not a security audit of the whole repo. Say so if the user reads it as one.
- If `inspect_diff` is unavailable (MCP not connected), warn the user and skip.
