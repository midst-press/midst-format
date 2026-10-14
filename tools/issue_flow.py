#!/usr/bin/env python3
"""Move GitHub issues along "merged, released, verified" with no person involved (midst-infra #14).

An issue is the requirement in a user's words. It is closed by the person who checks it in a released package,
not by the merge that fixes it. Between the two it carries a label:

    awaiting release     the fix is on main; no release contains it yet
    needs verifying      a release contains it; the verifier checks it there and closes the issue

    issue_flow.py merged      a pull request has merged to main            needs GH_REPO, PR
    issue_flow.py released    a release has been published                 needs GH_REPO, TAG, RELEASE_URL
    issue_flow.py closed      an issue has been closed                     needs GH_REPO, ISSUE

merged: every open issue the pull request names as "Completes #12" in its title or description gets the label
"awaiting release" and a comment that records the merge commit. An issue that was "needs verifying" (a first fix
did not hold) goes back to "awaiting release". "Refs #12" is a mention and does nothing here: a requirement often
takes several pull requests, and only the one that finishes it says "Completes". A pull request merged into a
branch other than the repository's default branch does nothing either, because its commit is not on main.

released: every open issue labelled "awaiting release" WHOSE RECORDED COMMITS ARE ALL CONTAINED IN THE TAG gets a
comment naming the release and saying how to check it, the label "needs verifying", the milestone named after
the tag, and the verifier as assignee (VERIFIER, a GitHub login; empty assigns nobody); then "awaiting release"
is taken off. An issue whose fix is not in the tag, or that has no recorded commit because it was labelled by
hand, is left as it is and named in the output: a fix merged after the tag was cut is not in that release, and
telling its reporter otherwise would make a good fix look like a failed one. When the reason is one only a person
can settle (no recorded commit, or one GitHub cannot find), the issue is also told so in a comment, once per
release, and the run shows a warning: a line in a green run's log is read by nobody (midst-infra #46). A fix that
is simply not in this release needs nobody: the next release takes it.

closed: an issue closed as completed while it is "awaiting release" is reopened, with a comment saying its fix is
not in a release yet. Closing a "needs verifying" issue is the verifier's act and is left alone, and so is an
issue an owner closed as not planned or as a duplicate.

Running any of them again is safe, in any order. In merged, the commit is recorded before any label moves, so no
release that lacks it can announce the issue; a run that stopped after recording is finished by the next; and a
merge seen again after a release has been announced on the issue does not take it back from the verifier. In released, the comment is not posted twice and "awaiting release" comes off last, so an
issue that was only half done is still found by the next run.

The markers are hidden lines in comments, and these are public repositories where anyone can comment. A marker
counts only in a comment written by the identity the workflows run as: ISSUE_FLOW_AUTHOR, by default
"github-actions[bot]", which is who a workflow's own token writes as.

It talks to GitHub through `gh api` (ISSUE_FLOW_GH overrides the binary), so it needs GH_TOKEN where gh does.
Exit 0 done, including "nothing to do"; 1 a required variable is missing; 2 GitHub refused or could not be
reached, and the output says how far it got. Standard library only.

The label name has no comma on purpose: GitHub's issue queries take labels as a comma-separated list, so a label
with a comma in its name cannot be asked for.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from urllib.parse import quote

AWAITING = "awaiting release"
VERIFYING = "needs verifying"
LABELS = {
    AWAITING: ("C5DEF5", "Fixed on main; not in a release yet"),
    VERIFYING: ("FBCA04", "Fixed in a release; the verifier checks it and closes the issue"),
}
# "Completes #12", "Completes: #12", "Completes #12, #14", "Completes #12 and #14".
COMPLETES = re.compile(
    r"(?<![A-Za-z0-9_])Completes:?[ \t]+#[0-9]+(?:(?:[ \t]*,[ \t]*|[ \t]+and[ \t]+)#[0-9]+)*", re.IGNORECASE
)
RELEASED = re.compile(r"<!-- midst-issue-flow: released \S+ -->")
DEFAULT_AUTHOR = "github-actions[bot]"
FIXED_IN = re.compile(r"<!-- midst-issue-flow: fixed-in ([0-9a-f]{40}) -->")
STEPS_HEADING = "How will we know this works?"


class GitHubError(Exception):
    """gh could not complete a request."""


def gh(method: str, path: str, body: dict | None = None, *, paginate: bool = False) -> object:
    """Call the GitHub REST API through `gh api`.

    Args:
        method: The HTTP method.
        path: The path after the API root, such as "repos/o/r/issues/3".
        body: A JSON body to send, or None.
        paginate: Follow every page of a list and return the items of all of them.

    Returns:
        The decoded response; None when the response has no body.

    Raises:
        GitHubError: If gh exits non-zero. The message carries gh's own error text.
    """
    command = [os.environ.get("ISSUE_FLOW_GH", "gh"), "api", "--method", method, path]
    if paginate:
        command += ["--paginate", "--slurp"]
    if body is not None:
        command += ["--input", "-"]
    done = subprocess.run(
        command, input=json.dumps(body) if body is not None else None, capture_output=True, text=True, check=False
    )
    if done.returncode != 0:
        raise GitHubError(f"{method} {path}: {done.stderr.strip() or 'gh failed with no message'}")
    if not done.stdout.strip():
        return None
    decoded = json.loads(done.stdout)
    if paginate:  # --slurp wraps the pages in one array
        return [item for page in decoded for item in page]
    return decoded


def fixed_marker(commit: str) -> str:
    """Return the hidden line that records the commit that fixed an issue."""
    return f"<!-- midst-issue-flow: fixed-in {commit} -->"


def completed_issues(text: str) -> list[int]:
    """Return the issue numbers a text names with "Completes #N", each once, ascending."""
    numbers = set()
    for match in COMPLETES.finditer(text):
        numbers.update(int(number) for number in re.findall(r"#([0-9]+)", match.group(0)))
    return sorted(numbers)


def label_names(issue: dict) -> list[str]:
    """Return the names of an issue's labels."""
    return [label["name"] for label in issue.get("labels", [])]


