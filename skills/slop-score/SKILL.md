---
name: slop-score
description: Score the uncommitted changes in this repo — or one path of them, or an open pull request — for AI-slop signals, and report how much review the change needs, with the evidence behind it. Nine weighted signals — duplicate code, hallucinated APIs, dead code, missing tests, complexity, generic naming, boilerplate comments, overengineering, style inconsistency — plus the shape of the change. Reports a card and one of four review bands; it never edits code.
when_to_use: Use when the user asks how much slop is in a change, whether it looks AI-generated, whether it needs a careful manual read before merge, or asks for a slop score. Also useful on a large change whose per-file review came back clean but whose size does not look earned.
argument-hint: "[optional: a path, or a PR number like #5]"
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__initialize_repository", "mcp__cloudaeye__initialize_repository", "mcp__plugin_cloudaeye_cloudaeye__start_session", "mcp__cloudaeye__start_session", "mcp__plugin_cloudaeye_cloudaeye__slop_score", "mcp__cloudaeye__slop_score"]
---

## What this is

Nine signals, weighted to 100 points, over the change:

| Signal | Weight | | Signal | Weight |
|---|---|---|---|---|
| Duplicate code | 20 | | Generic naming | 5 |
| Hallucinated API | 20 | | Boilerplate comments | 5 |
| Dead code | 15 | | Overengineering | 5 |
| Missing tests | 15 | | Style inconsistency | 5 |
| High complexity | 10 | | | |

The weights feed four bands, and **the band is the output** — the underlying number is not reported, because the weights and saturation rates are not yet validated against a labelled sample and a three-digit score would claim a precision nothing has earned:

**Low likelihood of slop** · **Review recommended** · **High likelihood of low-quality code** · **Strong candidate for manual review before merge**

Reported beside the score and contributing no points: the volume of the change, how many changed functions carry a real behavioural edit, documentation drift, and commit shape. Volume is the *denominator* the other signals are measured against — a 1,200-line change is not slop, it is a 1,200-line change — which is why it is context rather than a scored signal.

## The one rule you must not break

**The band describes review burden, never authorship.** "Strong candidate for manual review before merge" is a claim about a change. "This was AI-generated" is a claim about a person, and this command does not make it — it would be wrong about copy-pasted human work as often as it was right. Report the score, the band and the evidence. Do not translate any of them into a statement about who or what wrote the code, even if the user's question was phrased that way.

## Three modes

The argument decides which. Read it before anything else:

| Argument | Mode |
|---|---|
| *none* | **Working tree** — every uncommitted change. This is the usual one. |
| `#405`, or bare digits like `405` | **Pull request** — PR 405 of this repository. |
| anything else — `src/auth/login.ts`, `src/auth/`, `src/auth` | **Path** — only the changes under that file or directory. |

Digits mean a pull request. If the user really means a directory named `405`, they write `./405` and you treat it as a path.

There is deliberately **no severity flag.** A floor drops findings before they are counted, so every numerator would shrink while the denominators stayed put — the score would fall because less was reported rather than because less was wrong. The server refuses one for the same reason.

### Path mode

The scope is applied where the diff is made — `git diff <base> -- <path>` — so only that subtree is ever uploaded. A directory covers everything beneath it; a file covers just that file.

**Say what was excluded.** A score over one directory reads exactly like a score over the whole change. Always name the scope and how many of the changed files it left out — "scored 2 of 7 changed files (src/auth/)". The response echoes a `scope` field for the same reason; do not drop it.

Two signals get weaker under a scope and it is worth one line to the user: duplicate code cannot see a copy that landed in an excluded file, and hallucinated APIs cannot see a definition that lives in one.

### Pull-request mode

Scores an open pull request of *this* repository. The server fetches the diff from GitHub itself, so there is no upload step and no diff leaves the machine.

