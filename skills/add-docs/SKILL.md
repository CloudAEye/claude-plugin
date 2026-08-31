---
name: add-docs
description: Have CloudAEye write docstrings for the undocumented code in an open pull request and post them on the pull request as one-click review suggestions. It writes on the PR; it never edits your working tree.
when_to_use: Use when the user asks to document a pull request, add docstrings to one, or fix the docstring coverage a /cloudaeye:check-pr run reported. Needs an open pull request — there is no working-tree mode.
argument-hint: "<PR number, e.g. 405 or #405>"
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__initialize_repository", "mcp__cloudaeye__initialize_repository", "mcp__plugin_cloudaeye_cloudaeye__add_docs", "mcp__cloudaeye__add_docs"]
---

## What this is

CloudAEye reads the repository's code graph to find changed functions with no docstring, writes one for each, and posts them **onto the pull request** as review suggestions. The developer applies them there with one click.

It needs the whole-repository graph to know what is already documented, which is why it runs against a pull request rather than your working tree, and why it is a CloudAEye command rather than something you do by hand.

## Two things that make this different from the review commands

**It writes on the pull request.** Every suggestion is a comment other reviewers
will see. Ask the user before running it, and run it only on a clear yes — see
step 2. The review commands report; this one publishes.

**The content never comes back here.** The tool returns counts and a file list,
never the generated docstring suggestions. That is deliberate: the text is on the pull request,
where it can be applied with one click, and pulling it through this conversation
just to print it would be the same words three times.

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

1. Read the pull request number from the argument.

   Strip a leading `#`. It must be a positive whole number. If the user gave
   nothing, ask which pull request — do **not** guess from the current branch,
   and do not fall back to the working tree. There is no working-tree mode for
   this command.

   No diff is uploaded and no `git diff` is run. The server fetches the pull
   request itself.

2. **Confirm before running.** Say what will happen in one line — CloudAEye will
   post docstring suggestions on `<repo>#<number>`, visible to everyone on the pull request —
   and wait for the user to agree. If they have not clearly said yes, stop here.
   Do not confirm on their behalf because they named the PR in the argument.

3. Call `mcp__plugin_cloudaeye_cloudaeye__add_docs` with:
   - `repo`: `INIT.repo_full`
   - `pr_number`: the digits from step 1

   Nothing else. `job_id` and `wait_seconds` are for the resume case below.

   If the tool is unavailable or the call fails outright, tell the user to
   authenticate CloudAEye through `/mcp` and stop.

4. Handle the `status` field before reading anything else.

   | `status` | what to do |
   |---|---|
   | `ok` | Report it — step 5. |
   | `pending` | Still generating. Say so, then call the tool again passing the `job_id` it returned, plus the same `repo` and `pr_number`. **Never start a second run** — it would post a second set of suggestions on the same pull request. Do this at most three times, then report that it is still running, and give the user the `job_id` to resume with. Whatever finishes is posted on the pull request either way. |
   | `error` with `pr_ineligible` | The eligibility refusal — closed or merged PR, wrong base branch, a fork, or over the 50-file limit. Print the `error` field **as written** and stop; each names a different thing to do. |
   | `error` with `setup_required` | The repository is not integrated. Report the `setup_required` guidance and stop. |
   | `error` otherwise | The generation job failed and nothing was posted. Report the `error` field as written. Re-running is reasonable once the cause is known; do not re-run reflexively. |

5. Report the result — **a summary and a link, not the content.**

   - **`summary`**, as the server wrote it. It already carries the counts, so
     pass it through rather than recounting `files` yourself.
   - **A table of `files`**, when there are any: the `path`, its `suggestions`
     count, and whether it is a `new_file`. Nothing else — you do not have the
     generated text and must not invent a sample of it.

     | File | Suggestions | New |
     |---|---|---|
     | `src/worker.py` | 4 | |

   - **One pointer line**, using `pr_url`: `Suggestions: [<repo>#<pr_number>](<pr_url>)`,
     and say CloudAEye posted them there as review suggestions the user can apply
     with one click. Do not claim a specific number is visible on the page — the
     count is of what was generated, and posting each one is the service's job,
     not something this command can see.
   - **`unattached`**, when present: that many suggestions came back without a
     file attached. Mention it; it explains a count that does not add up.
   - **No suggestions is an ordinary answer.** It means every changed function CloudAEye checked already has a docstring. Say that. It is not a failure, and it is not a reason to run it again.

6. Stop there. Do not offer to apply the suggestions, do not fetch them, and do
   not start a review of the pull request. If the user wants one, that is
   `/cloudaeye:check-pr` or `/cloudaeye:review`.

## Notes

- **One call, one report.** No fix-and-retry loop beyond the `pending` resume.
- **It never edits your working tree.** Everything it produces lives on the pull
  request.
- **Each run is billed, and each run posts.** Re-running on an unchanged pull
  request spends the user's budget to publish a second set of the same
  suggestions. Say so rather than quietly repeating it.
- **Do not write the docstrings yourself instead.** If the user wants them in the working tree rather than on the pull request, say that this command posts on the pull request and offer to write them by hand as a separate, ordinary edit — do not present one as the other.
- If the tool is unavailable (MCP not connected), warn the user and skip.
