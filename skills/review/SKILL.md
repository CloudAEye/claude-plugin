---
name: review
description: Full CloudAEye review of the uncommitted changes in this repo — bugs and security in one pass. Reports findings with file, line and severity, grouped by kind; it never edits code on its own. The widest and most expensive of the CloudAEye passes.
when_to_use: Use before opening a significant PR, or when the user asks for a full, complete or thorough review. For the routine check after finishing a task use /cloudaeye:inspect; for the security surface alone use /cloudaeye:security.
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__start_session", "mcp__cloudaeye__start_session", "mcp__plugin_cloudaeye_cloudaeye__inspect_diff", "mcp__cloudaeye__inspect_diff"]
---

## When to run

The user invoked `/cloudaeye:review`, or asked for a full/complete/thorough review. This is the widest pass: everything `/cloudaeye:inspect` checks **plus** everything `/cloudaeye:security` checks, in a single call.

It costs more than either alone — every enabled category rides in the per-file scan prompt. For the routine after-a-coding-task check, `/cloudaeye:inspect` is the right skill. Reach for this one before a significant PR, on a change large enough to warrant the extra passes, or when the user asks for it by name.

## Steps

1. Prepare and upload the review session.

   First collect the local repository identity with one Bash call.

   ```bash
   cd "$(git rev-parse --show-toplevel)" || exit 1
   for c in python python3 py; do command -v "$c" >/dev/null 2>&1 && "$c" -c "" 2>/dev/null && { PY=$c; break; }; done
   [ -n "$PY" ] || { echo "cloudaeye_error=python_not_found"; exit 1; }
   mkdir -p .cloudaeye/session && printf '*\n' > .cloudaeye/.gitignore
   REPO=$(basename -s .git "$(git config --get remote.origin.url)"); [ -n "$REPO" ] || REPO=$(basename "$PWD")
   BRANCH=$(git rev-parse --abbrev-ref HEAD); HEAD_SHA=$(git rev-parse HEAD)
   "$PY" -c "import json,sys;print(json.dumps(dict(repo=sys.argv[1],branch=sys.argv[2],head=sys.argv[3])))" "$REPO" "$BRANCH" "$HEAD_SHA"
   ```

   Call `mcp__plugin_cloudaeye_cloudaeye__start_session` with those three values — no `language`; the server derives the tech-stack hint from the uploaded diff, which describes the change rather than the repo around it. If the tool is unavailable or returns `status: error`, stop and tell the user to authenticate CloudAEye through `/mcp`.

   Validate the returned values before substituting them below: `session_id` must contain only hex digits and dashes, `upload_token` exactly 64 hex characters, `upload_url` must be HTTPS or localhost HTTP, and `target_branch` must match `[A-Za-z0-9._/-]+` without starting with `-`; use an empty target when it does not. Then run this as one Bash call. The upload token is written only to a private temporary curl config and is never printed or stored in the repository.

   ```bash
   CE_SESSION='<session_id>'
   CE_UPLOAD_URL='<upload_url>'
   CE_UPLOAD_TOKEN='<upload_token>'
   TARGET='<validated target_branch or empty>'
   cd "$(git rev-parse --show-toplevel)" || exit 1
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
   git diff "$BASE" > .cloudaeye/session/session.diff
   UP=$(curl -s -m 120 -K "$CE_TMP/curl.cfg" -o /dev/null -w '%{http_code}' \
     -F "file=@.cloudaeye/session/session.diff" -F "base_sha=$BASE" "$CE_UPLOAD_URL")
   echo "session_id=$CE_SESSION base_source=$SRC base_age=$(git log -1 --format=%cr "origin/$TARGET" 2>/dev/null || echo unknown)"
   echo "diff_bytes=$(wc -c < .cloudaeye/session/session.diff) diff_files=$(git diff --name-only "$BASE" | wc -l) upload_http=$UP"
   ```

   Read the two summary lines and the `start_session` result; don't re-derive them:

   | output | what to do with it |
   |---|---|
   | `start_session` unavailable or `status: error` | Stop and tell the user to authenticate CloudAEye through `/mcp`. |
   | `cloudaeye_error=…` | Stop and report it. Never print `upload_token`. |
   | `session_id=…` | Pass it to the MCP tool. |
   | `diff_bytes=0` | Nothing pending — report "nothing to review" and stop. |
   | `base_source=fork_point` | Correct baseline: the fork point off the integrated branch, not its tip. Name the branch and `base_age`; a very old baseline may miss newer merged work. |
   | `base_source=head` | Degraded: only working-tree edits are in the diff. Say so, and pass on `target_branch_error` from `start_session`. |
   | `upload_http=` not `200` | The diff never reached the server. Stop; otherwise a stale result can look clean. |

   **Which baseline applied must reach the user.** Every degradation still produces output that looks correct, so silence about it is the one failure mode that misleads. Keeping the clone current is the developer's job — the skill never forces a fetch, it just refuses to hide what it used.
2. Write a one-paragraph intent summary describing **the code change you just made in this round of edits** — what you implemented and why, plus any security-relevant surface it touches (untrusted input, auth, secrets, serialization, prompts, tool definitions). Not a re-statement of the original ask. The planner uses this verbatim to prioritise within the full category set, and it is the **only** channel for telling the reviewer to leave a previously-flagged issue alone — so if you are asking it to skip something, say which finding and why, in words the user can see.
   - **Do not read the diff to write this.** No `cat .cloudaeye/session/session.diff`, no `git diff`. You made these edits — the intent comes from your own working context. The diff is already uploaded and the server is what analyses it, so reading it back spends the developer's context window re-deriving what you already know, on a file that can run to thousands of lines. If you genuinely did not make the changes (a resumed session, or the user edited by hand), say that in one line and use `git diff --stat` for the file list — never the full diff.
3. Call CloudAEye's `inspect_diff` MCP tool with:
   - `session_id`: the `session_id` printed by step 1
   - `intent`: the summary from step 2
   - `profile`: `"review"` — **always this value from this skill.** It selects every valid prompt: the bug categories and the full security surface.
   - `context`: optional — only set for `pr_title` / `pr_description`. Do not pass `review_config` or `report_types`; either one overrides the profile and narrows the review you were asked to run.

   Call `mcp__plugin_cloudaeye_cloudaeye__inspect_diff`; it is pre-approved in this skill's frontmatter.

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