A pull request must be **open** (drafts are fine), must merge into this repository's **integrated branch**, must **not come from a fork**, and must change **at most 50 files**. The server checks all four before doing any work and refuses with a reason naming what to do. Report that reason as written and stop — never fall back to scoring the working tree, which is a different change.

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

   **Pull-request mode:** also pass `pr_number` — the digits the user gave, with any `#` stripped. Then **stop here and go to step 2**: the diff is already on the server, so the whole upload block below is skipped, and running it would compute a working-tree diff nobody asked for.

   On `status: error` in this mode, print the `error` field as written and stop. It is the eligibility refusal — closed pull request, wrong base branch, fork, or over the 50-file limit — and each names a different thing to do. Do not paraphrase it into "the PR could not be reviewed", and do not review the working tree instead.

   On success the response carries a `pull_request` block: number, title, `draft`, `base`, `head`, `head_sha` and `changed_files`. Say which pull request you are scoring, and say so if it is a draft — the user may have meant a different one, and the head SHA is what makes the score reproducible.

   **Working-tree and path modes only, from here to the end of step 1.** Validate the returned values before substituting them below: `session_id` must contain only hex digits and dashes, `upload_token` exactly 64 hex characters, `upload_url` must be HTTPS or localhost HTTP, and `target_branch` must match `[A-Za-z0-9._/-]+` without starting with `-`; use an empty target when it does not. Then run this as one Bash call. The upload token is written only to a private temporary curl config and is never printed or stored in the repository.

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
   | `diff_bytes=0`, `scope=-` | Nothing pending — report "nothing to score" and stop. |
   | `diff_bytes=0` with a scope | Nothing has changed under that path. Say so **naming the path**, and stop. Do not widen to the whole change — they asked about one place. |
   | `diff_files` below `total_files` | A scoped score. Report both — "scored 2 of 7 changed files (src/auth/)" — and say duplicate code and hallucinated APIs are weaker under a scope, since neither can see an excluded file. The number here is a number *for that path*, and nothing else in the output says so. |
   | `cloudaeye_error=scope_outside_repo` | The path escaped the repository (`..`, absolute, or `~`). Report it and stop. |
   | `base_source=fork_point` | Correct baseline: the fork point off the integrated branch, not its tip. Name the branch and `base_age`; a very old baseline may miss newer merged work. |
   | `base_source=head` | Degraded: only working-tree edits are in the diff. Say so. If `start_session` returned `setup_required`, report its `reason` and `remedy` verbatim — that is the actionable form. Do **not** quote `target_branch_error`: it names an internal record ("no datastore credentials for tenant 99") and tells the user nothing they can act on. |
   | `upload_http=` not `200` | The diff never reached the server. Stop; otherwise a stale result can look clean. |

   **Which baseline applied must reach the user.** Every degradation still produces output that looks correct, so silence about it is the one failure mode that misleads. Keeping the clone current is the developer's job — the skill never forces a fetch, it just refuses to hide what it used.
2. Call CloudAEye's `slop_score` MCP tool with:
   - `session_id`: the `session_id` printed by step 1
   - `context`: in **path mode**, set `scope_path` to the path the user gave. It filters nothing — you already narrowed the diff — but it is what makes the response say what it covered, and a narrowed score that does not say so is the one result that misleads. Omit it otherwise.

   Do not pass `run_review: false`. It scores only what is already on disk, which on a fresh session is every signal unmeasured — a correct answer and a useless one.

   Call `mcp__plugin_cloudaeye_cloudaeye__slop_score`; it is pre-approved in this skill's frontmatter.

   The tool runs the `slop` review profile first so the signals have something to read, then does the arithmetic. Anything a previous `/cloudaeye:review` or `/cloudaeye:inspect` already computed **on this same diff** is reused rather than paid for again, so the second scoring of an unchanged change is nearly free. You do **not** need to read the changed files yourself — the server has them staged.

