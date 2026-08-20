---
name: init
description: Finish CloudAEye setup on this machine — fetches your API key and tenant from the review server once you are signed in, stores them outside every git repository, and confirms by opening a real review session. Run once per machine; it needs no key, no tenant number and nothing pasted.
when_to_use: Use when the user runs /cloudaeye:init, asks how to set up or sign in to CloudAEye, or when another CloudAEye skill stopped with cloudaeye_error=not_configured or cloudaeye_error=auth_failed.
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__get_credentials", "mcp__cloudaeye__get_credentials"]
---

## What this does

Sign-in itself is not yours to run and not the user's to configure. Claude Code does it:
the review server refuses an unauthenticated connection and points at the CloudAEye
console, Claude Code opens the browser, and the token lands in its own credential store.
**That has to have happened before this skill can do anything.**

This skill is the step after. It asks the review server for the developer's API key and
tenant — the server already knows whose, because the request carries their token — and
stores them where the review skills read them.

Never ask the user for an API key, a tenant number, a password or an email. If this
skill cannot get what it needs, the answer is always to send them through the browser
flow, never to collect a credential in the chat.

## Steps

1. **Check the tool is there.** If CloudAEye's `get_credentials` tool is not available,
   the server is not authenticated yet — Claude Code lists it as **Needs
   authentication** and exposes none of its tools. Stop and tell the user exactly this,
   then wait:

   > CloudAEye isn't signed in on this machine yet. Run `/mcp`, select **CloudAEye**,
   > choose **Authenticate**, and sign in (or create an account) in the browser tab that
   > opens. Then run `/cloudaeye:init` again.

   Do not work around it. There is no key to ask for, no file to hand-write, and no
   other command that helps — everything downstream needs the token that flow produces.

   **The reverse does not hold, so do not say it.** The tool being present does not
   mean anyone is signed in: where the server has sign-in switched off it exposes every
   tool to every caller, and that is the normal state until the CloudAEye console's
   endpoints go live. Only step 2's answer tells you whether there is an identity
   behind this call. Announcing "the tool is available, so CloudAEye is authenticated"
   is wrong and contradicts the refusal you are about to read out.

