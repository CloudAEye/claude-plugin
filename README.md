# CloudAEye for Claude Code

Pre-commit code review, security scanning, AI-slop scoring, change descriptions, questions, task verification, pull-request hygiene checks, docstring and unit-test generation, issue explanation, tracking-issue creation, and fix planning for Claude Code.

## Commands

| Command | Purpose |
|---|---|
| `/cloudaeye:init` | Detect and initialize the current repository |
| `/cloudaeye:inspect` | Bug-focused review; security is a separate pass |
| `/cloudaeye:security` | Application, LLM, agent, MCP, and secret security review |
| `/cloudaeye:review` | Full bug and security review |
| `/cloudaeye:describe` | Describe the pending change |
| `/cloudaeye:control-flow` | Draw what the change did to the flow of control, as a sequence diagram |
| `/cloudaeye:ask` | Ask a question about the pending change |
| `/cloudaeye:check-task` | Compare the pending change with a task or ticket |
| `/cloudaeye:check-pr` | Run the hygiene checklist over an open pull request |
| `/cloudaeye:implement` | Plan a fix for findings a review already produced |
| `/cloudaeye:slop-score` | Score a change for AI-slop signals, with the evidence behind every point |
| `/cloudaeye:add-docs` | Write docstrings for an open pull request and post them there as suggestions |
| `/cloudaeye:add-tests` | Write unit tests for an open pull request and post them there as suggestions |
| `/cloudaeye:explain` | Explain a Jira or GitHub issue against the code it touches |
| `/cloudaeye:create-issue` | File findings from a review as Jira tickets or GitHub issues |

The review commands report results and do not edit code. `/cloudaeye:implement` is the one that leads to edits, and even there the server only returns a plan — Claude applies it, and you re-run the review to confirm the fix landed.

Four commands write where other people can see it, and each confirms before it does: `/cloudaeye:add-docs` and `/cloudaeye:add-tests` post suggestions on a pull request, `/cloudaeye:control-flow` can post its card there when asked, and `/cloudaeye:create-issue` opens real tickets.

## Typical workflows

Every review command runs in one of two modes: with no argument it reviews your **uncommitted changes**, and with a pull-request number (`#412`) it reviews that **open pull request** — the server fetches the diff itself, so nothing is uploaded from your machine. The same command, the same output, two points in the cycle.

### Before you commit

```text
/cloudaeye:inspect                  after each task — the cheap bug pass; security is its own pass
/cloudaeye:implement [1,3]          plan fixes for findings 1 and 3; Claude applies them
/cloudaeye:inspect                  again, to confirm the fixes landed
/cloudaeye:check-task BETA-5225     does the change do what the ticket asked?
/cloudaeye:review                   bugs and security in one pass, before opening the PR
/cloudaeye:describe                 the PR body
```

`/cloudaeye:control-flow` shows what the change did to the order of calls, and `/cloudaeye:slop-score` how much careful reading it needs — both useful before a PR on a change you did not write line by line.

### After you push

```text
/cloudaeye:review #412              the full review, on the pull request
/cloudaeye:control-flow #412        before/after diagrams, and who in other repositories calls what changed
/cloudaeye:check-pr #412            the hygiene checklist — description, title, docs, tests, dependencies
/cloudaeye:add-docs #412            docstrings, posted as suggestions on the pull request
/cloudaeye:add-tests #412           unit tests, posted the same way
/cloudaeye:create-issue [2] jira    file finding 2 as a Jira ticket (or `github`), optionally with an assignee
```

The pull request must be open, merge into your integrated branch, not come from a fork, and change at most 50 files. `/cloudaeye:implement` does not run on a pull request: its plans describe edits to a working tree.

Full details of every command — what to pass, what comes back, and how to read it — are in the [User Guide](https://docs.cloudaeye.com/user-guide/mcp/usage-guide.html).

## Install

```text
/plugin marketplace add CloudAEye/claude-plugin
/plugin install cloudaeye
```

Restart Claude Code so the MCP server connects. If you previously installed the skills manually, remove those copies to avoid loading stale commands.

## Authenticate

1. Run `/mcp` in Claude Code.
2. Select CloudAEye and choose **Authenticate**.
3. Complete sign-in, organisation selection, and consent in the browser.
4. Run any `/cloudaeye:*` command in a Git repository with pending changes.

Claude Code stores and refreshes the OAuth credentials.

## Update

Every release bumps the `version` in [plugin.json](.claude-plugin/plugin.json); Claude Code only offers an update when it sees a newer one.

**Nothing prompts you by default.** Claude Code turns auto-update off for every marketplace that is not Anthropic's own, so a new CloudAEye release waits until you ask for it:

```text
claude plugin update cloudaeye@cloudaeye
```

Then run `/reload-plugins` in a terminal session, or start a new session. In the desktop app the plugin's MCP server — where the review tools live — reconnects only in a new session, so start one there; a release usually changes what that server offers, and a stale connection keeps the old tool list.

**To be prompted instead**, turn auto-update on for the CloudAEye marketplace once: `/plugin` → **Marketplaces** → `cloudaeye` → **Enable auto-update**. Claude Code then checks after each session starts, with a random delay of up to ten minutes, and when it has fetched a newer version shows a notification asking you to run `/reload-plugins`. If you ignore it, the new version loads on your next launch. The desktop app has no `/plugin` panel; use the command above there.

**Updating does not sign you out.** Credentials are stored against the server URL, and an update never changes it. If `/mcp` shows **Needs authentication** after an update, a token could not be refreshed — run **Authenticate** as above. Nothing about the update itself requires it.

`claude plugin list` shows the version you have.

## Self-hosted Server

The plugin uses `https://api.cloudaeye.com/mcp` by default. Set `CLOUDAEYE_URL` before starting Claude Code to use a self-hosted OAuth-enabled MCP endpoint.

## Data Flow

Each operational skill:

1. Detects the provider, repository URL, current branch, and base branch.
2. Calls the session-free `initialize_repository` tool; it opens setup only when the provider is not connected.
3. Calls the OAuth-authenticated `start_session` tool after initialization.
4. Builds and uploads the diff with `git diff` after `git add --intent-to-add .` so untracked files are included.
5. Calls the requested MCP review tool with the returned session ID.

The upload token is placed in a private temporary curl config, is not printed, and is deleted when the upload command exits. The `.cloudaeye/` scratch directory contains only gitignored session diff data. Previously stored credential files are neither read nor changed.

OAuth requires an interactive MCP client, so unattended CI and service-account support is outside this release.

## Troubleshooting

| Symptom | Fix |
|---|---|
| CloudAEye shows **Needs authentication** | Open `/mcp` and complete **Authenticate** |
| A skill says `start_session` is unavailable | Restart Claude Code so the updated MCP tools load |
| A command from the docs is missing, or its tool is reported unavailable | Your plugin is behind: `claude plugin update cloudaeye@cloudaeye`, then a new session — see [Update](#update) |
| `upload_http=401` | The upload grant is missing, invalid, or belongs to another session |
| `upload_http=000` | Check network access and the configured review server URL |
| `cloudaeye_error=insecure_url` | Use HTTPS, except for localhost development |
| `base_source=head` | Connect the repository integration to enable the configured target branch |

## Layout

```text
.claude-plugin/plugin.json   plugin manifest
.mcp.json                    OAuth MCP server registration
skills/<verb>/SKILL.md       operational commands
```