def own_comments(repo: str, number: int) -> list[str]:
    """Return the bodies of the comments on an issue that the workflows' own identity wrote.

    Markers are read from these and from no others: anyone can comment on a public repository, and a marker in
    a stranger's comment must not move an issue.
    """
    author = os.environ.get("ISSUE_FLOW_AUTHOR") or DEFAULT_AUTHOR
    listed = gh("GET", f"repos/{repo}/issues/{number}/comments?per_page=100", paginate=True)
    return [comment.get("body") or "" for comment in listed if (comment.get("user") or {}).get("login") == author]


def absent(error: GitHubError) -> bool:
    """Whether GitHub said the thing asked for does not exist."""
    return "HTTP 404" in str(error)


def marker(tag: str) -> str:
    """Return the hidden line that marks an issue as already told about a release."""
    return f"<!-- midst-issue-flow: released {tag} -->"


def verification_steps(issue_body: str | None) -> str | None:
    """Return the text under the issue form's "How will we know this works?" heading.

    Args:
        issue_body: The issue's body, as GitHub stores it.

    Returns:
        The section's text, or None when the issue has no such section or it was left empty.
    """
    if not issue_body:
        return None
    body = issue_body.replace("\r\n", "\n")
    heading = re.search(rf"^(#{{1,6}})[ \t]*{re.escape(STEPS_HEADING)}[ \t]*\n", body, re.MULTILINE)
    if not heading:
        return None
    rest = body[heading.end() :]
    # The section ends at the next heading of the same level or higher. A smaller heading inside the steps is
    # part of them.
    following = re.search(rf"^#{{1,{len(heading.group(1))}}}[ \t]", rest, re.MULTILINE)
    text = (rest[: following.start()] if following else rest).strip()
    return None if text in ("", "_No response_") else text


