#!/usr/bin/env python3
"""Collect repository identity for the CloudAEye initialization gate."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from urllib.parse import urlsplit


class PreflightError(RuntimeError):
    pass


def _git(*args: str) -> str:
    env = os.environ.copy()
    env.update({"GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never", "GIT_ASKPASS": "echo"})
    try:
        result = subprocess.run(
            ["git", *args],
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
            env=env,
        )
    except (OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc:
        raise PreflightError("git_command_failed") from exc
    return result.stdout.strip()


def parse_remote_url(value: str) -> tuple[str, str, str]:
    raw = value.strip()
    if not raw:
        raise PreflightError("unsupported_remote")
    if "://" in raw:
        parsed = urlsplit(raw)
        host, path = parsed.hostname or "", parsed.path
        if (
            parsed.scheme.lower() not in {"http", "https", "ssh", "git"}
            or not host
            or parsed.query
            or parsed.fragment
        ):
            raise PreflightError("unsupported_remote")
    else:
        match = re.fullmatch(r"(?:[^@/]+@)?([^:/]+):(.+)", raw)
        if not match:
            raise PreflightError("unsupported_remote")
        host, path = match.groups()
    path = path.strip("/")
    if path.lower().endswith(".git"):
        path = path[:-4]
    parts = [part for part in path.split("/") if part]
    if len(parts) < 2:
        raise PreflightError("unsupported_remote")
    host = host.lower().rstrip(".")
    if host == "github.com":
        provider = "github"
    elif host == "bitbucket.org":
        provider = "bitbucket"
    elif host == "gitlab.com" or "gitlab" in host:
        provider = "gitlab"
    else:
        raise PreflightError("unsupported_provider")
    return provider, "/".join(parts), f"https://{host}/{'/'.join(parts)}"


def _remote_name() -> str:
    names = [line for line in _git("remote").splitlines() if line]
    if "origin" in names:
        return "origin"
    if len(names) == 1:
        return names[0]
    raise PreflightError("ambiguous_remote")


def _single_remote_url(remote: str) -> str:
    urls = [line for line in _git("remote", "get-url", "--all", remote).splitlines() if line]
    if len(urls) != 1:
        raise PreflightError("ambiguous_remote_url")
    return urls[0]


def _base_branch(remote: str) -> str:
    try:
        value = _git("symbolic-ref", "--quiet", "--short", f"refs/remotes/{remote}/HEAD")
        if value.startswith(f"{remote}/"):
            return value[len(remote) + 1 :]
    except PreflightError:
        pass
    try:
        output = _git("remote", "show", remote)
        match = re.search(r"^\s*HEAD branch:\s*(\S+)\s*$", output, re.MULTILINE)
        if match and not match.group(1).startswith("(") and match.group(1) != "unknown":
            return match.group(1)
    except PreflightError:
        pass
    try:
        output = _git("ls-remote", "--symref", remote, "HEAD")
        match = re.search(r"ref: refs/heads/([^\s]+)\s+HEAD", output)
        if match:
            return match.group(1)
    except PreflightError:
        pass
    return ""


def _validate_branch(remote: str, branch: str) -> None:
    try:
        _git("check-ref-format", "--branch", branch)
        if not _git("ls-remote", "--heads", remote, f"refs/heads/{branch}"):
            raise PreflightError("branch_not_found")
    except PreflightError as exc:
        if str(exc) == "branch_not_found":
            raise
        raise PreflightError("invalid_branch") from exc


def collect(branch: str = "") -> dict[str, str | bool]:
    _git("rev-parse", "--show-toplevel")
    current_branch = _git("branch", "--show-current")
    if not current_branch:
        raise PreflightError("detached_head")
    head = _git("rev-parse", "HEAD")
    remote = _remote_name()
    provider, repo_full, repo_url = parse_remote_url(_single_remote_url(remote))
    base_branch = _base_branch(remote)
    selected_branch = branch.strip()
    if selected_branch:
        _validate_branch(remote, selected_branch)
    else:
        selected_branch = base_branch
    return {
        "repo": repo_full.rsplit("/", 1)[-1],
        "repo_full": repo_full,
        "repo_url": repo_url,
        "provider": provider,
        "branch": current_branch,
        "head": head,
        "base_branch": base_branch,
        "monitor_branch": selected_branch,
        "branch_required": not bool(selected_branch),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--branch", default="")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(collect(args.branch), separators=(",", ":")))
    except PreflightError as exc:
        print(f"cloudaeye_error={exc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
