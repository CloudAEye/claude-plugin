---
name: control-flow
description: Draw what the uncommitted changes in this repo did to the flow of control, as a mermaid sequence diagram with every message marked added, removed or retargeted. The arrows are resolved from the repository's code graph rather than inferred from the diff. Reports; it never edits code.
when_to_use: Use when the user asks what the change does to the flow, wants a sequence diagram for a PR description, or asks which components now talk to each other and in what order. For a prose summary of the change use /cloudaeye:describe instead.
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__initialize_repository", "mcp__cloudaeye__initialize_repository", "mcp__plugin_cloudaeye_cloudaeye__start_session", "mcp__cloudaeye__start_session", "mcp__plugin_cloudaeye_cloudaeye__control_flow", "mcp__cloudaeye__control_flow"]
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

**With a pull-request number** — `/cloudaeye:control-flow 412` or
`/cloudaeye:control-flow #412`, the same convention `/cloudaeye:review` takes —
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
   | `diff_bytes=0` | Nothing pending — report "nothing to describe" and stop. |
   | `base_source=fork_point` | Correct baseline: the fork point off the integrated branch, not its tip. Name the branch and `base_age`; a very old baseline may miss newer merged work. |
   | `base_source=head` | Degraded: only working-tree edits are in the diff. Say so. If `start_session` returned `setup_required`, report its `reason` and `remedy` verbatim — that is the actionable form. Do **not** quote `target_branch_error`: it names an internal record ("no datastore credentials for tenant 99") and tells the user nothing they can act on. |
   | `upload_http=` not `200` | The diff never reached the server. Stop; otherwise a stale result can look clean. |

   **Which baseline applied must reach the user.** Every degradation still produces output that looks correct, so silence about it is the one failure mode that misleads. Keeping the clone current is the developer's job — the skill never forces a fetch, it just refuses to hide what it used.
2. Call `mcp__plugin_cloudaeye_cloudaeye__control_flow` (pre-approved in this
   skill's frontmatter) with `session_id` from step 1. Leave `depth`, `label`
   and `cross_repo` at their defaults unless the user asks otherwise — the tool
   docstring explains each. Two arguments need a decision:

   - `context`: pass `{"scope_path": "<path>"}` only when the user scoped the
     run to a directory.
   - `post`: **writes a comment where other people can see it.** Pass `true`
     only after saying in one line what will happen — *CloudAEye will post the
     control-flow card as a comment on pull request #<n>* — and getting a clear
     yes. Naming a PR in the argument is asking for a diagram of it, not asking
     to comment on it. Needs a session opened with a `pr_number`.

3. Print the `card` field **verbatim, every mermaid fence included**, then stop.

   The fence is standard mermaid and stays mermaid: it is the same block that
   gets posted on the pull request, so what the developer reads here must be
   what their reviewer sees there. Do not redraw it as ASCII, flatten it for
   the terminal, or summarise the arrows in prose. If asked to render it: it
   renders in the artifact viewer, on GitHub, and in any markdown preview.

   The card is rendered server-side because what it may show is the feature.
   Four things it carries are invisible once reformatted away:

   - **it opens with one line beginning "This code change …"** — print it first
     and as written; it is the sentence a reviewer decides on;
   - **a facts table** — why this flow, what the call sequence did, how much of
     the change is *not* in the diagram, and the cross-repository line. Its
     "Independent changes" row is the one number nothing else carries;
   - a call the code graph could not follow is a **dashed arrow to a named
     receiver**, explained in the legend — there is no list of them to print;
   - the footer says the diagram is structure, not a trace.

   **Two diagrams, under `### Before` and `### After`, whenever the call
   sequence moved** — additions included. Both declare the same participants
   in the same order, so one collaborator can be tracked straight down the
   page. Print both, headings included: dropping Before turns a comparison into
   a claim about the current code. They are **two states, not one sequence** —
   never read Before's arrows as part of After's flow, never number across
   them. A Before heading reading *"this symbol did not exist"* means the
   change created it; the empty picture is the finding, not a rendering fault.

   One diagram means one of two opposite things, and the opening line says
   which: the sequence is **unchanged**, or there was **no pre-edit graph** to
   compare against (`diff_measured: false`).

   **A `### Cross-repository reach` section**, when present, is a claim about a
   *different* codebase — never fold its counts into the flow's own — and it is
   the most consequential thing on the card: a caller in another repository
   this change breaks is something nothing else in a review would surface.
   Lead with it.

   These fields change what you may say around the card:

   | field | what to do with it |
   |---|---|
   | `unavailable` | An ordinary answer, not an error to retry. Print the `note` and stop. |
   | `diagrams: 2` | The card holds a Before and an After. Print both; describe them as two states. |
   | `diff_measured: false` | No pre-edit graph, so **every marker was suppressed** and there is no Before. Say what changed could not be determined. Never report it as "nothing changed". |
   | `drawn: 0` | The change has no single flow. The card explains it. Do not pick a flow yourself. |
   | `cross_repo.affected` | Callers in other repositories this change may break. Say how many, in how many repositories. |
   | `cross_repo.unmeasured` | The search **could not run**. Not "no callers found" — say it did not happen and why. |
   | `cross_repo.not_indexed` | Some connected repositories have no graph and could not be searched. Say how many; the one that breaks may be among them. |
   | `pr_url` | A pull-request run. **End with a link** — `[<repo>#<pr_number>](<pr_url>)`. Absent on a working-tree run: give no link, and never construct one. |
   | `posted.status` | `ok` means the card is on the pull request. `unavailable` or `failed` means it is **not** — say so and why. Never write "posted" without reading this. |
   | `context_refresh.status` `skipped`/`failed` | The graph was not refreshed with this diff; the diagram may describe pre-edit code. Say so in one line and quote `context_refresh.reason`. |

## Notes

- **Single-shot**: one call, print the card, done. No loop, no fix-and-retry.
- Good moments: before opening a PR; when a reviewer asks "what does this
  actually change about the flow?"; when a change touches several components
  and the ordering matters.
- **Line order is not execution order.** `alt` shows branches; early returns and
  exceptions are not modelled. The diagram is what the code is *shaped like*.
- **The arrows are not yours to add.** Every message was resolved from the
  symbol index. A missing one is an observation to state, not an edit to make.
- If `control_flow` is unavailable (MCP not connected), warn and skip — **do not
  draw a sequence diagram yourself from `git diff`**. A hand-drawn one is the
  guesswork this tool exists to replace, and nothing in it would say which
  arrows were verified.