def release_comment(tag: str, release_url: str, issue_body: str | None) -> str:
    """Compose the comment that asks for an issue to be checked in a release.

    Args:
        tag: The release's tag.
        release_url: The release's page.
        issue_body: The issue's body, from which the steps to follow are taken.

    Returns:
        The comment, ending with the marker for this tag.
    """
    steps = verification_steps(issue_body)
    how = (
        f"How to check it, from this issue:\n\n{steps}"
        if steps
        else "This issue does not say how to check it, so go by its description: do what it describes and see "
        "whether the problem is gone."
    )
    return (
        f"**This is in release [{tag}]({release_url}).** Please check it there.\n\n"
        f"{how}\n\n"
        "- If it works, close this issue with a comment saying what you did, what you saw, and on which computer.\n"
        "- If it does not, leave it open and say what happened.\n\n"
        f"{marker(tag)}"
    )


def ensure_label(repo: str, name: str) -> None:
    """Create a label this script uses if the repository does not have it."""
    try:
        gh("GET", f"repos/{repo}/labels/{quote(name)}")
    except GitHubError as error:
        if not absent(error):
            raise
        colour, description = LABELS[name]
        gh("POST", f"repos/{repo}/labels", {"name": name, "color": colour, "description": description})


def milestone_number(repo: str, title: str) -> int:
    """Return the number of the milestone with this title, creating it if there is none."""
    for milestone in gh("GET", f"repos/{repo}/milestones?state=all&per_page=100", paginate=True):
        if milestone["title"] == title:
            return milestone["number"]
    return gh("POST", f"repos/{repo}/milestones", {"title": title})["number"]


def merged(repo: str, pull_number: int) -> int:
    """Label the issues a merged pull request names, and record the commit that fixed them.

    Args:
        repo: "owner/name".
        pull_number: The pull request.

    Returns:
        How many issues were labelled "awaiting release".
    """
    pull = gh("GET", f"repos/{repo}/pulls/{pull_number}")
    if not pull.get("merged"):
        print(f"issue_flow: pull request #{pull_number} is not merged; nothing done")
        return 0
    default_branch = gh("GET", f"repos/{repo}")["default_branch"]
    base = pull["base"]["ref"]
    if base != default_branch:
        print(f"issue_flow: pull request #{pull_number} was merged into {base}, not {default_branch}; nothing done")
        return 0
    commit = pull["merge_commit_sha"]
    numbers = completed_issues(f"{pull.get('title') or ''}\n{pull.get('body') or ''}")
    print(f"issue_flow: pull request #{pull_number} merged as {commit[:12]} and completes {len(numbers)} issue(s)")
    done = 0
    for number in numbers:
        try:
            issue = gh("GET", f"repos/{repo}/issues/{number}")
        except GitHubError as error:
            if not absent(error):
                raise
            print(f"issue_flow: #{number} left: there is no such issue")
            continue
        if "pull_request" in issue:
            print(f"issue_flow: #{number} left: it is a pull request, not an issue")
            continue
        if issue["state"] != "open":
            print(f"issue_flow: #{number} left: it is already closed")
            continue
        comments = own_comments(repo, number)
        recorded_at = next((i for i, body in enumerate(comments) if fixed_marker(commit) in body), None)
        if recorded_at is not None and any(RELEASED.search(body) for body in comments[recorded_at + 1 :]):
            # This merge was recorded and a release has been announced on the issue since. The issue is with
            # the verifier, or past them; seeing the same merge again must not take it back.
            print(f"issue_flow: #{number} left: {commit[:12]} is recorded on it and a release has been announced since")
            continue
        if recorded_at is None:
            # First, before any label moves: once the commit is recorded, no release that lacks it can
            # announce the issue. A run that stops after this is finished by the next one, below.
            gh(
                "POST",
                f"repos/{repo}/issues/{number}/comments",
                {
                    "body": f"The fix for this has been merged ({pull['html_url']}). It is not in a release yet. "
                    "This issue stays open until someone has checked the fix in a release.\n\n"
                    f"{fixed_marker(commit)}"
                },
            )
        ensure_label(repo, AWAITING)
        gh("POST", f"repos/{repo}/issues/{number}/labels", {"labels": [AWAITING]})
        if VERIFYING in label_names(issue):  # an earlier fix did not hold; this one is not released yet
            gh("DELETE", f"repos/{repo}/issues/{number}/labels/{quote(VERIFYING)}")
        print(f"issue_flow: #{number} is now '{AWAITING}', fixed in {commit[:12]}")
        done += 1
    return done


