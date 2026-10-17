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
    closing_refs.py --body-env NAME         the text in environment variable NAME (a pull-request description)
    closing_refs.py --list --range A..B     do not judge; print what push_up.sh needs to ask GitHub about
    closing_refs.py --list-github --range A..B   do not judge; print the GitHub issues the commits name

--range, --title-env and --body-env may be given together. Without --list or --list-github: exit 0 when nothing
was found, 1 when a closing reference was found (each is printed), 2 when the text could not be read. With --list:
one line per reference that GitHub would act on, "<commit> <owner/repo or -> <number>". With --list-github: the
issues written as "GitHub #12" in the commits' subject lines, one "refs <number>" or "completes <number>" line
each, each issue once, ascending. Both list modes exit 0 whether
or not they print anything, so neither is a gate; 2 when the range could not be read.

--body-env is for GitHub, where an issue must stay open after a merge until someone has checked the fix in a
release, so a closing keyword is refused in the description too. On Gitea the description is where it belongs.

"GitHub #12" is how a Gitea pull request names the GitHub issue it serves, in its title: "... (GitHub #12)" or
"(GitHub #12, #14)". The Gitea merge commit carries the title, so push_up.sh can read it with git alone. Only
the subject line of a commit is read, because a body may mention an issue it does not serve ("see GitHub #12
for the upstream report"), and a revert is skipped, because it names the issue it un-fixes.

A revert in the range also takes back the commit it reverts, when that commit is in the range too: the code going
up no longer has that change, so the issues its subject names are not listed (midst-infra #29). The two are
matched on the subject the revert quotes, which is how git and Gitea write one: Revert "<subject>", with or
without Gitea's "Merge pull request '...' (#N) from ..." around either. For each subject the newest commit
decides: a revert takes back every older commit with that subject, and the change landing again after it (the
same subject, a Reapply "<subject>", or a revert of the revert) brings them back. Each commit taken back is named
on stderr.

What this does not see. The match is on subjects, so a revert takes back only commits with the subject it quotes.
When the issue is named only in a pull request's title, only the merge commit names it: reverting the merge, or a
revert whose title quotes that title, takes it back, but a revert of the commit inside the pull request
(Revert "<that commit's subject>") does not, and the merge still says "completes" (midst-infra #34). A revert
whose subject quotes nothing ("Revert the save change") takes back nothing. And a revert that goes up in a later
push-up than its fix is not seen at all: by then the issue is marked, and undoing that is a person's act.

A requirement often takes several pull requests, so naming an issue does not say it is done. The one that
finishes it says so: "(completes GitHub #12)". That is "completes <number>" in the list, and it is the only thing
that later marks the issue as fixed. "Completes" is not a closing keyword on GitHub or on Gitea. An issue both
named and completed in one range is listed as completed.

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

# "GitHub #12", "GitHub #12, #14", "GitHub #12 and #14": the GitHub issues a commit serves. With "completes" in
# front, the ones it finishes.
GITHUB_ISSUES = re.compile(
    r"(?<![A-Za-z0-9_])(?P<completes>completes[ \t]+)?"
    r"GitHub[ \t]+#[0-9]+(?:(?:[ \t]*,[ \t]*|[ \t]+and[ \t]+)#[0-9]+)*",
    re.IGNORECASE,
)
# A revert, or the Gitea merge of a pull request whose title is one: Revert "...", Merge pull request 'Revert ...
REVERT = re.compile(r"(?:Merge pull request ['\"])?Revert\b", re.IGNORECASE)
# The wrappers around the subject a revert quotes. Gitea's merge commit, around a pull request's title:
GITEA_MERGE = re.compile(r"Merge pull request (?P<quote>['\"])(?P<inner>.*)(?P=quote) \(#[0-9]+\) from \S+ into \S+")
# git's own subject for a revert, and for the revert of a revert (git 2.43 and later write Reapply for that):
QUOTED_REVERT = re.compile(r'Revert "(?P<inner>.*)"', re.IGNORECASE)
QUOTED_REAPPLY = re.compile(r'Reapply "(?P<inner>.*)"', re.IGNORECASE)

GITHUB_HOSTS = ("github.com", "www.github.com")
RULE = (
    "On the Midst repositories a closing keyword goes only in the Gitea pull-request body. GitHub applies the one "
    "in a commit message or title to ITS issue of that number, which is a different issue. Write 'Refs #N' here."
)
GITHUB_RULE = (
    "An issue here is closed by whoever checks the fix in a release, not by the merge. Write 'Refs #N' in the "
    "title, the description and the commit messages."
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


def github_issue_numbers(text: str) -> list[int]:
    """Return the GitHub issue numbers a text names as "GitHub #N", in the order written.

    Args:
        text: A commit message or a title.

    Returns:
        The numbers; empty when the text names none. A number written twice appears twice.
    """
    numbers = []
    for match in GITHUB_ISSUES.finditer(text):
        numbers.extend(int(number) for number in re.findall(r"#([0-9]+)", match.group(0)))
    return numbers


def github_issues_served(message: str) -> list[tuple[int, bool]]:
    """Return the GitHub issues a commit serves: those named in its subject line, unless it is a revert.

    Args:
        message: A whole commit message.

    Returns:
        (number, whether the commit completes it), in the order written; empty for a revert, and for a subject
        that names none.
    """
    subject = message.split("\n", 1)[0]
    if REVERT.match(subject):
        return []
    served = []
    for match in GITHUB_ISSUES.finditer(subject):
        completes = match.group("completes") is not None
        served.extend((int(number), completes) for number in re.findall(r"#([0-9]+)", match.group(0)))
    return served


def unwrapped(subject: str) -> tuple[str, int]:
    """Return the subject at the centre of a commit's subject line, and how many reverts are around it.

    Args:
        subject: A commit's subject line.

    Returns:
        (the innermost subject, the number of Revert "..." wrappers around it). Gitea's merge wrapper and git's
        Reapply "..." are taken off without counting: neither undoes anything. A subject with no wrapper is
        returned as it is, with 0.
    """
    text, reverts = subject.strip(), 0
    while True:
        merge = GITEA_MERGE.fullmatch(text) or QUOTED_REAPPLY.fullmatch(text)
        if merge:
            text = merge.group("inner").strip()
            continue
        revert = QUOTED_REVERT.fullmatch(text)
        if revert:
            text, reverts = revert.group("inner").strip(), reverts + 1
            continue
        return text, reverts


def taken_back(subjects: list[str]) -> set[int]:
    """Return which commits a later revert in the same list takes back.

    Args:
        subjects: The subject lines of the commits in a range, newest first, a commit always before its parents.

    Returns:
        The positions of the commits that are not reverts and whose subject the newest commit of that subject
        reverts. Reverts themselves are never in the set: they serve nothing already.
    """
    reverted: dict[str, bool] = {}  # innermost subject -> whether its newest commit is a revert
    gone = set()
    for position, subject in enumerate(subjects):
        inner, reverts = unwrapped(subject)
        if inner not in reverted:
            reverted[inner] = reverts % 2 == 1
        if reverts == 0 and reverted[inner]:
            gone.add(position)
    return gone


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
        One pair per commit, newest first, and a commit always before its parents (a revert before what it
        reverts), whatever the commits' dates say.

    Raises:
        subprocess.CalledProcessError: If git could not list the range or read a message.
    """
    listed = subprocess.run(
        ["git", "rev-list", "--topo-order", revision_range, "--"], check=True, capture_output=True, text=True
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
    parser.add_argument("--body-env")
    parser.add_argument("--list", action="store_true", dest="list_only")
    parser.add_argument("--list-github", action="store_true")
    args = parser.parse_args(argv)
    if not (args.message_file or args.revision_range or args.title_env or args.body_env):
        parser.error("give --message-file, --range, --title-env or --body-env")
    listing = args.list_only or args.list_github
    if listing and (args.message_file or args.title_env or args.body_env or not args.revision_range):
        parser.error("--list and --list-github take --range and nothing else")
    if args.list_only and args.list_github:
        parser.error("--list and --list-github are separate questions; ask one")

    texts: list[tuple[str, str]] = []  # (where it was found, text)
    try:
        if args.message_file:
            with open(args.message_file, encoding="utf-8", errors="replace") as handle:
                texts.append(("the commit message", message_from_file(handle.read())))
        if args.revision_range:
            for commit, message in commit_messages(args.revision_range):
                texts.append((commit[:12], message))
        for name, where in ((args.title_env, "the title"), (args.body_env, "the description")):
            if not name:
                continue
            if name not in os.environ:
                print(f"closing_refs: environment variable {name} is not set", file=sys.stderr)
                return 2
            texts.append((where, os.environ[name]))
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"closing_refs: could not read the text to check: {error}", file=sys.stderr)
        return 2

    if args.list_only:
        for where, text in texts:
            for ref in find(text):
                if ref.github_acts_on_it:
                    print(where, ref.repo or "-", ref.number)
        return 0

    if args.list_github:
        completed: dict[int, bool] = {}
        gone = taken_back([text.split("\n", 1)[0] for _, text in texts])
        for position, (where, text) in enumerate(texts):
            if position in gone:
                if github_issues_served(text):
                    print(
                        f"closing_refs: {where} is reverted later in this range; the issues it names are not listed",
                        file=sys.stderr,
                    )
                continue
            for number, completes in github_issues_served(text):
                completed[number] = completed.get(number, False) or completes
        for number in sorted(completed):
            print("completes" if completed[number] else "refs", number)
        return 0

    count = 0
    for where, text in texts:
        for ref in find(text):
            count += 1
            print(f"closing_refs: {where} has a closing reference: {ref.text!r}", file=sys.stderr)
    if count:
        print(f"closing_refs: {GITHUB_RULE if args.body_env else RULE}", file=sys.stderr)
        return 1
    print(f"closing_refs: {len(texts)} text(s) checked, no closing reference")
    return 0


if __name__ == "__main__":
    sys.exit(main())