3. Report the response to the user:

   - **First: a `degraded` block.** The review underneath ran with no post-edit source staged, so every signal read an empty file. **Report it as a failed run and stop — do not present the card, and never call it a low score.** The server does not cache a degraded run, so re-running once the cause is fixed gives a real answer.

   - **Print `card` verbatim, inside a fenced code block.** Do not reformat it, do not turn it into a table, do not drop rows, and do not re-order it. It is rendered server-side precisely because the rules about what may be shown are the feature: an unmeasured signal prints a dash and a reason rather than a bar at zero, the header says what the total is out of, and a partially built signal says so on its own row. Every one of those is lost the moment the card is retyped.

   - **`band_source: "judged"`, when present.** The arithmetic's band was moved one step after a model weighed the evidence — `band_reason` says why and `arithmetic_band` is what it moved from. The card already prints all three; do not drop them when summarising, and do not present the judged band as if the arithmetic produced it. When the field is absent the band is the arithmetic's and there is nothing to explain.

   - **There is no number, and do not invent one.** The result carries a band, not a score. The weights and saturation rates behind the arithmetic are not yet validated against a labelled sample, so a three-digit total would claim a precision nothing has earned — the band is one of four buckets and survives being approximately right. Report the band. Do not compute, estimate or reconstruct a percentage from the bars or the weights.

   - **`measured_weight` / `out_of` are coverage, not score.** They say how much of the hundred points anything actually looked at. When they differ, say so — "scored over the 70 points we could measure" — because a band derived from seven signals means less than one derived from nine.

   - **Never report `unmeasured` as clean.** Each entry is a signal nothing looked at, which is a different statement from a signal that found nothing. If the user's question was "is this change slop?", an answer that quietly omits three unmeasured signals is not an answer. Name them and say why in one line — the card already carries the reason.

   - **The findings are numbered by the server.** Print them exactly as the card numbers them and never renumber. Those numbers are what the user types back at `/cloudaeye:implement [1,3]`, which resolves them in Python against the stored report.

   - **`scope`, when present.** Name the path and how many changed files were left out, and say that duplicate code and hallucinated APIs are weaker under a scope.

   - Then say what you would do about it, in one or two sentences grounded in the highest-scoring rows — not in the band name. A 60 driven by duplicate code and a 60 driven by missing tests call for different work, and the band cannot tell them apart.

   - If there are findings, offer `/cloudaeye:implement [n]` for a plan on the ones the user picks. Do not start editing until they reply.

## Notes

- **The score is arithmetic; only the band is judged.** Every point traces to a finding with a file and a line, which is why the card can be argued with. If the user disputes a row, look at the evidence under it rather than defending the number. The one model judgment is the band, it can move by one step at most, and its reason is printed — so that is also arguable rather than an oracle.
- **A low score is not an approval.** These nine signals are about the shape of a change, not its correctness — a change can be perfectly clean here and still be wrong. For bugs run `/cloudaeye:inspect`, and for the security surface `/cloudaeye:security`. Say this when the user reads a low score as "good to merge".
- **Volume is context, not a signal.** The headline reports lines, files and how many changed functions carry a real behavioural edit. "1,200 lines, 65 files, two behavioural changes" is the shape the whole feature exists to make visible, and it contributes no points on purpose — a big change is not a bad one.
- **Commit shape is reported absent, never clean.** A session carries no commit list, so the "one enormous commit, generic message" signal cannot be measured here and says so rather than passing.
- **Generated and vendored files are excluded**, and the exclusion is reported. Lockfiles and generated output are the reason a "1,200 lines changed" headline is usually wrong.
- **A scored run saves its report,** so `/cloudaeye:implement` works on the findings straight afterwards, and a later `/cloudaeye:review` on the same diff reuses the stages this run paid for.
- This is a **single-shot** skill — one call, report the output, done. No fix-and-retry loop inside the skill.
- If `slop_score` is unavailable (MCP not connected), warn the user and skip.
