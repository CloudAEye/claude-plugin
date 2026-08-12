# CloudAEye for Claude Code

Pre-commit code review, security scanning, and task verification, as a Claude Code
plugin. CloudAEye reviews the change you have **not committed yet** — the diff against
your branch's fork point — so problems surface before they reach a PR.

> **Pre-release.** The plugin works today against a review server you can reach. The
> `@cloudaeye/cli` sign-in helper referenced below is not published yet; until it is,
> use the [manual credential setup](#option-b-set-the-credential-yourself).

## What you get

| Command | What it does |
|---|---|
| `/cloudaeye-inspect` | Bug pass — logic errors, edge cases, error handling, concurrency, dead imports. No security prompts, so it is cheap enough to run after every task. |
| `/cloudaeye-security` | Security pass — OWASP-style application security plus the LLM, AI-agent and MCP surfaces, and secrets on the changed lines. |
| `/cloudaeye-review` | Both of the above in one call. Use before opening a significant PR. |
| `/cloudaeye-describe` | A Change Description and Important Changes list, ready for a PR body or commit message. |
| `/cloudaeye-ask` | A question about the pending change, answered against the repository's code graph — callers, definitions, usage traces. |
| `/cloudaeye-check-task` | Does this diff actually do what the ticket asked? DONE / NOT DONE with a per-requirement checklist. Takes a GitHub issue URL, ticket IDs, or plain text. |
| `/cloudaeye-setup` | Diagnoses the install and prints the one next step. Never handles credentials. |

None of them edit your code. They report; you decide.

## Install

```bash
/plugin marketplace add CloudAEye/claude-code
```

```bash
/plugin install cloudaeye
```

Restart Claude Code afterwards — skills load immediately, but MCP servers connect at
startup.

If you previously hand-installed these skills into `~/.claude/skills/cloudaeye-*`,
**delete that directory**. Two copies both work, and they drift apart silently.

## Point it at your review server

The plugin's MCP server reads `CLOUDAEYE_URL` at connect time and defaults to
`http://localhost:8000`. Export it in your shell profile, so it is set **before**
Claude Code starts:

```bash
export CLOUDAEYE_URL=https://your-cloudaeye-review-server
```

Anything that is not localhost must be `https`. The skills refuse plain `http` to a
remote host rather than put your API key on the wire in clear.

## Connect your account

Reviews need one credential: a CloudAEye **product API key** carrying the `Code Review`
product, plus the tenant key it belongs to.

### Option A — the CLI (once published)

1. Create an account at <https://console.cloudaeye.com/signup>.
2. In **your own terminal** — not through Claude:

   ```bash
   npx @cloudaeye/cli login
   ```

   It prompts for your email and password, mints an API key for this machine, and
   writes `~/.cloudaeye/config.json`. The password is used once and discarded; nothing
   is copy-pasted.
3. Back in Claude Code, run `/cloudaeye-review`.

The CLI refuses to run without a TTY. That is deliberate: it means an agent cannot run
it, so your password never lands in a transcript.

### Option B — set the credential yourself

Either export it:

```bash
export CLOUDAEYE_API_KEY=your-product-api-key
export CLOUDAEYE_TENANT_KEY=92
export CLOUDAEYE_USER_NAME=your-name
```

…or write `~/.cloudaeye/config.json` (mode `0600`):

```json
{
  "api_key": "your-product-api-key",
  "tenant_key": "92",
  "user_name": "your-name",
  "url": "https://your-cloudaeye-review-server"
}
```

Environment wins, then the `cloudaeye` entry in `~/.claude.json`, then
`~/.cloudaeye/config.json`. Every run prints `auth_from=` naming the layer that
answered. Use the environment layer in CI.

Nothing goes in your project. There is no per-repo config file to add, and no
credential in your working tree.

## What actually leaves your machine

Worth knowing before you point this at a private repo:

- **The diff is uploaded.** Each run captures `git diff` against the baseline and
  `POST`s it to your review server, which stages the post-edit file contents and runs
  the review there. Untracked files are included — they are marked with
  `git add --intent-to-add` so they appear in the diff.
- The scratch directory `.cloudaeye/` is created in your repo and gitignores itself on
  every run.
- The API key travels in an `X-Product-API-Key` header, and reaches `curl` through a
  config file rather than the command line, so it stays out of the process table.
- The `git add --intent-to-add` is non-destructive: it records paths in the index
  without staging content. Undo with `git reset`.

## Make it automatic

Paste into your project's `CLAUDE.md` if you want the coding agent to review its own
work before reporting done:

```markdown
## Code review policy (cloudaeye)

After completing any coding task, before reporting done:

1. Run `/cloudaeye-inspect` (bug pass — no security prompts)
2. Surface the findings to the user. Don't auto-fix unless asked.

If the change touches auth, untrusted input, deserialization, secrets, crypto, LLM
prompts, tool definitions, or agent orchestration — suggest `/cloudaeye-security`
after reporting the inspect findings. Don't run it uninvited.
```

## Troubleshooting

Run `/cloudaeye-setup` first — it checks all of this and prints the one thing to fix.

| Symptom | Cause and fix |
|---|---|
| `/plugin marketplace add` fails on a corporate laptop | The `owner/repo` shorthand clones over SSH. Set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` and retry. |
| `/plugin install cloudaeye` reports the plugin is not found | The marketplace step above hasn't run, or the catalog is stale — `/plugin marketplace update cloudaeye`, then retry. To be explicit about which catalog it comes from, use the fully qualified `/plugin install cloudaeye@cloudaeye`. |
| `cloudaeye_error=not_configured` | No API key on this machine. See [Connect your account](#connect-your-account). |
| `cloudaeye_error=auth_failed` | The server refused the key. The response body says which: unknown or expired key, a tenant the key does not belong to, or a key without the `Code Review` product. Retrying changes nothing. |
| `cloudaeye_error=insecure_url` | A remote server over plain `http`. Use `https`. |
| `cloudaeye_error=session_failed http=000` | Nothing answered at `CLOUDAEYE_URL` — server down, wrong URL, or VPN. |
| The `/cloudaeye-*` commands exist but the review never calls a tool | The MCP server did not connect. `CLOUDAEYE_URL` has to be set before Claude Code starts; export it and restart. |
| `base_source=head` in the output | The repo is not integrated with CloudAEye under your tenant, so there is no baseline branch. The review still runs, but only over working-tree edits. |

## Layout

```text
.claude-plugin/
  marketplace.json      this repo is its own single-plugin marketplace
  plugin.json
.mcp.json               server URL only — no auth headers
skills/
  cloudaeye-<verb>/SKILL.md
```

The MCP tools take a `session_id`, not an API key — only `POST /session` and
`POST /upload` are authenticated, and those run from the shell block inside each skill.
That is why this plugin ships no secrets and needs no configuration to install.
