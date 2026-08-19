# CloudAEye for Claude Code

Pre-commit code review, security scanning, and task verification, as a Claude Code
plugin. CloudAEye reviews the change you have **not committed yet** — the diff against
your branch's fork point — so problems surface before they reach a PR.

> **Pre-release.** Sign-in through the browser is built on the review-server side and
> waits on the CloudAEye console's authorization endpoints. Until those are live,
> `/cloudaeye:init` will tell you sign-in is not configured yet — supply a key directly
> in the meantime. See [Connect your account](#connect-your-account).

## What you get

| Command | What it does |
|---|---|
| `/cloudaeye:inspect` | Bug pass — logic errors, edge cases, error handling, concurrency, dead imports. No security prompts, so it is cheap enough to run after every task. |
| `/cloudaeye:security` | Security pass — OWASP-style application security plus the LLM, AI-agent and MCP surfaces, and secrets on the changed lines. |
| `/cloudaeye:review` | Both of the above in one call. Use before opening a significant PR. |
| `/cloudaeye:describe` | A Change Description and Important Changes list, ready for a PR body or commit message. |
| `/cloudaeye:ask` | A question about the pending change, answered against the repository's code graph — callers, definitions, usage traces. |
| `/cloudaeye:init` | One-time setup for this machine. Fetches your API key and tenant once you're signed in, and proves it works. |
| `/cloudaeye:check-task` | Does this diff actually do what the ticket asked? DONE / NOT DONE with a per-requirement checklist. Takes a GitHub issue URL, ticket IDs, or plain text. |

None of them edit your code. They report; you decide.

## Install

```bash
/plugin marketplace add CloudAEye/claude-plugin
```

```bash
/plugin install cloudaeye
```

Restart Claude Code afterwards — skills load immediately, but MCP servers connect at
startup.

If you previously hand-installed these skills into `~/.claude/skills/cloudaeye-*`,
**delete that directory**. Two copies both work, and they drift apart silently.

## Connect your account

Two commands, one browser login, one restart. You never create a key, copy one, or look
up a tenant number.

**1. Restart Claude Code** after installing. MCP servers connect at startup, and the
CloudAEye server will refuse that first connection and say authentication is required —
which is what puts it in the list below.

**2. Run `/mcp`.** CloudAEye is listed as **Needs authentication**. Select it and choose
**Authenticate**. Your browser opens on the CloudAEye console: sign in, or create an
account if you're new, pick your organisation if you belong to more than one, and
approve. The password goes into our own web page and nowhere else — not into the
terminal, and not into your chat transcript.

That marker and that browser flow are Claude Code's own, not ours. It is the same
mechanism behind every hosted MCP server that authenticates.

**3. Run `/cloudaeye:init`.** It asks the review server for your API key and tenant —
the server already knows whose, because the request carries the token from step 2 —
stores them outside every git repository, and confirms by opening a real review session.
"Setup complete" means a review genuinely worked, not that a file was written.

Run `/cloudaeye:init` before step 2 and it stops immediately and tells you to
authenticate first. Nothing is half-configured to clean up.

### If you already have a key

You don't need any of the above. Claude Code offers these as prompts when you install
the plugin, and **every one of them is optional** — skip them all unless you already
have a key from <https://console.cloudaeye.com>:

| Prompt | Value |
|---|---|
| CloudAEye product API key | Only if you already have one from the console |
| Tenant key | The tenant that key belongs to |
| User name | Optional — scopes sessions so two developers on one repo don't share one |
| Review server URL | Optional — only for a self-hosted server |

The key is marked `sensitive`, so anything you do enter is held in Claude Code's
credential store rather than in a settings file or in your project.

The API key and the tenant key are a **pair** and both are required. The tenant selects
your organisation's database — the one holding the repo integration record, the
code-context graph and the Jira installation — and the key must be a key *in that
database*, carrying *that* tenant, granting the `Code Review` product. Miss either and
the server answers `401`/`403` and nothing runs.

These are read by the shell block inside each skill, which sends the key as an
`X-Product-API-Key` header on `POST /session` and `POST /upload`. They are **not** sent
with MCP tool calls — those take a `session_id`.

Nothing goes in your project. There is no per-repo config file, and no credential in
your working tree.

### Unattended machines, CI, and self-hosted installs

Where nobody is present to answer an install prompt, the same values resolve from the
environment — `CLOUDAEYE_API_KEY`, `CLOUDAEYE_TENANT_KEY`, `CLOUDAEYE_USER_NAME`,
`CLOUDAEYE_URL`. The environment takes precedence over the values you were prompted for,
so it also works as a per-shell override.

> **Why this isn't the recommended path any more.** On Windows a process inherits its
> parent's environment block, so a `setx` cannot reach a Claude Code that is already
> running — and "restart Claude Code" doesn't fix it if the window you restarted is a
> child of an older root process. We watched this cost most of a day on 2026-08-17: the
> variables were set correctly, `reg query` confirmed them, and every review still
> reported `not_configured`, which reads as a server fault rather than a local one.
> We have not tested whether macOS or Linux behave the same way. The install prompt
> avoids the question entirely, which is why it is now the default.

If you can't use either, `headers` on a `cloudaeye` entry in `~/.claude.json`
(`X-Product-API-Key` / `X-Tenant-Key` / `X-User-Name`) is read as a last resort.

Resolution order is per field: environment, then the install-time values, then the file
`/cloudaeye:init` writes into the plugin's data directory, then `~/.claude.json`. Every run prints `auth_from=` naming the layer that answered, on
success **and** on failure, so a broken review never leaves you guessing whether the
credential was the problem.

## What actually leaves your machine

Worth knowing before you point this at a private repo:

- **The diff is uploaded.** Each run captures `git diff` against the baseline and
  `POST`s it to your review server, which stages the post-edit file contents and runs
  the review there. Untracked files are included — they are marked with
  `git add --intent-to-add` so they appear in the diff.
- The scratch directory `.cloudaeye/` is created in your repo and gitignores itself on
  every run. It holds session files only — the request body, the server's response, and
  the diff.
- The API key travels in an `X-Product-API-Key` header, and reaches `curl` through a
  config file rather than the command line, so it stays out of the process table. That
  file is written to a private temp directory outside your repo and deleted when the
  run ends — no credential is ever written into your working tree.
- The `git add --intent-to-add` is non-destructive: it records paths in the index
  without staging content. Undo with `git reset`.

## Make it automatic

Paste into your project's `CLAUDE.md` if you want the coding agent to review its own
work before reporting done:

```markdown
## Code review policy (cloudaeye)

After completing any coding task, before reporting done:

1. Run `/cloudaeye:inspect` (bug pass — no security prompts)
2. Surface the findings to the user. Don't auto-fix unless asked.

If the change touches auth, untrusted input, deserialization, secrets, crypto, LLM
prompts, tool definitions, or agent orchestration — suggest `/cloudaeye:security`
after reporting the inspect findings. Don't run it uninvited.
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `/plugin marketplace add` fails on a corporate laptop | The `owner/repo` shorthand clones over SSH. Set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` and retry. |
| `/plugin install cloudaeye` reports the plugin is not found | The marketplace step above hasn't run, or the catalog is stale — `/plugin marketplace update cloudaeye`, then retry. To be explicit about which catalog it comes from, use the fully qualified `/plugin install cloudaeye@cloudaeye`. |
| `cloudaeye_error=not_configured` | No API key on this machine. Re-run `/plugin` and enter the values, then start a new session. If you were never prompted, see [Connect your account](#connect-your-account). |
| `not_configured` after you set `CLOUDAEYE_*` yourself | Windows only, as far as we've seen: the running Claude Code inherited its environment from a parent that started before your `setx`, so it cannot see the new values, and restarting a window doesn't help if that window is a child of the same old root. Use the install prompt instead, or sign out and back in. |
| `cloudaeye_error=auth_failed` | The server refused the key. The response body says which: unknown or expired key, a tenant the key does not belong to, or a key without the `Code Review` product. Retrying changes nothing. |
| `cloudaeye_error=insecure_url` | A remote server over plain `http`. Use `https`. |
| `cloudaeye_error=session_failed http=000` | Nothing answered at the review server — VPN, firewall, or a wrong `CLOUDAEYE_URL` if you set one. The line also prints `auth_from=`, so it tells you whether your credential resolved. |
| The `/cloudaeye:*` commands exist but the review never calls a tool | The MCP server did not connect. Restart Claude Code. If you are self-hosted, `CLOUDAEYE_URL` has to be set **before** it starts. |
| `base_source=head` in the output | The repo is not integrated with CloudAEye under your tenant, so there is no baseline branch. The review still runs, but only over working-tree edits. |

## Layout

```text
.claude-plugin/
  marketplace.json      this repo is its own single-plugin marketplace
  plugin.json           manifest + userConfig, the install-time prompts
.mcp.json               server URL only — no auth headers
hooks/
  hooks.json            SessionStart -> scripts/sync-creds.sh
scripts/
  sync-creds.sh         bridges userConfig values to a file the skills can read
skills/
  <verb>/SKILL.md        invoked as /cloudaeye:<verb>
```

The MCP tools take a `session_id`, not an API key — only `POST /session` and
`POST /upload` are authenticated, and those run from the shell block inside each skill.
That is why this repo ships no secrets: the credential is yours, entered at install and
held in your OS keychain.

`sync-creds.sh` exists because `CLAUDE_PLUGIN_OPTION_*` is documented as reaching hook
and MCP subprocesses, and a skill's shell block is neither. If a run reports
`auth_from=plugin`, those variables *do* reach the Bash tool, and both `hooks/` and
`scripts/` can be deleted along with the `pdata` layer in the six bootstrap blocks. If
it reports `auth_from=pdata`, they are load-bearing.