2. **Run the setup block below with `CE_CODE` and `CE_CLAIM_URL` left empty.**

   This is a probe. On a machine that is already set up it does the whole job —
   confirms the credentials work, checks whether *this repository* is connected, and
   opens the browser if it is not. Most re-runs of `init` end here, having fetched
   nothing.

   Read the output:

   - **`setup=absent`** — no credentials on this machine. Go to step 3.
   - **anything else** — already set up. Skip steps 3 and 4 entirely and report
     (step 5). Do not fetch a credential nobody needs.

   ```bash
   export CE_CODE='' CE_CLAIM_URL=''   # step 2 leaves these empty; step 4 fills them in
   for c in python python3 py; do command -v $c >/dev/null 2>&1 && $c -c "" 2>/dev/null && { PY=$c; break; }; done
   [ -n "$PY" ] || { echo "cloudaeye_error=python_not_found"; exit 1; }
   cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 1
   # One quoted heredoc, one program. The delimiter is quoted, so the shell
   # substitutes NOTHING inside: no nested quoting to get wrong, nothing for a
   # $ or a backtick to do. An earlier version orchestrated five separate
   # `python -c "..."` calls from shell and could not be reproduced verbatim —
   # it came back with lines merged and died on an unmatched quote.
   "$PY" - <<'CLOUDAEYE_INIT'
import glob, json, os, re, subprocess, sys, urllib.error, urllib.request, webbrowser

CODE = os.environ.get("CE_CODE", "").strip()
CLAIM_URL = os.environ.get("CE_CLAIM_URL", "").strip()
HOME = os.path.expanduser("~")


def say(line):
    print(line, flush=True)


def load(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return {}


# The plugin's own data directory: outside every git repository, so it cannot be
# committed or shipped in a diff. CLAUDE_PLUGIN_DATA names it when Claude Code
# exports it, which it does not do for every process kind - so fall back to
# wherever a creds file already lives, then a cloudaeye* directory, then create
# one. All are matched by the glob the review skills read, and they take the
# newest file, so this write wins wherever it lands.
data = os.environ.get("CLAUDE_PLUGIN_DATA") or ""
if not data:
    base = os.path.join(HOME, ".claude", "plugins", "data")
    found = sorted(glob.glob(os.path.join(base, "*", "cloudaeye-creds.json")))
    if found:
        data = os.path.dirname(found[0])
    else:
        dirs = sorted(glob.glob(os.path.join(base, "cloudaeye*")))
        data = dirs[0] if dirs else os.path.join(base, "cloudaeye")
os.makedirs(data, exist_ok=True)
creds_path = os.path.join(data, "cloudaeye-creds.json")

# --- redeem, only when a code was supplied --------------------------------
# The key is parsed and written inside this process: never a shell variable,
# never an argument, never on a command line. Nothing here prints it.
if CODE:
    try:
        request = urllib.request.Request(
            CLAIM_URL,
            data=json.dumps({"code": CODE}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            fetched = json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code == 403:
            say("cloudaeye_error=claim_rejected http=403 - that setup code was "
                "already used or has expired; run /cloudaeye:init again")
        else:
            say("cloudaeye_error=claim_failed http=%d" % exc.code)
        raise SystemExit(1)
    except Exception as exc:
        say("cloudaeye_error=claim_failed %s" % type(exc).__name__)
        raise SystemExit(1)
    # Validate before it becomes the live file: a truncated body must not
    # replace working credentials with something that fails much later.
    if not str(fetched.get("api_key", "")).strip() or not str(fetched.get("tenant_key", "")).strip():
        say("cloudaeye_error=claim_incomplete")
        raise SystemExit(1)
    tmp = creds_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(fetched, handle)
    try:
        os.chmod(tmp, 0o600)          # no-op on Windows, matters elsewhere
    except OSError:
        pass
    os.replace(tmp, creds_path)       # atomic: no torn read by a concurrent session
    say("stored=" + creds_path)

# --- resolve credentials exactly as the review skills do ------------------
claude_json = load(os.path.join(HOME, ".claude.json"))


def server_entry(document):
    return ((document or {}).get("mcpServers") or {}).get("cloudaeye") or {}


entry = server_entry((claude_json.get("projects") or {}).get(os.getcwd())) or server_entry(claude_json)
headers = entry.get("headers") or {}
env = os.environ.get
pdata_files = glob.glob(os.path.join(HOME, ".claude", "plugins", "data", "*", "cloudaeye-creds.json"))
newest = max(pdata_files, key=os.path.getmtime) if pdata_files else ""

layers = [
    ("env", {"api_key": env("CLOUDAEYE_API_KEY"), "tenant_key": env("CLOUDAEYE_TENANT_KEY"),
             "user_name": env("CLOUDAEYE_USER_NAME"), "url": env("CLOUDAEYE_URL")}),
    ("plugin", {field: env("CLAUDE_PLUGIN_OPTION_" + field.upper())
                for field in ("api_key", "tenant_key", "user_name", "url")}),
    ("pdata", load(newest)),
    ("claude", {"api_key": headers.get("X-Product-API-Key"),
                "tenant_key": headers.get("X-Tenant-Key"),
                "user_name": headers.get("X-User-Name"),
                "url": str(entry.get("url") or "").rstrip("/")}),
]


def resolve(field):
    for name, layer in layers:
        value = str((layer or {}).get(field) or "").strip()
        if value:
            return value, name
    return "", "none"


api_key, origin = resolve("api_key")
if not re.fullmatch(r"[A-Za-z0-9._-]{8,128}", api_key or ""):
    api_key, origin = "", "none"
tenant_key = resolve("tenant_key")[0]
user_name = resolve("user_name")[0]
base_url = resolve("url")[0] or "https://api.cloudaeye.com/mcp"

if not CODE and origin == "none":
    # Expected on a first run: nothing is set up yet, so step 3 fetches a code.
    say("setup=absent")
    raise SystemExit(0)

# The key travels in a header, so anything off-box must be https or it crosses
# the network in clear. Localhost has no hop to sniff.
if not re.match(r"^(https://|http://localhost|http://127\.0\.0\.1)", base_url):
    say("cloudaeye_error=insecure_url url=%s auth_from=%s" % (base_url, origin))
    raise SystemExit(1)

# Reported separately from auth_from: a higher layer (an exported key, or one in
# the plugin's settings) shadows the file just written, so the session below can
# succeed on somebody else's credential and say nothing about whether THIS run
# worked. That is the one way "setup complete" could be a lie.
pdata_ok = "1" if str((load(newest) or {}).get("api_key") or "").strip() else "0"
if pdata_ok != "1":
    say("cloudaeye_error=not_readable_back url=%s" % base_url)
    raise SystemExit(1)


# --- prove it, by opening a real review session ---------------------------
def git(*args):
    try:
        return subprocess.run(("git",) + args, capture_output=True, text=True,
                              timeout=15).stdout.strip()
    except Exception:
        return ""


if not git("rev-parse", "--show-toplevel"):
    say("verify=skipped reason=not_a_git_repo auth_from=%s" % origin)
    raise SystemExit(0)

remote = git("config", "--get", "remote.origin.url")
repo = re.sub(r"\.git$", "", remote.rsplit("/", 1)[-1]) if remote else os.path.basename(os.getcwd())
payload = {"repo": repo, "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
           "head": git("rev-parse", "HEAD"), "language": "",
           "tenant_key": tenant_key, "user_name": user_name}

session = {}
try:
    request = urllib.request.Request(
        base_url.rstrip("/") + "/session",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-Product-API-Key": api_key},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        status = response.status
        session = json.load(response)
except urllib.error.HTTPError as exc:
    status = exc.code
except Exception:
    status = 0
say("verify_http=%s stored_resolves=%s auth_from=%s url=%s" % (status, pdata_ok, origin, base_url))

# --- is THIS repository connected? ----------------------------------------
# The server answers it on every session and supplies the link; the client
# never builds a CloudAEye URL of its own.
link = ""
if session.get("target_branch_error"):
    state, link = "no", (session.get("integration_url") or "")
elif session.get("target_branch"):
    state = "yes"
else:
    state = "unknown"
say("integrated=%s%s" % (state, (" link=" + link) if link else ""))

if state == "no" and link:
    # webbrowser handles every platform and sidesteps the MSYS trap where
    # `cmd.exe /c ...` arrives as `cmd.exe C:/ ...` and opens nothing at all.
    # browser_open reports what actually happened: whether a tab appeared is the
    # one thing the calling agent cannot observe for itself.
    try:
        say("browser_open=%s" % ("yes" if webbrowser.open(link) else "no"))
    except Exception:
        say("browser_open=no")
CLOUDAEYE_INIT
   ```

