#!/usr/bin/env python3
"""Find closing references ("fixes #25", "Closes: midst-press/midst-web#5") in commit messages and titles.

GitHub and Gitea both close the issue or pull request a closing reference names when the text reaches the main
branch. Our commits are written against Gitea's numbers, and on GitHub those numbers are other items: midst-web
issue 25 and midst-format PR 5 were closed that way on 12 Oct 2026 (midst-infra #14). So on the Midst repositories a
closing reference belongs only in a Gitea pull-request body, never in a commit message or a title (a Gitea merge
commit carries the title).

    closing_refs.py --message-file FILE     the commit-msg hook: one commit message, as git hands it over
    closing_refs.py --range A..B            every commit message in a range
    closing_refs.py --title-env NAME        the text in environment variable NAME (a pull-request title)
    closing_refs.py --list --range A..B     do not judge; print what push_up.sh needs to ask GitHub about

--range and --title-env may be given together. Without --list: exit 0 when nothing was found, 1 when a closing
reference was found (each is printed), 2 when the text could not be read. With --list: one line per reference that
GitHub would act on, "<commit> <owner/repo or -> <number>", exit 0, or 2 when the range could not be read.

Standard library only, so it runs wherever python3 does.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from dataclasses import dataclass

# What git writes above the diff in a `git commit -v` message file. Everything from here down is not the message.
SCISSORS = "# ------------------------ >8 ------------------------"

# A keyword must start a word ("prefixes #3" is not one). The colon and the space are both optional: flagging
# "fixes#3" costs nothing, and missing a form a forge honours closes somebody's issue.
_KEYWORD = r"(?<![A-Za-z0-9_])(?P<keyword>close[sd]?|fix(?:e[sd])?|resolve[sd]?)"
_NAME = r"[A-Za-z0-9_.-]+"
_REFERENCE = (
    rf"(?:https?://(?P<host>[^/\s]+)/(?P<url_repo>{_NAME}/{_NAME})/(?:issues|pulls?)/"
    rf"|(?P<repo>{_NAME}/{_NAME})\#"
    r"|\#"
    r"|GH-)"
    r"(?P<number>[0-9]+)"
)
CLOSING = re.compile(_KEYWORD + r":?\s*" + _REFERENCE, re.IGNORECASE)

GITHUB_HOSTS = ("github.com", "www.github.com")
RULE = (
    "On the Midst repositories a closing keyword goes only in the Gitea pull-request body. GitHub applies the one "
    "in a commit message or title to ITS issue of that number, which is a different issue. Write 'Refs #N' here."
)


@dataclass(frozen=True)
class ClosingRef:
    """One closing reference found in a text.

    Attributes:
        text: The reference as written, keyword included.
        number: The issue or pull-request number it names.
        repo: "owner/name" in lower case when the reference names a repository, else None.
        host: The host of a URL reference in lower case, else None.
    """

    text: str
    number: int
    repo: str | None
    host: str | None

    @property
    def github_acts_on_it(self) -> bool:
        """Whether GitHub would close something for this reference (a URL to another host names nothing there)."""
        return self.host is None or self.host in GITHUB_HOSTS


def find(text: str) -> list[ClosingRef]:
    """Return every closing reference in the text, in order.

    Args:
        text: A commit message or a title.

    Returns:
        The references found; empty when there are none.
    """
    found = []
    for match in CLOSING.finditer(text):
        repo = match.group("repo") or match.group("url_repo")
        host = match.group("host")
        found.append(
            ClosingRef(
                text=match.group(0),
                number=int(match.group("number")),
                repo=repo.lower() if repo else None,
                host=host.lower() if host else None,
            )
        )
    return found


def message_from_file(raw: str) -> str:
    """Return the commit message in a message file: what precedes git's scissors line.

    Comment lines are kept. Whether git strips them depends on how the commit was made, and a reference missed
    here is worse than one flagged in a comment.

    Args:
        raw: The contents of the file git passes to a commit-msg hook.

    Returns:
        The text to check.
    """
    kept = []
    for line in raw.splitlines():
        if line == SCISSORS:
            break
        kept.append(line)
    return "\n".join(kept)


def commit_messages(revision_range: str) -> list[tuple[str, str]]:
    """Return (commit, message) for every commit in a range.

    Args:
        revision_range: Anything `git rev-list` accepts, such as "origin/main..HEAD".

    Returns:
        One pair per commit, newest first.

    Raises:
        subprocess.CalledProcessError: If git could not list the range or read a message.
    """
    listed = subprocess.run(
        ["git", "rev-list", revision_range, "--"], check=True, capture_output=True, text=True
    )
    pairs = []
    for commit in listed.stdout.split():
        shown = subprocess.run(
            ["git", "log", "-1", "--format=%B", commit, "--"], check=True, capture_output=True, text=True
        )
        pairs.append((commit, shown.stdout))
    return pairs


def main(argv: list[str] | None = None) -> int:
    """Run the command line described in the module docstring.

    Args:
        argv: Arguments, without the program name. Defaults to the process arguments.

    Returns:
        The exit status.
    """
    parser = argparse.ArgumentParser(description="Find closing references in commit messages and titles.")
    parser.add_argument("--message-file")
    parser.add_argument("--range", dest="revision_range")
    parser.add_argument("--title-env")
    parser.add_argument("--list", action="store_true", dest="list_only")
    args = parser.parse_args(argv)
    if not (args.message_file or args.revision_range or args.title_env):
        parser.error("give --message-file, --range or --title-env")
    if args.list_only and (args.message_file or args.title_env or not args.revision_range):
        parser.error("--list takes --range and nothing else")

    texts: list[tuple[str, str]] = []  # (where it was found, text)
    try:
        if args.message_file:
            with open(args.message_file, encoding="utf-8", errors="replace") as handle:
                texts.append(("the commit message", message_from_file(handle.read())))
        if args.revision_range:
            for commit, message in commit_messages(args.revision_range):
                texts.append((commit[:12], message))
        if args.title_env:
            if args.title_env not in os.environ:
                print(f"closing_refs: environment variable {args.title_env} is not set", file=sys.stderr)
                return 2
            texts.append(("the title", os.environ[args.title_env]))
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"closing_refs: could not read the text to check: {error}", file=sys.stderr)
        return 2

    if args.list_only:
        for where, text in texts:
            for ref in find(text):
                if ref.github_acts_on_it:
                    print(where, ref.repo or "-", ref.number)
        return 0

    count = 0
    for where, text in texts:
        for ref in find(text):
            count += 1
            print(f"closing_refs: {where} has a closing reference: {ref.text!r}", file=sys.stderr)
    if count:
        print(f"closing_refs: {RULE}", file=sys.stderr)
        return 1
    print(f"closing_refs: {len(texts)} text(s) checked, no closing reference")
    return 0


if __name__ == "__main__":
    sys.exit(main())
