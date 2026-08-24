---
name: init
description: Connect the current Git repository to CloudAEye using its detected GitHub, GitLab, or Bitbucket remote.
when_to_use: Use when the user runs /cloudaeye:init or asks to connect this repository to CloudAEye.
allowed-tools: ["mcp__plugin_cloudaeye_cloudaeye__start_session", "mcp__cloudaeye__start_session"]
---

## Steps

1. Collect the local repository metadata in one Bash call. Require one remote URL,
   a named branch, and a valid `HEAD`; never guess between multiple remotes or URLs.

   ```bash
   cd "$(git rev-parse --show-toplevel)" || { echo "cloudaeye_error=not_a_git_repo"; exit 1; }
   BRANCH=$(git branch --show-current); [ -n "$BRANCH" ] || { echo "cloudaeye_error=detached_head"; exit 1; }
   HEAD_SHA=$(git rev-parse HEAD) || { echo "cloudaeye_error=no_head"; exit 1; }
   REMOTE=$(git remote | awk '$0 == "origin" {print; exit}')
   if [ -z "$REMOTE" ]; then
     REMOTE_COUNT=$(git remote | awk 'NF {n++} END {print n+0}')
     [ "$REMOTE_COUNT" = 1 ] || { echo "cloudaeye_error=ambiguous_remote"; exit 1; }
     REMOTE=$(git remote)
   fi
   URL_COUNT=$(git remote get-url --all "$REMOTE" | awk 'NF {n++} END {print n+0}')
   [ "$URL_COUNT" = 1 ] || { echo "cloudaeye_error=ambiguous_remote_url"; exit 1; }
   REMOTE_URL=$(git remote get-url "$REMOTE") || { echo "cloudaeye_error=unsupported_remote"; exit 1; }
   REPO=$(basename -s .git "$REMOTE_URL"); [ -n "$REPO" ] || { echo "cloudaeye_error=unsupported_remote"; exit 1; }
   for c in python python3 py; do command -v "$c" >/dev/null 2>&1 && "$c" -c "" 2>/dev/null && { PY=$c; break; }; done
   [ -n "$PY" ] || { echo "cloudaeye_error=python_not_found"; exit 1; }
   "$PY" -c 'import json,sys;print(json.dumps(dict(repo=sys.argv[1],branch=sys.argv[2],head=sys.argv[3],repo_url=sys.argv[4])))' "$REPO" "$BRANCH" "$HEAD_SHA" "$REMOTE_URL"
   ```

2. Call `mcp__plugin_cloudaeye_cloudaeye__start_session` with the emitted `repo`,
   `branch`, `head`, and `repo_url`, an empty `language`, and `initialize: true`.
   OAuth owns the account and tenant; never ask for or handle credentials.

   - On a missing tool or `status: "error"`, tell the user to authenticate CloudAEye through `/mcp` and stop.
   - On `initialized: true`, `vectorization_started: true`, or an existing `target_branch`, report that the repository is initialized and stop without opening a browser.
   - On `integration_conflict` or `initialization_error`, report the error and stop.
   - Continue only when `provider_connected` is explicitly `false`.

3. Open the returned `integration_url` only for that disconnected-provider case.
   Validate it and launch it with the first available native browser command:

   ```bash
   LINK='<integration_url>'
   case "$LINK" in https://*|http://localhost/*|http://localhost:*|http://127.0.0.1/*|http://127.0.0.1:*) ;; *) echo "cloudaeye_error=insecure_integration_url"; exit 1;; esac
   if command -v open >/dev/null 2>&1; then
     open "$LINK"
   elif command -v xdg-open >/dev/null 2>&1; then
     xdg-open "$LINK"
   elif command -v powershell.exe >/dev/null 2>&1; then
     CE_LINK="$LINK" powershell.exe -NoProfile -Command 'Start-Process -LiteralPath $env:CE_LINK'
   elif command -v cmd.exe >/dev/null 2>&1; then
     cmd.exe /c start "" "$LINK"
   else
     printf 'quick_link=%s\n' "$LINK"
   fi
   ```

4. Report that repository setup was opened. Surface any `cloudaeye_error` without
   claiming setup succeeded. Never print `session_id`, `upload_token`, or other session credentials.
