---
name: security
description: Security review of the uncommitted changes in this repo — OWASP-style application security plus the LLM, AI-agent and MCP surfaces, and secrets leaked on the changed lines. Reports findings with file, line and severity; it never edits code on its own.
when_to_use: Use when the change touches auth, untrusted input, secrets, crypto, deserialization, prompts, tool definitions or agent orchestration, or whenever the user asks for a security review.
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__start_session", "mcp__cloudaeye__start_session", "mcp__plugin_cloudaeye_cloudaeye__inspect_diff", "mcp__cloudaeye__inspect_diff"]
---

## When to run

The user invoked `/cloudaeye:security`, or asked for a security review of the pending change. This is the **only** skill that turns the security prompts on for a security-only pass — `/cloudaeye:inspect` deliberately runs bugs only, and `/cloudaeye:review` runs both.

Do not run this uninvited after an ordinary coding task. Do suggest it (without running it) when the change touches:

- authentication, authorization, session or token handling
- input arriving from an untrusted source (HTTP, queue, file upload, CLI)
- deserialization, XML parsing, template rendering, shell or SQL construction
- secrets, credentials, crypto, or anything written to logs
- LLM prompts, tool/function definitions, MCP servers, or agent loops

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
   | `base_source=head` | Degraded: only working-tree edits are in the diff. Say so. If `start_session` returned `setup_required`, report its `reason` and `remedy` verbatim — that is the actionable form. Do **not** quote `target_branch_error`: it names an internal record ("no datastore credentials for tenant 99") and tells the user nothing they can act on. |
   | `upload_http=` not `200` | The diff never reached the server. Stop; otherwise a stale result can look clean. |

   **Which baseline applied must reach the user.** Every degradation still produces output that looks correct, so silence about it is the one failure mode that misleads. Keeping the clone current is the developer's job — the skill never forces a fetch, it just refuses to hide what it used.
2. Write a one-paragraph intent summary describing **the code change you just made in this round of edits**, with the security-relevant surface named explicitly — which inputs are now trusted, what the new code authenticates or authorizes, what it serializes, logs, or passes to a shell/query/prompt. The planner uses this verbatim to decide which of the security report types to attach to which files. Intent is also the **only** mechanism for telling the reviewer to leave a previously-flagged issue alone; if the user has accepted a risk, say so here in plain words so it is visible to them.
   - **Do not read the diff to write this.** No `cat .cloudaeye/session/session.diff`, no `git diff`. You made these edits — the intent comes from your own working context. The diff is already uploaded and the server is what analyses it, so reading it back spends the developer's context window re-deriving what you already know, on a file that can run to thousands of lines. If you genuinely did not make the changes (a resumed session, or the user edited by hand), say that in one line and use `git diff --stat` for the file list — never the full diff.
3. Call CloudAEye's `inspect_diff` MCP tool with:
   - `session_id`: the `session_id` printed by step 1
   - `intent`: the summary from step 2
   - `profile`: `"security"` — **always this value from this skill.**
   - `context`: optional — only set for `pr_title`. Do not pass `review_config` or `report_types`; they override the profile and are how you accidentally ship a half-configured security pass.

   Call `mcp__plugin_cloudaeye_cloudaeye__inspect_diff`; it is pre-approved in this skill's frontmatter.

   You do **not** need to read the changed source files yourself before calling — the server has the post-edit contents staged and examines them with its own tooling.
4. Report the response to the user:
   - **First: `verdict` is `error`, or the response carries a `degraded` block.** The review ran with no post-edit source staged, so every prompt saw an empty file and the secret scan never picked a detector (`secret_scan.detector: "none"` is the tell). **Report it as a failed run and stop — do not present the findings, and never call it clean.** `degraded.cause` names the upstream reason when there is one; `context_refresh.status` of `skipped`/`failed` carries it verbatim, and an expired GitHub installation token is the usual culprit. The server does not cache a degraded run, so re-running once the cause is fixed gives a real review.
   - The `verdict` (`approve` / `request_changes`).
   - **Report what came back, not what didn't.** Don't list report types that produced no findings, don't quote timings, file counts or detector names that worked, and don't explain which prompts didn't fire. The response deliberately omits that metadata; narrating its absence turns a three-line result into a wall of caveats. A diagnostic field the response *does* carry is there precisely because it changes what the result means — those you report.
   - Every finding, grouped by `report_type`, with file, line, severity, and message. Keep the report-type grouping — "application security", "LLM/agent security", and "leaked secret" are different audiences and different fixes. Put `SECRET_REPORT` findings **first**: a committed credential is the one finding here with a clock on it.
   - When the response carries `secret_scan.detector == "regex-scanner"`, say so in one line alongside a clean secret result: gitleaks isn't installed on the server, so only prefixed tokens were checked, not high-entropy strings. Don't mention it when secrets *were* found, and don't mention it at all when the detector was gitleaks.
   - If there are findings, ask which (if any) to fix — list them by number or tag. Do not start editing until the user replies.

## What this profile runs

- **SECURITY_REPORT** — injection protection, auth and access control, sensitive-data handling, deserialization, security misconfiguration, XXE.
- **LLM_SECURITY_REPORT** — prompt injection, improper output handling, sensitive-data exposure, vector/embedding weaknesses, system-prompt leakage, misinformation, unbounded consumption.
- **AIAGENT_SECURITY_REPORT** — intent breaking, memory poisoning, tool misuse, privilege compromise, resource overload, cascading hallucination, repudiation, human-in-the-loop overload, unexpected RCE, rogue-agent injection.
- **MCP_REPORT** — server metadata, tool/resource/prompt definitions, parameter descriptions and constraints, error handling, timeouts, tool safety, elicitation patterns.
- **SECRET_REPORT** — hardcoded credentials. Not a prompt set: gitleaks (or a regex fallback when it isn't installed) scans the post-edit files, hits are filtered to the diff's changed lines, and the survivors go to the model to separate real credentials from placeholders and test fixtures. The secret value itself is never carried anywhere — not in the finding, not in the prompt.

The three extended security report types are **pattern-gated server-side**: the planner attaches them only to file groups with matching evidence (LLM API calls, an agent framework, MCP server/client code). A repo with none of that pays nothing for them, so there is no reason to pre-filter on the client.

## Notes

- **Single-shot** — one call, report the output, done. No fix-and-retry loop inside the skill.
- Bug-only categories (performance, dead imports, duplicate code) do **not** run here. For bugs and security in one pass, use `/cloudaeye:review`.
- Pre-commit only: the diff is always `git diff` (working tree vs `HEAD`). Committing moves `HEAD`; the review session persists and its recorded `head` is refreshed on the next call.
- A clean `approve` means no finding cleared the reviewer's confidence bar on the changed lines — it is not a security audit of the whole repo. Say so if the user reads it as one.
- If `inspect_diff` is unavailable (MCP not connected), warn the user and skip.
