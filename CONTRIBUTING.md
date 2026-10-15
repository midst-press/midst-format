# Contributing to midst-format

This repository describes the Midst file formats and checks the editor's converter against them: the
conformance suite replays every frame of a poem and compares the result. The README explains why it is
built that way; please read it before changing the suite.

## Where contributions go

Open issues and pull requests here, on GitHub (`midst-press/midst-format`). Pull requests target `main`.
A pull request is merged when its CI is green and a maintainer has reviewed it.

## Never commit poem content

The real corpus is the poets' work and is never in this repository, its CI, an issue or a pull request.
That includes poem text, archive entry names, titles of unpublished work, and poets' names. The suite
reports numbers, not names, and a failing poem leaves no text in the output (the `no-text-on-failure`
hook guards this). Tests and examples use the synthetic corpus in `fixtures/synthetic/`. To add a case
that a real poem revealed, rebuild its shape synthetically; do not copy from the poem.

`npm run conformance` against the real corpus (`MIDST_CORPUS`) runs only on a maintainer's machine or in
the hand-run `conformance-real-corpus` workflow, never in public CI.

## Licence

AGPL-3.0-or-later (`LICENSE`). By contributing you agree your contribution is licensed the same way.

## Setting up

- **Node:** the version in `.nvmrc`. **npm only**: `npm ci`, never `npm install`, because the TipTap
  versions are pinned exactly and HTML generation changes between them (see the README).
- The harness is built from the editor's real converter, so most commands need a checkout of
  `midst-press/midst-editor`, with `MIDST_EDITOR_SRC` set to its root (and `MIDST_EDITOR_UTIL_TS` to its
  `src/main/util.ts` for `npm run provenance`). The README's "Running it" section lists the commands.

## Before you open a pull request

`pre-commit` is a Python tool: `pipx install pre-commit==4.6.2` (the version CI uses; `uv tool install`
works too). Install it before `npm ci`: `npm ci` installs this clone's git hooks for you
(`tools/install-hooks.cjs`) and fails if it cannot, and `npm test` does not run in a clone without them. A
commit made without the hooks skips every check below and the rule about closing keywords. One hook runs on
push and refuses to rewrite a branch the remote already has: merge main in instead of rebasing, and add a commit
instead of amending one that is pushed. A clone set up before that hook existed fails each commit, saying so, until
`npm ci` (or `pre-commit install`) runs again.

The `conformance-synthetic` hook runs the suite, so build the harness first:

```
npm ci
MIDST_EDITOR_SRC=../midst-editor npm run build:harness   # writes out/converter.cjs from the editor's source
pre-commit run --all-files    # the same checks CI runs, including conformance on the synthetic corpus
npm test                      # self-tests (Jest); no harness needed
```

Rebuild the harness whenever the editor's converter changes.

- A change to what the suite accepts as conformant needs a synthetic case that shows the difference.
- `docs/KNOWN-DEVIATIONS.md` records where the converter is known to differ, and why. Update it when that
  changes.
- **Titles, descriptions and commit messages say `Refs #12`, not `Fixes #12` or `Closes #12`.** A closing
  keyword closes the issue the moment the commit reaches `main`, before anyone has checked the fix. The
  `commit-msg` hook that `pre-commit install` sets up refuses one, and so does a check on the pull request
  (`.github/workflows/closing-keywords.yml`).

## How an issue gets closed

An issue is closed by a person who has checked the fix, not by the merge. A change here reaches someone
using Midst only when a release of the editor and the site both contain it, so there is no single release
of this repository to check it in. Until that rule is settled, nothing labels or assigns issues here
automatically, as `issue-flow.yml` does in `midst-editor` and `midst-web`; `tools/issue_flow.py` is kept
as the same copy those repositories hold, and no workflow runs it.

## CI

`.github/workflows/ci.yml` runs on every pull request: the pre-commit checks, then the conformance suite on
the synthetic corpus, with the harness built from `midst-press/midst-editor`'s current source.
