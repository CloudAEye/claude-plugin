---
name: ask
description: Ask a free-form question about the uncommitted changes in this repo and get an answer grounded in the repository's code graph — callers, definitions and usage traces, not just the diff text. Returns an answer, not a review, and never edits code.
when_to_use: Use for blast-radius questions ("what else calls this?"), "what did this do before?", "is this pattern used elsewhere?", or a second opinion the coding agent cannot give from its own context window.
argument-hint: "[question about the pending change]"
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__start_session", "mcp__cloudaeye__start_session", "mcp__plugin_cloudaeye_cloudaeye__ask", "mcp__cloudaeye__ask"]
---

## When to run

The user invoked `/cloudaeye:ask`, or asked a question about the pending change that you cannot answer confidently from what you have already read. That second case is the important one: the server has the whole repository's AST graph indexed, and you have a context window. Questions worth handing over:

- **Blast radius** — "what else calls this?", "who depends on this interface?"
- **Prior behaviour** — "what did this function do before my change?"
- **Repo-wide patterns** — "is this error handled the same way elsewhere?", "do other callers already do this check?"
- **Second opinion on a specific line** — "is this lock actually protecting anything?"

Do **not** use it as a review. It returns no findings and no verdict. If the user wants problems found, that's `/cloudaeye:inspect` (bugs), `/cloudaeye:security` (security), or `/cloudaeye:review` (both).

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
   | `diff_bytes=0` | No pending changes. **Do not stop** — unlike the review skills, a question about the existing code is still answerable. |
   | `base_source=fork_point` | Correct baseline: the fork point off the integrated branch, not its tip. Name the branch and `base_age`; a very old baseline may miss newer merged work. |
   | `base_source=head` | Degraded: only working-tree edits are in the diff. Say so. If `start_session` returned `setup_required`, report its `reason` and `remedy` verbatim — that is the actionable form. Do **not** quote `target_branch_error`: it names an internal record ("no datastore credentials for tenant 99") and tells the user nothing they can act on. |
   | `upload_http=` not `200` | The diff never reached the server. Stop; otherwise a stale result can look correct. |

   **Which baseline applied must reach the user.** Every degradation still produces output that looks correct, so silence about it is the one failure mode that misleads. Keeping the clone current is the developer's job — the skill never forces a fetch, it just refuses to hide what it used.
2. Call CloudAEye's `ask` MCP tool with:
   - `session_id`: the `session_id` printed by step 1
   - `question`: the user's question **verbatim**. Do not summarise it, do not expand it into a "better" question, do not split it into several. The phrasing is what they meant; a rewritten question gets a different answer to a question nobody asked. If the question was implicit in conversation ("wait, does that break the retry path?"), quote it as they said it.
   - `intent`: optional — one paragraph on what you just changed, if the question is about your edit. Context for the question, not its subject. Write it from your own working context; do not read `.cloudaeye/session/session.diff` or run `git diff` to compose it — the server already has the diff.
   - `context`: optional — only `pr_title` / `pr_description`.

   Call `mcp__plugin_cloudaeye_cloudaeye__ask`; it is pre-approved in this skill's frontmatter.

   You do **not** need to read the changed source files yourself first — the server has the post-edit contents staged and its own tooling to trace through them.
3. Report the response:
   - Print the `answer` field as-is. It is plain markdown written to be read directly.

   Check `context_refresh.status` first. On `skipped` or `failed` the stored code graph was not refreshed with this diff, so the answer is based on the pre-edit code plus the diff text alone — say so in one line and quote `context_refresh.reason`. It is usually an expired GitHub installation token, which the user has to fix server-side.
   - If the answer names files you have not read and the user's next step depends on them, offer to open them — don't silently re-derive the answer yourself.
   - `files_visited` shows what the answer is grounded in. Surface it when the answer is surprising or the user pushes back, so they can see the basis rather than take it on trust.

## Notes

- **Single-shot** — one question, one answer. If the user has a follow-up, invoke the skill again with the follow-up as the new question; the server resumes the same session.
- **The answer can be wrong.** It is a model reasoning over a code graph, not a compiler. When it contradicts something you have directly read in the source, say so rather than deferring to it — and prefer the file you read.
- **It answers; it does not review.** If the answer volunteers problems, that's a bonus, not the contract. Findings come from the review skills.
- Pre-commit: the diff is `git diff` (working tree vs `HEAD`). Committing moves `HEAD`; the session persists and its recorded `head` is refreshed on the next call.
- If `ask` is unavailable (MCP not connected), warn the user and answer from your own context instead, saying that's what you did.
