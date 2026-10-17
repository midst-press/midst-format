#!/usr/bin/env python3
"""Refuse a push that would rewrite a branch the remote already has: the early, friendly refusal.

Run by pre-commit at the pre-push stage. The guarantee is on the server (Gitea refusing non-fast-forward
updates for every branch); this only says so before anything is sent, and says what to do instead.

A push is refused when the branch already exists on the remote and its tip there is not an ancestor of what is
being pushed: a rebase, an amended commit, a reset, or commits on the remote that this clone has never fetched.
A new branch is allowed. The tip is asked of the remote itself (git ls-remote), not taken from pre-commit, which
leaves out the remote's commit when this clone does not have it, and that is exactly the case to refuse.

Limits, all covered by the server and not here: pre-commit hands over only the first branch of a push that names
several, it never runs this for a deletion, and `git push --no-verify` skips it.

Usage (pre-commit sets these): PRE_COMMIT_REMOTE_NAME, PRE_COMMIT_REMOTE_BRANCH, PRE_COMMIT_TO_REF.
Exit 0 allowed, 1 refused or could not tell.

refuse_force_push.py --installed, run on every commit: fails until this clone has the pre-push hook. A clone set
up before the hook existed has only pre-commit and commit-msg, and nothing else would tell it. Skipped when CI is
set, since CI installs no hooks.
"""

import os
import subprocess
import sys

ADVICE = (
    "Pushed branches are never rewritten here. Instead of rebasing, merge the base in "
    "(git fetch && git merge origin/main), and instead of amending, add a commit."
)


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True)


def with_git_text(message, result):
    """The message, followed by git's own words when it said any."""
    text = result.stderr.strip()
    return f"{message}\ngit said: {text}" if text else message


def check(remote, branch, pushed):
    """None when the push may go ahead, otherwise why it may not."""
    asked = git("ls-remote", "--exit-code", remote, branch)
    if asked.returncode == 2:  # the remote answered, and has no such branch: a new branch
        return None
    if asked.returncode != 0:
        return with_git_text(
            f"could not ask {remote} for {branch}, so cannot tell whether this push rewrites it.", asked
        )
    tips = [line.split("\t", 1)[0] for line in asked.stdout.splitlines() if line.endswith(f"\t{branch}")]
    if not tips:
        # Exit 0 means the remote named a ref, but ls-remote matches the END of ref names, so it was another one.
        lines = asked.stdout.strip() or "(nothing)"
        return f"could not tell whether {remote} has {branch}: ls-remote matched only other refs:\n{lines}"
    tip = tips[0]
    have = git("cat-file", "-e", f"{tip}^{{commit}}")
    if have.returncode != 0:
        return with_git_text(
            f"{branch} on {remote} has commits this clone has not fetched; pushing would discard them.", have
        )
    ancestor = git("merge-base", "--is-ancestor", tip, pushed)
    if ancestor.returncode == 1:
        return f"{branch} on {remote} is not an ancestor of what is being pushed; pushing would rewrite it."
    if ancestor.returncode != 0:
        return with_git_text(f"could not tell whether this push rewrites {branch} on {remote}.", ancestor)
    return None


INSTALL = "Run `pre-commit install` in this clone to add it (or `pre-commit install -t pre-push`)."


def installed():
    """None when this clone's pre-push hook is pre-commit's, otherwise why not."""
    where = git("rev-parse", "--git-path", "hooks/pre-push")
    if where.returncode != 0:
        return with_git_text("could not find this clone's hooks directory.", where)
    try:
        with open(where.stdout.strip(), encoding="utf-8", errors="replace") as hook:
            if "pre-commit" in hook.read():
                return None
    except FileNotFoundError:
        return f"this clone has no pre-push hook. {INSTALL}"
    except OSError as error:
        return f"could not read this clone's pre-push hook ({error}). {INSTALL}"
    return f"this clone's pre-push hook is not pre-commit's. {INSTALL}"


def main():
    if sys.argv[1:] == ["--installed"]:
        if os.environ.get("CI"):
            return 0
        problem = installed()
        if problem:
            print(f"Pre-push hook missing: {problem}", file=sys.stderr)
            return 1
        return 0
    names = ("PRE_COMMIT_REMOTE_NAME", "PRE_COMMIT_REMOTE_BRANCH", "PRE_COMMIT_TO_REF")
    values = [os.environ.get(name, "") for name in names]
    if not all(values):
        print(f"refuse_force_push: run by pre-commit at pre-push; {', '.join(names)} must be set.", file=sys.stderr)
        return 1
    problem = check(*values)
    if problem:
        print(f"Push refused: {problem}\n{ADVICE}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
