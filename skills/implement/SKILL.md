---
name: implement
description: Plan a fix for findings a CloudAEye review already produced. You say which ones in your own words — "fix the 2nd point, and use a context manager" — and the server returns a fix plan grounded in the repository's code graph, including the call sites and tests the change affects. It plans; it never edits on its own.
when_to_use: Use after /cloudaeye:inspect, /cloudaeye:security or /cloudaeye:review has returned findings and the user wants help fixing some of them. Fixing a finding directly without this skill is also fine — this is for when the plan should account for the whole repository, not just the file being edited.
argument-hint: "[which findings to fix, in your own words]"
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__start_session", "mcp__cloudaeye__start_session", "mcp__plugin_cloudaeye_cloudaeye__implement", "mcp__cloudaeye__implement"]
---

## When to run

The user invoked `/cloudaeye:implement`, or asked you to fix findings from a CloudAEye review and wants the server's plan for them.

It plans fixes for findings **something else already found**. It never finds issues itself: with nothing on record for the session — no review yet, or the last one came back clean — it says so and points at `/cloudaeye:inspect`, `/cloudaeye:security` or `/cloudaeye:review`.

What it adds over you doing it directly is **blast radius**. You can see the diff and the file you are editing; the server has the AST graph across the whole repository, so the plan names the other call site with the same defect, the caller whose contract changes, and the test that asserts on the behaviour being fixed. If the user just wants a one-line fix applied, doing it yourself is the right call and costs nothing.

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
   | `diff_bytes=0` | Nothing pending. Say so and stop — a plan for a change that no longer exists cannot be applied. If the user committed since the review, say that too. |
   | `base_source=fork_point` | Correct baseline: the fork point off the integrated branch, not its tip. |
   | `base_source=head` | Degraded: only working-tree edits are in the diff. Say so. If `start_session` returned `setup_required`, report its `reason` and `remedy` verbatim. Do **not** quote `target_branch_error`: it names an internal record and tells the user nothing they can act on. |
   | `upload_http=` not `200` | The diff never reached the server. Stop; otherwise the plan is built against stale code. |
2. Call CloudAEye's `implement` MCP tool with:
   - `session_id`: the `session_id` printed by step 1
   - `request`: what the user said, **verbatim** — "fix the 2nd point, and use a context manager for it", "just the criticals", "fix them all". Do not summarise it, do not turn it into a list of tags, do not drop the part that sounds like a preference. Which findings they mean *and* any constraint on the fix both live in the phrasing, and a summary drops the constraint first. If the request came up in conversation rather than as an argument, quote it as they said it.
   - `displayed_order`: the finding tags in the order **you printed them** to the user, e.g. `["src/db.py/issue-2", "src/api.py/issue-1"]`. This is what makes "the 2nd point" mean the second one on their screen. Omit it only if you never showed the list this session — never invent an order you did not print.

   Call `mcp__plugin_cloudaeye_cloudaeye__implement`; it is pre-approved in this skill's frontmatter.

   Do **not** send the findings themselves — the server reads its own saved report, which is more complete than what came back over the wire. Do not read the changed source files first either; the server has them staged and its own tooling to trace through them.
3. Handle the response before touching any code.
   - **`error`** — report it as written. It means no findings are on record; the fix is to run a review first, which the message already says.
   - **`needs_clarification`** — the request was ambiguous and **nothing was planned**. Ask the user which finding they meant, using the candidates in the message, and stop. Do not pick one yourself: a wrong guess edits the wrong code with the user's apparent blessing.
   - **`plans` empty with `unresolved`** — the request did not match any finding. Show `available_tags` and ask.
   - **Otherwise, show `resolved` first** — one line per finding: which one the request was read as naming, and the constraint attached. The user needs to see the reading before the edits, not after.
   - A plan marked **`stale`** points at code that has moved since the review. Say so and ask before applying it; it may already be fixed.
   - A plan with **`risk: not_an_edit`** cannot be fixed by changing code — a leaked credential needs rotating and revoking. Report the remedy; do not write a code change that pretends to fix it.
4. Apply the plans, and only the plans.
   - Make exactly the edits described, honouring `constraints` as hard requirements.
   - Work through `blast_radius`. It names things outside the diff — other call sites with the same defect, callers whose contract changes, tests that assert on the old behaviour. Check each one, and tell the user what you did about it. Ignoring it wastes the only thing this call bought.
   - Do not fix findings that were not planned. The user asked for these.
   - Anything under `out_of_scope` is not a CloudAEye finding — handle it as ordinary work, separately, and say that's what you're doing.
5. Close the loop.
   - Tell the user what you changed, and suggest re-running the review that produced the findings (`/cloudaeye:inspect`, `/cloudaeye:security` or `/cloudaeye:review`) to confirm the fix landed and introduced nothing new.
   - When they do, pass `next_intent` from this response as the `intent` — verbatim if you followed the plan, edited if you deviated. It names what was addressed and what was deliberately left, which is the only channel the reviewer has for that.

## Notes

- **Single-shot** — one request, one set of plans. If the user then wants different findings fixed, invoke the skill again; the server resumes the same session.
- **It plans; it never patches.** The server returns instructions, not file contents. You write the code — you have the working tree and the test runner, and it does not.
- **No verdict, and no finding is closed by fixing it.** Only re-running the review can say a fix worked, and you are the one who wrote the code being reviewed. Do not report the findings as resolved on the strength of your own edit.
- **The plan can be wrong.** It is a model reasoning over a code graph. When it contradicts something you have directly read in the source, say so rather than deferring to it — and prefer the file you read.
- Fixing a finding without this skill is entirely fine. Reach for it when the fix has reach beyond the file, or when the user asks for it by name.
- If `implement` is unavailable (MCP not connected), warn the user and offer to fix the findings directly from what the review already reported.
