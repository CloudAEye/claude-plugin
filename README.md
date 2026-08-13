# CloudAEye for Claude Code

Pre-commit code review, security scanning, and task verification, as a Claude Code
plugin. CloudAEye reviews the change you have **not committed yet** — the diff against
your branch's fork point — so problems surface before they reach a PR.

> **Pre-release.** The plugin works today against a review server you can reach. Set
> the credential yourself: see [Connect your account](#connect-your-account).

## What you get

| Command | What it does |
|---|---|
| `/cloudaeye:inspect` | Bug pass — logic errors, edge cases, error handling, concurrency, dead imports. No security prompts, so it is cheap enough to run after every task. |
| `/cloudaeye:security` | Security pass — OWASP-style application security plus the LLM, AI-agent and MCP surfaces, and secrets on the changed lines. |
| `/cloudaeye:review` | Both of the above in one call. Use before opening a significant PR. |
| `/cloudaeye:describe` | A Change Description and Important Changes list, ready for a PR body or commit message. |
| `/cloudaeye:ask` | A question about the pending change, answered against the repository's code graph — callers, definitions, usage traces. |
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

Reviews need one credential: a CloudAEye **product API key** carrying the `Code Review`
product, plus the tenant key it belongs to. Create an account at
<https://console.cloudaeye.com/signup>, then generate a key on the console.

Set three environment variables. **Windows** — `setx`, then restart Claude Code:

```bash
setx CLOUDAEYE_API_KEY your-product-api-key
```
```bash
setx CLOUDAEYE_TENANT_KEY 92
```
```bash
setx CLOUDAEYE_USER_NAME your-name
```

**macOS / Linux** — in your shell profile, so they survive a reboot:

```bash
export CLOUDAEYE_API_KEY=your-product-api-key
export CLOUDAEYE_TENANT_KEY=92
export CLOUDAEYE_USER_NAME=your-name
```

That is the whole setup. The review server address is preconfigured in the plugin, so
there is nothing else to set.

> **Windows, the one that catches everyone:** an `export` in Git Bash is invisible to a
> Claude Code launched from the Start menu. Use `setx` (or System Properties →
> Environment Variables) and restart the app, or the plugin will look configured and
> behave as though it is not.

`CLOUDAEYE_API_KEY` and `CLOUDAEYE_TENANT_KEY` are a **pair** and both are required. The
tenant selects your organisation's database — the one holding the repo integration
record, the code-context graph and the Jira installation — and the key must be a key *in
that database*, carrying *that* tenant, granting the `Code Review` product. Miss either
and the server answers `401`/`403` and nothing runs. `CLOUDAEYE_USER_NAME` is optional;
it scopes the review session so two developers on one repo don't share one.

These are read by the shell block inside each skill, which sends the key as an
`X-Product-API-Key` header on `POST /session` and `POST /upload`. They are **not** sent
with MCP tool calls — those take a `session_id`, which is why this plugin ships no
secrets and needs no configuration to install.

Nothing goes in your project. There is no per-repo config file, and no credential in
your working tree.

### Self-hosted or on-prem

Point the plugin at your own server with a fourth variable, set the same way:

```bash
setx CLOUDAEYE_URL https://your-cloudaeye-review-server
```

This one **must** be set before Claude Code starts — the plugin's MCP configuration
reads it at connect time and cannot read it from anywhere else. Anything that is not
localhost must be `https`; the skills refuse plain `http` to a remote host rather than
put your key on the wire in clear.

### If you can't set environment variables

On a machine where you can't set them — a locked-down laptop, or a shared box where
every process can read the environment — the same four values also resolve from
`~/.cloudaeye/config.json` (mode `0600`) with `api_key` / `tenant_key` / `user_name` /
`url` keys, or from `headers` on a `cloudaeye` entry you add to `~/.claude.json`
yourself. Environment wins, then `~/.claude.json`, then `~/.cloudaeye/config.json`.

Every run prints `auth_from=` naming the layer that answered, on success **and** on
failure, so a broken review never leaves you guessing whether the credential was the
problem.

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
| `cloudaeye_error=not_configured` | No API key on this machine. Set the three environment variables in [Connect your account](#connect-your-account) — and on Windows, restart Claude Code after `setx`. |
| `cloudaeye_error=auth_failed` | The server refused the key. The response body says which: unknown or expired key, a tenant the key does not belong to, or a key without the `Code Review` product. Retrying changes nothing. |
| `cloudaeye_error=insecure_url` | A remote server over plain `http`. Use `https`. |
| `cloudaeye_error=session_failed http=000` | Nothing answered at the review server — VPN, firewall, or a wrong `CLOUDAEYE_URL` if you set one. The line also prints `auth_from=`, so it tells you whether your credential resolved. |
| The `/cloudaeye:*` commands exist but the review never calls a tool | The MCP server did not connect. Restart Claude Code. If you are self-hosted, `CLOUDAEYE_URL` has to be set **before** it starts. |
| `base_source=head` in the output | The repo is not integrated with CloudAEye under your tenant, so there is no baseline branch. The review still runs, but only over working-tree edits. |

## Layout

```text
.claude-plugin/
  marketplace.json      this repo is its own single-plugin marketplace
  plugin.json
.mcp.json               server URL only — no auth headers
skills/
  <verb>/SKILL.md        invoked as /cloudaeye:<verb>
```

The MCP tools take a `session_id`, not an API key — only `POST /session` and
`POST /upload` are authenticated, and those run from the shell block inside each skill.
That is why this plugin ships no secrets and needs no configuration to install.