3. **Only if `setup=absent`: call CloudAEye's `get_credentials` MCP tool.** It takes no arguments, on purpose:
   the account and organisation come from the token, so there is nothing to point at
   somebody else.

   Its full name depends on how CloudAEye was installed —
   `mcp__plugin_cloudaeye_cloudaeye__get_credentials` from the plugin marketplace,
   `mcp__cloudaeye__get_credentials` if the server was registered by hand with
   `claude mcp add`. Both are pre-approved in this skill's frontmatter, so use whichever
   one is in your tool list and don't ask for permission first.

   - `"status": "error"` — report the `error` string to the user verbatim and stop. It
     is written for them and says whether to retry, re-authenticate, or report it.
     Two you will see while the console side is still being built: *"this review server
     does not have sign-in configured"* (the server has not enabled it yet — nothing
     the user can fix), and *"not signed in"* (go back to step 1).

     On that first one, add one line about what is **not** broken: if a key is already
     resolving on this machine, the review commands keep working, because they
     authenticate to `/session` with the product API key and never needed a sign-in
     token. Only `init` is blocked. Say it — otherwise a failed setup reads as
     "CloudAEye is down" when nothing of theirs is.
   - `"status": "ok"` — carry `claim_code` and `claim_url` into step 4.

   **There is no API key in that response, and that is deliberate.** A tool result is
   part of this conversation, and Claude Code writes conversations to disk — so a key
   returned here would land in a transcript every time anyone runs setup. Instead you
   get a **single-use code, valid for two minutes**, which step 3 exchanges for the real
   credentials directly into a file. You never see the key, so you cannot leak it.

   Spend the code promptly — run step 3 as your next action, not after other work.

