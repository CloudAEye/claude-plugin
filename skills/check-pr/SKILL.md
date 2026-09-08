---
name: check-pr
description: Run CloudAEye's PR hygiene checklist against an open pull request of this repository — docstring coverage, unit-test coverage, README freshness, dependency manifests, PR title and description quality, duplicate code, and a secret scan. Reports what each check found; it never edits code on its own.
when_to_use: Use before merging a pull request, or when the user asks whether a PR is ready, well-documented, tested, or described properly. This is the hygiene pass — for bugs and security use /cloudaeye:inspect, /cloudaeye:security or /cloudaeye:review.
argument-hint: "<PR number, e.g. 405 or #405>"
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__initialize_repository", "mcp__cloudaeye__initialize_repository", "mcp__plugin_cloudaeye_cloudaeye__check_pr", "mcp__cloudaeye__check_pr"]
---

## What this is, and what it is not

This is the **counterpart** to the review commands, not a variant of them.

| | runs | command |
|---|---|---|
| Bugs, security | the changed lines | `/cloudaeye:inspect`, `/cloudaeye:security`, `/cloudaeye:review` |
| **Hygiene** | **the whole repository** | **`/cloudaeye:check-pr`** |

The checks here are the ones that cannot run on a diff alone, because each needs
knowledge of the whole repository or of the pull request itself: docstring
coverage and unit-test coverage need the code graph, README freshness and
dependency manifests need the base branch's file tree, title and description
review need a real pull request, and duplicate-code detection needs the
repository's vector store.

**It finds no bugs and no vulnerabilities.** After reporting, if the user has
not already run one, say that a review is a separate command.

## Which checks run is not yours to choose

The set of checks comes from **this repository's checklist configuration in the
CloudAEye console**. There is no argument for it and no way to enable one from
here. Do not offer to turn a check on, and do not present a check that is off
as one that passed.

When nothing is enabled the tool returns `status: "not_configured"` and runs
nothing. That is a configuration answer, not a clean bill of health — see step 3.

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
   this command: every check here needs a pull request to exist.

   No diff is uploaded and no `git diff` is run. The server fetches the pull
   request itself, so nothing leaves the machine except the repository identity
   and the number.

2. Call `mcp__plugin_cloudaeye_cloudaeye__check_pr` with:
   - `repo`: `INIT.repo_full`
   - `pr_number`: the digits from step 1

   Nothing else. `review_id` and `wait_seconds` are for the resume case below.

   If the tool is unavailable or the call fails outright, tell the user to
   authenticate CloudAEye through `/mcp` and stop.

3. Handle the `status` field before reading anything else.

   | `status` | what to do |
   |---|---|
   | `ok` | Report it — step 4. |
   | `pending` | The checks are still running. Say so, then call `check_pr` again passing the `review_id` it returned, plus the same `repo` and `pr_number`. **Never start a second review** — each one is billed to the user's account. Do this at most three times, then report that the review is still running and give them the `review_id` to retry with later. |
   | `not_configured` | **Report this as configuration, never as a pass.** Say plainly that no checks are enabled for this repository, so nothing was run and nothing was billed. List the `available_checks` the response carries and point the user at the CloudAEye console to enable the ones they want. Do not say the PR "passed" or "looks clean" — nothing was examined. |
   | `error` with `pr_ineligible` | The eligibility refusal — closed or merged PR, wrong base branch, a fork, or over the 50-file limit. Print the `error` field **as written** and stop; each names a different thing to do. Do not paraphrase it to "the PR could not be checked". |
   | `error` with `setup_required` | The repository is not integrated. Report the `setup_required` guidance and stop. |
   | `error` otherwise | Report the `error` field and stop. |

