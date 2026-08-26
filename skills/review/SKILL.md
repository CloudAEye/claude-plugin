---
name: review
description: Full CloudAEye review — bugs and security in one pass — of the uncommitted changes in this repo, of just one file or directory of them, or of an open pull request given its number. Reports findings with file, line and severity, grouped by kind; it never edits code on its own. The widest and most expensive of the CloudAEye passes.
when_to_use: Use before opening a significant PR, when the user asks for a full, complete or thorough review, when they name a path to review ("/cloudaeye:review src/auth/"), or when they name a pull request ("/cloudaeye:review #405", "review PR 12"). For the routine check after finishing a task use /cloudaeye:inspect; for the security surface alone use /cloudaeye:security.
argument-hint: "[optional: a path like src/auth/, or a PR number like #405]"
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__start_session", "mcp__cloudaeye__start_session", "mcp__plugin_cloudaeye_cloudaeye__inspect_diff", "mcp__cloudaeye__inspect_diff"]
---

## When to run

The user invoked `/cloudaeye:review`, or asked for a full/complete/thorough review. This is the widest pass: everything `/cloudaeye:inspect` checks **plus** everything `/cloudaeye:security` checks, in a single call.

It costs more than either alone — every enabled category rides in the per-file scan prompt. For the routine after-a-coding-task check, `/cloudaeye:inspect` is the right skill. Reach for this one before a significant PR, on a change large enough to warrant the extra passes, or when the user asks for it by name.

## Three modes

The argument decides which. Read it before anything else:

| Argument | Mode |
|---|---|
| *none* | **Working tree** — every uncommitted change, as every CloudAEye skill does. |
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

1. Prepare the review session.

   First collect the local repository identity with one Bash call. **All three modes need this** — the repository name comes from the git remote whichever way you are reviewing.

   ```bash
   cd "$(git rev-parse --show-toplevel)" || exit 1
   for c in python python3 py; do command -v "$c" >/dev/null 2>&1 && "$c" -c "" 2>/dev/null && { PY=$c; break; }; done
   [ -n "$PY" ] || { echo "cloudaeye_error=python_not_found"; exit 1; }
   mkdir -p .cloudaeye/session && printf '*\n' > .cloudaeye/.gitignore
   REPO=$(basename -s .git "$(git config --get remote.origin.url)"); [ -n "$REPO" ] || REPO=$(basename "$PWD")
   BRANCH=$(git rev-parse --abbrev-ref HEAD); HEAD_SHA=$(git rev-parse HEAD)
   "$PY" -c "import json,sys;print(json.dumps(dict(repo=sys.argv[1],branch=sys.argv[2],head=sys.argv[3])))" "$REPO" "$BRANCH" "$HEAD_SHA"
   ```

   Call `mcp__plugin_cloudaeye_cloudaeye__start_session` with those three values — no `language`; the server derives the tech-stack hint from the diff, which describes the change rather than the repo around it. If the tool is unavailable, stop and tell the user to authenticate CloudAEye through `/mcp`.

   **Pull-request mode:** also pass `pr_number` — the digits the user gave, with any `#` stripped. Then **stop here and go to step 2**: the diff is already on the server, so the whole upload block below is skipped, and running it would compute a working-tree diff nobody asked for.

   On `status: error` in this mode, print the `error` field as written and stop. It is the eligibility refusal — closed pull request, wrong base branch, fork, or over the 50-file limit — and each names a different thing to do. Do not paraphrase it into "the PR could not be reviewed", and do not review the working tree instead.

   On success the response carries a `pull_request` block: number, title, `draft`, `base`, `head`, `head_sha` and `changed_files`. Say which pull request you are reviewing, and say so if it is a draft — the user may have meant a different one, and the head SHA is what makes the review reproducible.

   **Working-tree mode only, from here to the end of step 1.** Validate the returned values before substituting them below: `session_id` must contain only hex digits and dashes, `upload_token` exactly 64 hex characters, `upload_url` must be HTTPS or localhost HTTP, and `target_branch` must match `[A-Za-z0-9._/-]+` without starting with `-`; use an empty target when it does not. Then run this as one Bash call. The upload token is written only to a private temporary curl config and is never printed or stored in the repository.

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

   **Working-tree mode:** describe **the code change you just made in this round of edits** — what you implemented and why, plus any security-relevant surface it touches (untrusted input, auth, secrets, serialization, prompts, tool definitions). Not a re-statement of the original ask. The planner uses this verbatim to prioritise within the full category set, and it is the **only** channel for telling the reviewer to leave a previously-flagged issue alone — so if you are asking it to skip something, say which finding and why, in words the user can see.
   - **Do not read the diff to write this.** No `cat .cloudaeye/session/session.diff`, no `git diff`. You made these edits — the intent comes from your own working context. The diff is already uploaded and the server is what analyses it, so reading it back spends the developer's context window re-deriving what you already know, on a file that can run to thousands of lines. If you genuinely did not make the changes (a resumed session, or the user edited by hand), say that in one line and use `git diff --stat` for the file list — never the full diff.