4. **Re-run the exact same block from step 2**, with the two values filled in:

   ```bash
   export CE_CODE='<claim_code>' CE_CLAIM_URL='<claim_url>'
   ```

   …and every other line unchanged. This time it redeems the code into the config file
   before doing the same verification and integration check.

5. **Report the outcome.** Read the printed lines; do not re-derive any of it.

   | output | what it means |
   |---|---|
   | `stored=<path>` | Where the credentials went. Worth showing the user — it is the file to delete if they ever want to sign out on this machine. |
   | `verify_http=200` | Setup is complete and proven: a real review session opened. Say so plainly. |
   | `verify=skipped reason=not_a_git_repo` | Credentials are stored, but nothing was proven. Tell the user to run `/cloudaeye:inspect` inside a repository to confirm. |
   | `cloudaeye_error=not_readable_back` | The file was written but the review skills cannot see it. **Do not call setup complete.** Report the `stored=` path and that it did not resolve — this is a bug worth reporting, not something the user can fix. |
   | `auth_from=` not `pdata` | Setup worked, but a higher layer is in charge: `env` means a `CLOUDAEYE_API_KEY` is exported in this shell, `plugin` means a key is set in the plugin's own settings. Both override the file this skill just wrote. Say which one is winning in a single line — if the user came here because reviews were failing, that layer is the thing to fix, and `init` will not have changed anything they can see. |
   | `verify_http=` 401/403 | The key the server just issued was refused by the server. Report it as a server-side problem, not a user one. |
   | `verify_http=` anything else | The server did not answer. Credentials are stored; the review server may be down. Retrying later is reasonable. |
   | `setup=absent` | No credentials on this machine — this is step 2 telling you to go to step 3, not an error. |
   | `integrated=yes` | This repository is connected: reviews get the real baseline and the code-context graph. Nothing to say beyond confirming it. |
   | `integrated=no link=<url>` | The tenant is fine but **this repository is not connected**. Give them the link and say what it is for: installing the CloudAEye GitHub App and selecting this repository. Reviews still work meanwhile, against local `HEAD`, with no baseline branch and no code graph, so this is "worth doing", not "must do first". |
   | `browser_open=yes` | A tab was opened at that link. Only say a browser opened if you see this line — **it is the one fact you cannot infer.** Claiming a tab opened when none did sends the user looking for a window that is not there. |
   | `browser_open=no` | No handler, or the launch failed. Say nothing about browsers; just give them the link to open themselves. Nothing else is wrong. |
   | `integrated=unknown` | The session response had neither field — usually an older server. Ignore it rather than guessing. |

   Then tell them what they can run — **all six, with a few words each on when**.
   This is the only moment the plugin gets to tell someone what it does, so a
   name they never see here is a command they never run:

   - `/cloudaeye:inspect` — bug pass, cheap enough for after every coding task
   - `/cloudaeye:security` — security pass: OWASP, LLM/agent surfaces, leaked secrets
   - `/cloudaeye:review` — both of the above, before a significant PR
   - `/cloudaeye:describe` — a PR description or commit message for the pending diff
   - `/cloudaeye:ask` — a question about the change, answered against the code graph
   - `/cloudaeye:check-task` — does this diff actually do what the ticket asked?

   **Never print the API key** in the summary, whole or partial.

## Notes

- **Once per machine, not once per repository.** The credentials live in the plugin's
  data directory, so every repository on the machine is covered. Re-running is safe and
  idempotent — it re-fetches the same key and rewrites the same file, which is also the
  right first move if a review starts failing with `auth_failed`.
- **This skill never mints anything.** The console owns key lifecycle; the review server
  asks it on the user's behalf. So a key revoked in the console is revoked everywhere,
  and re-running `init` is what picks up the replacement.
- **Signing out** means removing the `stored=` file and disconnecting CloudAEye in
  `/mcp`. Uninstalling the plugin removes the file too, unless they pass `--keep-data`.
- If the user already has a key from the console and wants to use it directly, they do
  not need this skill at all — the plugin's own settings (`/plugin`) take an API key and
  tenant, and the `CLOUDAEYE_*` environment variables still work for CI and on-prem.