4. Report the result — **a summary table and a link, not a transcript.**

   The full report goes onto the pull request itself — CloudAEye posts it there
   when the review finishes, with every check's detail, the findings and the
   generated description. **None of that is in the response**, deliberately:
   what comes back is a verdict, one summary line, a row per check, and counts.
   Print those and point at the pull request. Do not apologise for the missing
   detail or offer to fetch it — there is nothing to fetch, and the link is the
   answer. Whether it actually got there is in `posted`; step 4's last bullet
   is where you use it.

   - **First: `verdict` is `error`.** The checklist never completed, so nothing
     was checked. **Report it as a failed run and stop** — do not print the
     table, do not print the link as if there were a report at the other end,
     and never call the pull request clean. `degraded` says what failed.
     Re-running once the cause is fixed gives a real result.
   - **One line: the `verdict` and the `summary` field**, as the server wrote
     it — it already carries the counts (`3 of 6 checks passed`) and the
     percentage of any failing coverage check, so pass it through rather than
     recounting `checks` yourself. `approve` or `request_changes`, and say in the same breath what it
     covers: hygiene for this repository's enabled checks, not bugs and not
     security.
   - **Then the table** — one row per entry in `checks`: its `label`, its
     `status`, and its `metric`. That is the whole row; the check's own report
     is not in the response at all, by design. It is on the pull request.

     | Check | Status | Detail |
     |---|---|---|
     | Docstring coverage | failed | 57.1% (4/7 documented) |
     | PR title | passed | |

     `metric` is the check's own number — a coverage percentage and the ratio
     behind it — or a short verdict for the checks that have no number, or an
     empty string. **Print it exactly as given and leave the cell blank when it
     is empty.** Do not compute a percentage of your own, do not turn a ratio
     into one, and do not carry a number over from a previous run: a figure in
     that column reads as measured.

     The four statuses mean different things and must not be flattened:
     `passed` ran and is satisfied; `failed` ran and found something to do, and
     is what drives `request_changes`; `skipped` is **not enabled** for this
     repository, so say that rather than listing it as if it had run; `error`
     could **not** run — a gap in coverage, and the one status a reader will
     otherwise mistake for a pass.
   - **Then one pointer line, and `posted` decides what it says.** The server
     asks the CloudAEye GitHub App to comment and reports back whether it
     worked, so this is knowable rather than assumed — read `posted.status`
     and do not soften or upgrade it:

     | `posted.status` | the line to write |
     |---|---|
     | `ok` | `Full report: [<repo>#<pr_number>](<pr_url>)` — the complete checklist is on the pull request as a comment. |
     | `partial` | Give the link, and say some of the detail could not be posted. `posted.errors` says what failed. |
     | `failed` | Give the link, and say the checklist **could not be posted** — the table you just printed is all there is. Do not send the user to the pull request for detail that is not there. |
     | `unavailable` | Say the CloudAEye GitHub App is not installed on this repository, so nothing was posted and the table above is the whole result. `posted.note` carries the reason. Give the link only as the pull request itself, never as a pointer to a report. |

     If `posted` is absent entirely, fall back to naming the pull request as
     where the report goes and claim nothing about a comment existing. If
     `pr_url` is absent, give no link.
   - **`counts.findings` and `stages`, as counts on their own line.** Both
     arrive as numbers, never as bodies — the findings themselves are on the
     pull request. Say how many and which stage they came from. A `SECRET_SCAN`
     count above zero is the exception: say so plainly and treat it as urgent
     regardless of the rest of the result.
   - **`degraded` — always report it, in full, after the table.** It turns "we
     found nothing" into "we could not look", nothing else in the output says
     so, and it is the one thing a short summary cannot be trusted to carry.

   **Report what came back, not what didn't.** Do not enumerate checks that are
   absent from the response, and do not narrate timings or internal identifiers.


## Notes

- **This is a single-shot skill** apart from the `pending` resume in step 3. One
  call, report the output, done. No fix-and-retry loop.
- **It never edits code.** If the user wants something fixed, they ask, and you
  edit as you normally would. `/cloudaeye:implement` does not apply here — its
  plans describe edits to a working tree, and a pull request's source lives on
  the remote.
- **Each run is billed.** Re-running is fine when the pull request has new
  commits; re-running to "check again" on an unchanged PR spends the user's
  budget for the same answer. Say so rather than silently repeating it.
- **Bugs and security are a different command.** After a hygiene pass, if the
  user has not run one, suggest `/cloudaeye:review`. Do not run it uninvited.
- If `check_pr` is unavailable (MCP not connected), warn the user and skip.