def left_marker(tag: str) -> str:
    """Return the hidden line that marks an issue as already told it was left for a person at a release."""
    return f"<!-- midst-issue-flow: left-for-a-person {tag} -->"


def left_comment(tag: str, reason: str) -> str:
    """Compose the comment on an issue a release could not hand over, for the person who has to decide."""
    return (
        f"**This was not handed to the verifier with {tag}:** {reason}.\n\n"
        f"If {tag} does contain the fix, label this issue `{VERIFYING}` instead of `{AWAITING}`, put it on a "
        f"milestone named {tag} (make one if there is none yet) and assign the verifier. If it does not, leave it as it is; the next release will "
        "look at it again.\n\n"
        f"{left_marker(tag)}"
    )


def why_not_in(repo: str, tag: str, comment_bodies: list[str]) -> tuple[str, bool] | None:
    """Say why an issue's fix cannot be called part of a release, or None when it is part of it.

    Args:
        repo: "owner/name".
        tag: The release's tag.
        comment_bodies: The issue's comments by the workflows' own identity, where merged() recorded the commits.

    Returns:
        (a reason to leave the issue as it is, whether only a person can settle it), or None when every recorded
        commit is contained in the tag.
    """
    commits = [commit for body in comment_bodies for commit in FIXED_IN.findall(body)]
    if not commits:
        return "no fixing commit is recorded on it (labelled by hand?), so a person must decide", True
    for commit in dict.fromkeys(commits):
        try:
            compared = gh("GET", f"repos/{repo}/compare/{commit}...{quote(tag)}")
        except GitHubError as error:
            if not absent(error):
                raise
            return f"its recorded commit {commit[:12]} or the tag could not be found", True
        if compared["behind_by"] != 0:  # the tag lacks commits that the fix has: the fix is not in it
            return f"its fix {commit[:12]} is not in {tag}", False
    return None


def released(repo: str, tag: str, release_url: str, verifier: str) -> int:
    """Hand every issue whose fix is in a release to the verifier.

    Args:
        repo: "owner/name".
        tag: The release's tag.
        release_url: The release's page.
        verifier: A GitHub login to assign, or "" to assign nobody.

    Returns:
        How many issues were moved to "needs verifying".
    """
    listed = gh("GET", f"repos/{repo}/issues?state=open&labels={quote(AWAITING)}&per_page=100", paginate=True)
    issues = [item for item in listed if "pull_request" not in item]  # this endpoint lists pull requests too
    print(f"issue_flow: {len(issues)} open issue(s) labelled '{AWAITING}' in {repo}")
    milestone = None
    done = 0
    for issue in issues:
        number = issue["number"]
        comments = own_comments(repo, number)
        left = why_not_in(repo, tag, comments)
        if left:
            reason, for_a_person = left
            print(f"issue_flow: #{number} left '{AWAITING}': {reason}")
            if for_a_person:
                # A GitHub Actions annotation, shown on the run and the workflow's page; plain text elsewhere.
                print(
                    f"::warning title=Not handed to the verifier::#{number} was left '{AWAITING}' for {tag}: {reason}"
                )
                if not any(left_marker(tag) in body for body in comments):
                    gh("POST", f"repos/{repo}/issues/{number}/comments", {"body": left_comment(tag, reason)})
            continue
        if milestone is None:  # made only once there is something to put on it
            ensure_label(repo, VERIFYING)
            milestone = milestone_number(repo, tag)
        if not any(marker(tag) in body for body in comments):
            gh(
                "POST",
                f"repos/{repo}/issues/{number}/comments",
                {"body": release_comment(tag, release_url, issue.get("body"))},
            )
        gh("POST", f"repos/{repo}/issues/{number}/labels", {"labels": [VERIFYING]})
        gh("PATCH", f"repos/{repo}/issues/{number}", {"milestone": milestone})
        who = "unassigned"
        if verifier:
            assigned = gh("POST", f"repos/{repo}/issues/{number}/assignees", {"assignees": [verifier]})
            logins = [person.get("login", "").lower() for person in (assigned or {}).get("assignees", [])]
            # GitHub answers success and assigns nobody when the login cannot be assigned in this repository.
            who = f"assigned to {verifier}" if verifier.lower() in logins else f"COULD NOT ASSIGN {verifier}"
        # Last, so that a run that stops part way leaves the issue where the next run finds it.
        gh("DELETE", f"repos/{repo}/issues/{number}/labels/{quote(AWAITING)}")
        print(f"issue_flow: #{number} is now '{VERIFYING}', on milestone {tag}, {who}")
        done += 1
    print(f"issue_flow: {done} handed over, {len(issues) - done} left '{AWAITING}'")
    return done


