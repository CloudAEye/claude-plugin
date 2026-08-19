#!/bin/sh
# Bridge the plugin's userConfig values to a file the skills can read.
#
# Claude Code prompts for these at install time and exports them as
# CLAUDE_PLUGIN_OPTION_* to hook processes and to MCP/LSP subprocesses. A skill's
# bootstrap block is neither -- it runs through the Bash tool -- so the values may
# not be visible where they are actually needed. This hook runs in a process that
# definitely has them and writes them where the bootstrap block can read them.
#
# If CLAUDE_PLUGIN_OPTION_* turns out to reach Bash tool calls directly, the
# bootstrap block reports auth_from=plugin instead of auth_from=pdata, and this
# hook and its `pdata` layer can both be deleted.
#
# Deliberately cheap and idempotent: it compares before writing, so the steady
# state is one read per session. Runs on every SessionStart, so it must stay that
# way. Exits 0 on every path -- a setup helper must never break a session.
set -eu

[ -n "${CLAUDE_PLUGIN_OPTION_API_KEY:-}" ] || exit 0
[ -n "${CLAUDE_PLUGIN_DATA:-}" ] || exit 0

# python3 on Windows is often an alias stub, python is absent on many Linux
# images: pick one that actually runs rather than guessing. Same probe the
# skills use.
PY=""
for c in python python3 py; do
  command -v "$c" >/dev/null 2>&1 && "$c" -c "" 2>/dev/null && { PY=$c; break; }
done
[ -n "$PY" ] || exit 0

# Python does the JSON encoding: a user_name containing a quote or a backslash
# would corrupt a printf-built file, and the skills parse this with json.load.
"$PY" - <<'PY' || exit 0
import json, os

data_dir = os.environ["CLAUDE_PLUGIN_DATA"]
out = os.path.join(data_dir, "cloudaeye-creds.json")
cfg = {
    "api_key":    os.environ.get("CLAUDE_PLUGIN_OPTION_API_KEY", ""),
    "tenant_key": os.environ.get("CLAUDE_PLUGIN_OPTION_TENANT_KEY", ""),
    "user_name":  os.environ.get("CLAUDE_PLUGIN_OPTION_USER_NAME", ""),
    "url":        os.environ.get("CLAUDE_PLUGIN_OPTION_URL", ""),
}

try:
    with open(out, encoding="utf-8") as f:
        if json.load(f) == cfg:
            raise SystemExit(0)          # unchanged -- no write
except SystemExit:
    raise
except Exception:
    pass                                 # missing or unreadable -- rewrite it

os.makedirs(data_dir, exist_ok=True)
tmp = out + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(cfg, f)
try:
    os.chmod(tmp, 0o600)                 # no-op on Windows, matters elsewhere
except OSError:
    pass
os.replace(tmp, out)                     # atomic: no torn read by a concurrent session
PY
