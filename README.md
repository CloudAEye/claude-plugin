# CloudAEye for Claude Code

Pre-commit code review, security scanning, change descriptions, questions, task verification, pull-request hygiene checks, and fix planning for Claude Code.

## Commands

| Command | Purpose |
|---|---|
| `/cloudaeye:init` | Detect and initialize the current repository |
| `/cloudaeye:inspect` | Bug-focused review without security prompts |
| `/cloudaeye:security` | Application, LLM, agent, MCP, and secret security review |
| `/cloudaeye:review` | Full bug and security review |
| `/cloudaeye:describe` | Describe the pending change |
| `/cloudaeye:ask` | Ask a question about the pending change |
| `/cloudaeye:check-task` | Compare the pending change with a task or ticket |
| `/cloudaeye:check-pr` | Run the hygiene checklist over an open pull request |
| `/cloudaeye:implement` | Plan a fix for findings a review already produced |

The review commands report results and do not edit code. `/cloudaeye:implement` is the one that leads to edits, and even there the server only returns a plan — Claude applies it, and you re-run the review to confirm the fix landed.

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