def closed(repo: str, number: int) -> int:
    """Reopen an issue that was closed before its fix reached a release.

    Args:
        repo: "owner/name".
        number: The issue that was closed.

    Returns:
        1 when the issue was reopened, 0 when it was left as it was.
    """
    issue = gh("GET", f"repos/{repo}/issues/{number}")
    reason = issue.get("state_reason")
    if issue["state"] != "closed" or AWAITING not in label_names(issue):
        print(f"issue_flow: #{number} left as it is (state {issue['state']}, not '{AWAITING}' or not closed)")
        return 0
    if reason not in (None, "completed"):  # "not_planned", "duplicate": an owner's decision, not a slip
        print(f"issue_flow: #{number} left closed: it was closed as {reason}")
        return 0
    # The comment first: if reopening then fails, the issue is still closed and the next run tries again,
    # where an issue reopened with no comment would never be told why.
    gh(
        "POST",
        f"repos/{repo}/issues/{number}/comments",
        {
            "body": "This is being reopened: its fix is merged but is not in a release yet. When a release "
            "contains it, this issue will say so, and it is closed by whoever checks the fix there."
        },
    )
    gh("PATCH", f"repos/{repo}/issues/{number}", {"state": "open"})
    print(f"issue_flow: #{number} reopened: it is '{AWAITING}'")
    return 1


def main(argv: list[str] | None = None) -> int:
    """Run the command line described in the module docstring.

    Args:
        argv: Arguments, without the program name. Defaults to the process arguments.

    Returns:
        The exit status.
    """
    args = sys.argv[1:] if argv is None else argv
    needs = {"merged": ("GH_REPO", "PR"), "released": ("GH_REPO", "TAG", "RELEASE_URL"), "closed": ("GH_REPO", "ISSUE")}
    if len(args) != 1 or args[0] not in needs:
        print("usage: issue_flow.py merged|released|closed", file=sys.stderr)
        return 1
    command = args[0]
    env = os.environ
    missing = [name for name in needs[command] if not env.get(name)]
    if missing:
        print(f"issue_flow: not set: {', '.join(missing)}", file=sys.stderr)
        return 1
    for name in ("PR", "ISSUE"):
        if name in needs[command] and not env[name].isdigit():
            print(f"issue_flow: {name} must be a number", file=sys.stderr)
            return 1
    try:
        if command == "merged":
            merged(env["GH_REPO"], int(env["PR"]))
        elif command == "released":
            released(env["GH_REPO"], env["TAG"], env["RELEASE_URL"], env.get("VERIFIER", "").strip())
        else:
            closed(env["GH_REPO"], int(env["ISSUE"]))
    except GitHubError as error:
        print(f"issue_flow: stopped: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
