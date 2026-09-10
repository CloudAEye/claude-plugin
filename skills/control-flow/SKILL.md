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
2. Call CloudAEye's `control_flow` MCP tool with:
   - `session_id`: the `session_id` printed by step 1
   - `depth`: omit. The default of 2 is the readable one — the changed symbol,
     what it calls, and what those call. Pass 3 only if the user asks to see
     further, and expect a busier diagram.
   - `label`: omit. Pass `false` only if the user asks for no model call at all;
     the diagram is identical either way, just titled with the raw symbol name.
   - `cross_repo`: omit. It searches the tenant's other connected repositories
     for callers this change may break, which is the most consequential thing
     the tool can find. Pass `false` only if the user asks to skip it.
   - `fmt`: omit for anything the user is going to **read here**. The default
     is a plain-text sequence, which is what this terminal can actually show —
     a mermaid fence renders here as its own source, sixteen lines of
     `sequenceDiagram` and `participant` declarations before the first arrow.
     Pass `"mermaid"` when the diagram is going somewhere that renders it: a
     pull request or issue body, a GitHub comment, a file the user will view.
     If they ask for "a diagram for the PR", that is `"mermaid"`.
   - `context`: omit unless the user scoped the run to a directory, in which
     case pass `{"scope_path": "<path>"}`.

   Call `mcp__plugin_cloudaeye_cloudaeye__control_flow`; it is pre-approved in
   this skill's frontmatter.
3. Print the `card` field verbatim, **every fenced block included**. Then stop.

   The diagram inside the fences is plain text by default, because that is what
   a terminal can show. Do not "improve" it into mermaid, and do not redraw it
   as ASCII art of your own — ask for `fmt: "mermaid"` instead and print that.

   The card is rendered server-side because the rules about what it may show
   are the feature, and each one is invisible once it is gone:

   - the calls the code graph could not follow are **named**, with file and line;
   - the flows that were not drawn are **counted**;
   - the footer says the diagram is structure rather than a trace.

   Reformatting the card, redrawing a diagram, "tidying" the participants or
   summarising the footer drops all three. Do not do any of them.

   **The card may hold two diagrams**, under `### Before` and `### After`
   headings, when the change removed or retargeted a call — a deleted call has
   no position in the new code, so showing it on one diagram would mean
   inventing one. When it does:

   - print **both**, headings included. Dropping the Before block turns a
     before/after into a claim about the current code;
   - they are **two states, not one sequence**. Never describe the Before
     block's arrows as part of the After block's flow, and never number across
     the two.

   A change that only adds calls comes back with one diagram, which is the
   common case. `diagrams` says which you got.

   **The card may end with a `### Cross-repository reach` section**, when the
   change deleted or re-signed something another connected repository calls, or
   deleted or moved an endpoint one of them reaches over HTTP. It has its own
   diagram and its own table. Two rules:

   - **It is a claim about a different codebase.** Never fold its counts into
     the flow's own — "2 unresolved" is about the repository being changed, and
     the reach table is about others.
   - **Lead with it when it is there.** A caller in another repository that this
     change breaks is the most consequential thing on the card, and the reason
     is that nothing else in a review would ever surface it.

   Seven fields change what you may say around the card:

   | field | what to do with it |
   |---|---|
   | `unavailable` | An ordinary answer, not an error to retry. Print the `note` and stop. |
   | `diagrams: 2` | The card holds a Before and an After. Print both; describe them as two states. |
   | `diff_measured: false` | There was no pre-edit graph to compare against, so **every marker was suppressed** and there is no Before picture. Say the diagram shows the current flow and that what changed in it could not be determined. Never report it as "nothing changed". |
   | `drawn: 0` | The change has no single flow. The card explains it. Do not pick a flow yourself. |
   | `cross_repo.affected` | Callers in other repositories this change may break. Say how many and in how many repositories. |
   | `cross_repo.unmeasured` | The cross-repository search **could not run**. This is not "no callers found" — say the search did not happen and why. |
   | `cross_repo.not_indexed` | Some connected repositories have no indexed graph, so they could not be searched. Say how many. The one that breaks may be among them. |
   | `context_refresh.status` `skipped` or `failed` | The stored code graph was not refreshed with this diff, so the diagram may describe the pre-edit code. Say so in one line and quote `context_refresh.reason`. |

## Notes

- This is a **single-shot** skill — one call, print the card, done. No loop, no
  fix-and-retry.
- Good moments to invoke: before opening a PR, when a reviewer asks "what does
  this actually change about the flow?", when a change touches several
  components and the ordering matters.
- **Line order is not execution order.** `alt` blocks show branches; early
  returns and exceptions are not modelled. Do not narrate the diagram as what
  the code does at runtime — it is what the code is *shaped like*.
- **The arrows are not yours to add.** Every message was resolved from the
  symbol index. If you think one is missing, say so as an observation; do not
  edit it into the mermaid.
- Pre-commit only for now: the diff is always `git diff` against the fork point.
  Committing moves `HEAD`; the review session persists.
- Without a refreshed code graph there are no resolved calls at all, and the
  tool returns `unavailable: no_code_graph` rather than a guess.
- If `control_flow` is unavailable (MCP not connected), warn the user and skip —
  **do not draw a sequence diagram yourself from `git diff`**. A hand-drawn one
  is exactly the guesswork this tool exists to replace, and nothing in it would
  tell the reader which arrows were verified.
