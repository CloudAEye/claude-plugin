---
name: review-arch
description: Review what the uncommitted changes in this repo (or a pull request) did to the repository's architecture — which layers and components the change touches, every dependency it added with the ones that cross layers marked, layer violations, new cycles, first-in-layer boundary calls, undeclared dependencies, and the questions a senior engineer would ask of this change. The layers come from the repository's Architecture Model and the edges from its code graph; nothing is inferred from the diff text. Reports; it never edits code and finds no bugs.
when_to_use: Use before opening or merging a pull request that adds a dependency, a new module, a new external system or crosses a layer, when a reviewer asks "does this fit the architecture", or when the user asks for an architecture review, a layer check, or "what does this change touch". For bugs use /cloudaeye:inspect; for the call sequence use /cloudaeye:control-flow.
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__initialize_repository", "mcp__cloudaeye__initialize_repository", "mcp__plugin_cloudaeye_cloudaeye__start_session", "mcp__cloudaeye__start_session", "mcp__plugin_cloudaeye_cloudaeye__review_arch", "mcp__cloudaeye__review_arch"]
---

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


### Two ways in

**With a pull-request number** — `/cloudaeye:review-arch 412` or
`/cloudaeye:review-arch #412`, the same convention `/cloudaeye:review` takes —
skip step 1 entirely. Call `start_session` with `INIT.repo_full`, the current
`branch` and `head`, **and `pr_number`** (the digits, with any `#` stripped);
the server fetches that pull request and its diff itself, so there is nothing to
upload. Then go to step 2.

Nothing here asks the user for a GitHub credential, and nothing should: the
server resolves the repository, its integrated branch and its App installation
from the tenant record behind the caller's OAuth token. A run that cannot reach
the repository is a server-side integration problem, reported as such — never a
prompt for a key.

**With no argument**, the diff is the working tree and step 1 applies.

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
2. Call `mcp__plugin_cloudaeye_cloudaeye__review_arch` (pre-approved in this
   skill's frontmatter) with `session_id` from step 1. Two arguments need a
   decision:

   - `context`: pass `{"scope_path": "<path>"}` only when the user scoped the
     run to a directory; pass `{"pr_title": "<title>"}` when the user gave one
     and the session is not a pull-request session (a PR session carries it).
   - `post`: **writes a comment where other people can see it.** Pass `true`
     only after saying in one line what will happen — *CloudAEye will post the
     architecture review as a comment on pull request #<n>* — and getting a
     clear yes. Naming a PR in the argument is asking for a review of it, not
     asking to comment on it. Needs a session opened with a `pr_number`.

3. Print the `card` field **verbatim, the mermaid fence included when there is
   one**, then stop.

   The card is rendered server-side because what it may show is the feature.
   It reads top to bottom as: the verdict line; how the change is layered — a
   text diagram with one row per changed module under its layer and
   component, and one line per dependency the change added (`+`), removed
   (`-`) or added against the layer order (`!`), with `[kind]` marking a new
   call to a database, cache, queue, HTTP service or model provider; a mermaid
   block of the same picture, only when a dependency crossed a layer; the
   numbered findings; the questions under *Worth a senior look*; and a footer.
   Do not redraw the diagram, renumber the findings, or fold the footer into
   prose. Three things on it are invisible once reformatted away:

   - **the footer's `Pre-existing violations in touched files: N`** — the
     review grades the *change*, and a clean card over a large N is a clean
     change in a repository already in violation, which is a different
     statement from a clean repository;
   - **`Model: …`** — `current` means the repository's stored Architecture
     Model was used; `built from this session's graph` means the mapping job
     has not stored one yet and the layers were inferred just now, with
     components named by directory; `unlabelled` means the same about names;
   - **the confidence beside a direction finding** — `[0.74 inferred]` is a
     finding on layers the analysis inferred; only `declared` layers can turn
     the verdict to `FAIL`.

   These fields change what you may say around the card:

   | field | what to do with it |
   |---|---|
   | `unavailable` | An ordinary answer, not an error to retry. Print the `note` and stop. `no_model` with a `reason` means the model could neither be loaded nor built. |
   | `verdict` | `PASS`, `FINDINGS` or `FAIL`. Say it as the first word. `FAIL` only ever comes from a rule the repository declared. |
   | `diff_measured: false` | No pre-edit graph, so **no edge is marked added** and cycles and direction were not compared. Say what changed could not be determined. Never report it as "nothing changed". |
   | `pre_existing` | Violations already in the touched files, counted and never listed. Mention the number when it is not zero. |
   | `explain_failed` | The walk-through and the answers were not written; the questions are printed as questions. Say the review is measured only. |
   | `confirm_failed` | Pattern candidates could not be judged and were dropped. Not a clean pattern check. |
   | `model.source` / `model.labelled` | `built` or `labelled: false`: name components by their directory and say the model was built on the fly. |
   | `pr_url` | A pull-request run. **End with a link** — `[<repo>#<pr_number>](<pr_url>)`. Absent on a working-tree run: give no link, and never construct one. |
   | `posted.status` | `ok` means the card is on the pull request. `unavailable` or `failed` means it is **not** — say so and why. Never write "posted" without reading this. |
   | `context_refresh.status` `skipped`/`failed` | The graph was not refreshed with this diff; the review may describe pre-edit code. Say so in one line and quote `context_refresh.reason`. |

## Notes

- **Single-shot**: one call, print the card, done. No loop, no fix-and-retry.
  The findings carry numbers; `/cloudaeye:implement [1,3]` plans fixes for
  them the same way it does for a review's.
- Good moments: a change that adds a dependency, a new module, an external
  system, or reaches across packages; a reviewer asking whether a change fits
  the design; before merging anything that touches more than one component.
- **The edges are not yours to add.** Every dependency on the card was read
  out of the code graph before and after the change. A missing one is an
  observation to state, not an edit to make.
- If `review_arch` is unavailable (MCP not connected), warn and skip — **do not
  review the architecture yourself from `git diff`**. A hand-drawn layering is
  the guesswork this tool exists to replace, and nothing in it would say which
  layers were inferred and which edges were verified.