3. Call CloudAEye's `inspect_diff` MCP tool with:
   - `session_id`: the `session_id` printed by step 1
   - `intent`: the summary from step 2
   - `profile`: `"review"` — **always this value from this skill.** It selects every valid prompt: the bug categories and the full security surface.
   - `context`: in **path mode**, set `scope_path` to the path the user gave. It filters nothing — you already narrowed the diff — but it is what makes the response say what it covered, and a narrowed `approve` that does not say so is the one result that misleads. Otherwise only `pr_title` / `pr_description`. Do not pass `review_config` or `report_types`; either one overrides the profile and narrows the review you were asked to run.

   Call `mcp__plugin_cloudaeye_cloudaeye__inspect_diff`; it is pre-approved in this skill's frontmatter.

   You do **not** need to read the changed source files yourself before calling — the server has the post-edit contents staged and examines them with its own tooling.
4. Report the response to the user:
   - **First: `verdict` is `error`, or the response carries a `degraded` block.** The review ran with no post-edit source staged, so every prompt saw an empty file and the secret scan never picked a detector (`secret_scan.detector: "none"` is the tell). **Report it as a failed run and stop — do not present the findings, and never call it clean.** `degraded.cause` names the upstream reason when there is one; `context_refresh.status` of `skipped`/`failed` carries it verbatim, and an expired GitHub installation token is the usual culprit. The server does not cache a degraded run, so re-running once the cause is fixed gives a real review.
   - The `verdict` (`approve` / `request_changes`).
   - **Report what came back, not what didn't.** Don't list report types that produced no findings, don't quote timings, file counts or detector names that worked, and don't explain which prompts didn't fire. The response deliberately omits that metadata; narrating its absence turns a three-line result into a wall of caveats. A diagnostic field the response *does* carry is there precisely because it changes what the result means — those you report.
   - Every finding, **grouped by `report_type`** — leaked secrets first (a committed credential has a clock on it), then bugs, then application security, then LLM / AI-agent / MCP security. Within each group give file, line, severity, and message. The grouping is what makes a long list readable; don't flatten it.
   - **Print each finding with its `n`, exactly as the server numbered it** — `1.`, `2.`, `3.` — and never renumber. That number is what the user types back at `/cloudaeye:implement [1,3]`, and the server resolves it against its own stored report, so a list you renumbered would aim the fix at the wrong finding. The numbers already run 1..N in the order you are told to present them, so grouping and numbering do not fight.
   - The `counts` roll-up, so the user sees the shape before the detail.
   - If there are findings, ask which (if any) to fix, and say they can answer with the numbers — "1 and 3", or `/cloudaeye:implement [1,3]` for a plan. Do not start editing until the user replies. After fixing, re-invoke this skill (the server resumes the same review session) and write a fresh intent naming the findings you addressed.

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
- **Working-tree mode is pre-commit:** the diff is always `git diff` (working tree vs `HEAD`). Committing moves `HEAD`, but the review session persists — its recorded `head` is refreshed on the next call, and prior intent carries across.
- **A pull-request review is its own session,** separate from the working-tree one for the same repository, so it can never overwrite unfinished local work. Re-running `/cloudaeye:review #5` resumes that PR's session; if the PR has new commits the server re-fetches, and if it does not, nothing is re-derived.
- **`/cloudaeye:implement` does not work on a pull-request review.** Its plans describe edits to a working tree, and the source for a PR lives on GitHub. If the user wants to fix what the review found, they check the branch out and review again locally. Say that rather than offering a plan that cannot be applied.
- If `inspect_diff` is unavailable (MCP not connected), warn the user and skip.
