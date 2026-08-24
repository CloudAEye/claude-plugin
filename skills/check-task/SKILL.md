---
name: check-task
description: Check whether the uncommitted changes in this repo actually do what the task asked. Takes a GitHub issue URL, Jira ticket IDs, a mixed reference list, or freeform task text, and returns a DONE / NOT DONE verdict with a per-requirement checklist and the gaps.
when_to_use: Use before marking work complete, or when the user asks whether the change satisfies an issue, a ticket, or the request they made. Accepts an issue URL, IDs like BETA-5225, a list of both, or plain text.
argument-hint: "[issue URL | TICKET-123 | task description]"
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__start_session", "mcp__cloudaeye__start_session", "mcp__plugin_cloudaeye_cloudaeye__check_task", "mcp__cloudaeye__check_task"]
---

## Arguments

The skill accepts an optional task spec as its invocation argument. When present, use it as the task input and **do not re-prompt** the user (still confirm before reusing a `prior_task`). Recognised forms:

- **Jira ticket IDs** — a bracketed or bare comma list of `PROJECT-NUMBER` keys, e.g. `/cloudaeye:check-task [BETA-5225, BETA-5223]` or `/cloudaeye:check-task BETA-5225`. Detect with `\b[A-Z][A-Z0-9]+-\d+\b`. Route to `task_source="jira"`.
- **GitHub issue URL** — `https://github.com/<owner>/<repo>/issues/<n>`. Route to `task_source="github-issue"`. Short refs (`#42`, `owner/repo#42`) and mixed Jira+GitHub lists (`[BETA-5225, #42]`) also resolve server-side.
- **Freeform text** — anything else. Route to `task_source="user-text"` (or `jira`/`spec` if the text is clearly that). Text that merely *mentions* tickets ("verify BETA-5225 is handled, keep retries intact") is fine as-is — a server-side triage model extracts the references and keeps the extra requirements; don't restructure it.

With no argument, fall back to asking the user (step 2).

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
   | `diff_bytes=0` | Nothing pending — report "nothing to check — no pending changes" and stop. |
   | `base_source=fork_point` | Correct baseline: the fork point off the integrated branch, not its tip. Name the branch and `base_age`; a very old baseline may miss newer merged work. |
   | `base_source=head` | Degraded: only working-tree edits are in the diff. Say so. If `start_session` returned `setup_required`, report its `reason` and `remedy` verbatim — that is the actionable form. Do **not** quote `target_branch_error`: it names an internal record ("no datastore credentials for tenant 99") and tells the user nothing they can act on. |
   | `upload_http=` not `200` | The diff never reached the server. Stop; otherwise a stale result can look clean. |
   | `prior_task` | Offer it for reuse in step 2; never reuse it silently. |

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

   Call `mcp__plugin_cloudaeye_cloudaeye__check_task`; it is pre-approved in this skill's frontmatter.

   You do **not** need to read the changed source files yourself before calling — the server has the post-edit file contents staged and examines them via its own tooling.
5. Print the `report` field from the response verbatim. It is rendered markdown — a `# Task Completion Check` heading, a status line, a progress bar over met requirements, a per-requirement table (✅ done / ⚠️ partial / ❌ not done), gaps, and any out-of-scope changes. Don't re-summarise or re-format it; the counts and the bar are computed server-side and re-typing them is how they drift.

   Check `context_refresh.status` first. On `skipped` or `failed` the stored code graph was not refreshed with this diff, so the answer is based on the pre-edit code plus the diff text alone — say so in one line and quote `context_refresh.reason`. It is usually an expired GitHub installation token, which the user has to fix server-side.

   The response also carries a machine-readable `verdict`: **`DONE`** (every requirement met), **`NOT_DONE`** (anything less — a single partial requirement is not "done"), or **`ERROR`** (the check could not run; not a judgement on the change). On `NOT_DONE`, ask the user whether they'd like you to close the listed gaps. Don't start editing until the user replies; if they say yes, make the edits and re-invoke `/cloudaeye:check-task` (the server resumes the same review session and offers the prior task for reuse). On `ERROR`, say what failed and offer the workaround — usually pasting the ticket body as freeform text.

## Notes

- This is a **single-shot** skill — one call, print the output, done. No fix-and-retry loop inside the skill.
- **The task is persisted on the review session.** After a successful check, a later `start_session` resume surfaces it as `prior_task` so the user isn't re-prompted. For `github-issue` the stored value is the URL (re-fetched each call), not a frozen snapshot — so a re-check picks up new issue comments.
- **GitHub fetch requires `client_git_token` on the server.** If it's missing, or the URL is malformed / the token lacks access, `check_task` returns a structured `error` (not a verdict) — surface it and offer to let the user paste the issue body as freeform `user-text` instead.
- **Jira fetch goes through the tenant's CloudAEye Jira (Forge) app — same integration as cloud reviews.** The tenant comes from the verified OAuth token used by `start_session`, never from repository or machine config. The server side needs `BITBUCKET_FUNCTION_KEY` and the Mongo store (`TEST_RCA_MONGODB_URL`), and the tenant must have the CloudAEye Jira app installed. When they're missing or a key doesn't resolve: a task that is *only* ticket refs returns a structured `error` (nothing to judge — surface it and offer pasting the ticket body as `user-text`); a task that also carries prose proceeds against the prose with a visible "reference(s) not checked" note in the report. A partially-resolved list likewise carries a note — a verdict never silently implies an unfetched ticket was verified.
- Pre-commit only: the diff is always `git diff` (working tree vs `HEAD`). Committing moves `HEAD`, but the review session persists — its recorded `head` is refreshed on the next call, and the stored task carries across, so `prior_task` still comes back after a commit.
- Without `client_git_token` / `client_git_owner` configured, the code-context refresh is skipped and verification falls back to diff-only analysis (still works, just less precise on end-to-end wiring).
- If `check_task` is unavailable (MCP not connected), warn the user and skip — do not attempt to judge the diff against the task yourself from `git diff` output.
- The full investigation trace is logged on the server under `query_logs/` keyed by `run_id` (included in the response's `eval_summary`).
