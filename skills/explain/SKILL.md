---
name: explain
description: Explain a Jira or GitHub issue against the code it actually touches — the components involved, how they work today, and the related patterns and configuration around them. CloudAEye reads the repository's graph and vector store, which is why this answers things the issue text alone cannot.
when_to_use: Use when the user asks what an issue is about, what it would take to fix it, or which code it touches — before picking up a ticket, or when triaging one someone else filed. Takes a Jira key, a GitHub issue number, or an issue URL.
argument-hint: "jira <KEY|id> | github <issue#> | <issue URL>"
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__initialize_repository", "mcp__cloudaeye__initialize_repository", "mcp__plugin_cloudaeye_cloudaeye__explain", "mcp__cloudaeye__explain"]
---

## What this is

CloudAEye reads the issue, picks the repository most relevant to it, and runs a
codebase query over that repository's graph and vector store: which components
the issue touches, how they work today, similar patterns elsewhere, and the
configuration and dependencies around them.

It answers **about an issue**, not about your working tree. It runs no review,
finds no bugs, and never edits code. For the pending diff use `/cloudaeye:ask`;
for "does my change satisfy this ticket" use `/cloudaeye:check-task`.

## The answer comes back here

Unlike `/cloudaeye:check-pr`, `/cloudaeye:add-docs` and `/cloudaeye:add-tests`,
this one does not send the user somewhere else to read the result. The analysis
is in the `context` field. Print it.

One side effect to mention, not to build the report around: for a **Jira** or
**GitLab** issue CloudAEye also posts the analysis as a comment on the issue
itself, so a public comment appears on someone's ticket. `posted_to` says so
when it happened. For a GitHub issue nothing is posted and the field is absent.

## Steps

### Repository initialization gate

Before anything else, run the bundled preflight helper and call the
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
authoritative `repo`. Do not recompute it from local Git.

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

Do not proceed until this gate reports `ready` or `initialized`.

1. Read the issue reference from the argument.

   - `jira <KEY-or-id>` — pass `issue` as the key or id, `source` as `jira`.
   - `github <number>` — pass `issue` as the number, `source` as `github`.
   - A bare URL, or a bare Jira key like `BETA-5225` — pass it as `issue` and
     leave `source` empty. The server works it out.
   - **A bare number with no word in front is ambiguous** — Jira takes a numeric
     id too. Ask which tracker rather than assuming; the server will refuse it
     anyway, and asking is the faster path.

   If the user gave nothing, ask which issue. Do not guess from the branch name
   or from anything in the working tree.

2. Call `mcp__plugin_cloudaeye_cloudaeye__explain` with:
   - `issue`: the reference from step 1
   - `repo`: `INIT.repo_full`
   - `source`: `jira` or `github`, only when step 1 established it

   `repo` is what a bare issue number is resolved against. A Jira key does not
   need it — CloudAEye picks the relevant repository itself, and the response
   says which one it picked, which may not be the one you are standing in.

   If the tool is unavailable or the call fails outright, tell the user to
   authenticate CloudAEye through `/mcp` and stop.

3. Handle the `status` field before reading anything else.

   | `status` | what to do |
   |---|---|
   | `ok` | Report it — step 4. |
   | `pending` | Still being generated. Say so, then call `explain` again with the **same arguments** — there is no id to pass, and a second call never starts a second run. Do this at most three times, then say it is still running and that re-running later will pick up the finished analysis. |
   | `error` with a `note` about not retrying | A previous attempt failed and CloudAEye will not retry it on its own. Print the `error` and the `note` as written — a re-run returns the same failure, so do not offer one. |
   | `error` with `setup_required` | The repository is not integrated. Report the guidance and stop. |
   | `error` otherwise | Report the `error` field as written and stop. |

4. Report the result.

   - **`summary`**, as the server wrote it — it names the issue and the
     repository CloudAEye chose.
   - **`context`, in full, as markdown.** This is the answer and it is what the
     user asked for. Do not summarise it away, do not reorder it into your own
     headings, and do not extend it with your own reading of the code — it rests
     on a repository graph and vector store you do not have, and a sentence of
     yours mixed into it is indistinguishable from one of CloudAEye's.
   - **`repository`**, if it is not the repository the user is in. Say so
     plainly; an analysis of a different repository is still useful, but the user
     has to know that is what they are reading.
   - **`posted_to`**, when present — one line saying CloudAEye also left this as
     a comment on the issue, linked with `issue_url` when there is one. One line;
     the answer is above it.
   - **`reused: true`** — the analysis was generated earlier and CloudAEye does
     not re-explain an issue. **Always say this.** If the code has moved since,
     the analysis describes the older code, and nothing else in the output says
     so.

5. Stop there. If the user wants the issue implemented, that is ordinary work
   you do yourself — this command is context, not a plan.

## Notes

- **It never edits code, and never posts on a pull request.**
- **One analysis per issue.** Re-running is free of new charges but also free of
  new information; say that rather than running it again to "refresh".
- Jira works only if the tenant has the CloudAEye Jira app installed — that is
  what lets CloudAEye read the issue and comment on it. If a Jira reference comes
  back with an error naming the integration, that is the fix, not a retry.
- If `explain` is unavailable (MCP not connected), warn the user and skip.
