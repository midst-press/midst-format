# The shared format library: design (#50, GitHub #9)

Stuart, 18 Oct 2026: consolidate the shared format library so both apps import one copy. This note
is the design. The moves follow it as separate PRs, each with zero behaviour change except where it
says otherwise.

## Today

Measured at editor `d4e4876`, web `2e80f0e` and format `a1115b3`.

| Code                                                       | Editor (the original)                              | Web                                                     | Format                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `ChangeObj`, `step`, `compareStrings`                      | `src/renderer/tracking/utils.ts`                   | `src/components/MidstPlayer/helpers.ts`, byte-identical | stubs that throw                                                         |
| TipTap extension config                                    | `src/shared/poemExtensions.ts`                     | inline in `MidstPlayer.tsx`, same nine options          | transcribed in `conformance/normalise.cjs` and `render_editor_entry.mjs` |
| `convertMidstFile` and the version-header and meta helpers | `src/main/util.ts`, which also holds Electron glue | none                                                    | bundled from the editor checkout (`MIDST_EDITOR_SRC`, `build:harness`)   |
| `follow.ts`, `buildLabel.ts`                               | `src/renderer/...`, `src/shared/...`               | byte-identical copies                                   | none                                                                     |

How the copies are held together today:

- Web's `editor-helpers-identical` hook compares its copies byte for byte against a pinned editor commit.
- Format's `provenance.cjs` compares the transcribed extension options and regexes against the editor.
- Format CI clones editor `main` to build the converter it tests. So a format PR can go red because of an
  editor PR, as format #48 did with editor #185.

Every repo's lockfile resolves `@tiptap/*` to 2.5.4. Web and format pin it exactly in `package.json`, while
the editor declares `^2.5.4`, which stage 2 pins. `prosemirror-*` differs between the editor (model 1.22.2) and web and
format (model 1.25.12), and so does TypeScript (editor 5.5.3, web 4.6.3).

## What the library holds

The pure code only. Nothing that touches Electron, the store, the file system or the DOM.

| Entry point                            | Contents                                                                                                                                                                                            | Depends on                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `@midst-press/midst-format/history`    | the whole of the editor's `tracking/utils.ts`: `ChangeObj`, `step`, `compareStrings`, `reconstruct`, `reconstructArray`, `reconstructHTML`                                                          | nothing                                                            |
| `@midst-press/midst-format/extensions` | `poemExtensions` (the StarterKit config)                                                                                                                                                            | `@tiptap/starter-kit` (peer)                                       |
| `@midst-press/midst-format/convert`    | `convertMidstFile`, `getFileVersion`, `stripVersionInfo`, `includeVersionInfo`, `fileVersionMatchesCurrent`, `serializeDocument`, `metaFromOldMidst`, and the trailing-break and zero-width helpers | `history`, `extensions`, `@tiptap/html` and `@tiptap/core` (peers) |

The entry points are separate so web can take `history` and `extensions` without pulling in
`@tiptap/html`, which it does not depend on. TipTap is a peer dependency: each app keeps its own pinned
2.5.4, and nothing is bundled twice.

What stays in the editor: `loadDataIntoWorkspace`, `resolveHtmlPath`, `writeConvertedFile` and the menu
code, which are the Electron and file-system glue around the library.

`follow.ts` and `buildLabel.ts` are shared between the two apps but are not the format. They stay under
web's copy check and are out of scope here.

## How the apps take it: a vendored build, pinned to a tag

midst-format builds `dist/` from a tagged release: CommonJS, ES module and `.d.ts` for each entry point.
Each app commits that build under `vendor/midst-format/` and depends on it as
`"@midst-press/midst-format": "file:vendor/midst-format"`.

Why vendor rather than use a git dependency or a registry:

- **It is the same bytes on both forges.** A git dependency names a URL, either Gitea's or GitHub's, so
  the two mirrors' `package.json` and lockfile would differ, or one forge's CI would need to reach the other.
  midst-format is private on Gitea and public on GitHub. A vendored directory makes `npm ci` need nothing
  but the repo.
- **No registry and no push-up** are needed to take a new version.
- **No compiler coupling.** The apps consume built JavaScript and declarations, not TypeScript source, so
  web's TypeScript 4.6 never compiles code written for the editor's 5.5. The declarations are kept to
  syntax both versions read, and CI checks this (stage 1).
- **Taking a new version is a reviewed PR in each app**, never a side effect of an install.

`vendor/midst-format/VENDOR.md` records the tag, the commit and a SHA-256 for every vendored file. Two
checks, because the hashes alone can be edited in the same commit as the files:

- **A pre-commit hook in each app, run in CI,** checks the files against those hashes, so a hand edit to a
  vendored file fails.
- **A CI job in each app rebuilds the tag and compares.** It clones midst-format at the tag in VENDOR.md,
  checks that the tag's commit is the one recorded, builds, and byte-compares `dist/` with
  `vendor/midst-format/`. On Gitea the clone uses a read-only deploy key, as format CI already does for the
  editor. On GitHub, midst-format is public. This depends on a tag, which does not move, and not on
  format `main`. Locally the same check runs with `MIDST_FORMAT_ROOT` set, as web's editor-helpers check
  does with `MIDST_EDITOR_ROOT`.

**Versioning.** Semver tags `vX.Y.Z` on midst-format `main`, cut from a commit whose CI is green, never
from an untagged `main` (Stuart, 16 Oct). The extraction is `v0.2.0`. A change in behaviour, such as the
#169, #15 and #36 fixes, is a new minor version.

## CI after the move

- **Format CI tests its own source.** The conformance harness imports `src/` instead of building from an
  editor checkout. `MIDST_EDITOR_SRC`, the editor clone in `ci.yml`, `conformance/provenance.cjs` and the
  transcriptions in `normalise.cjs` and `render_editor_entry.mjs` are removed (stage 4). A format PR no
  longer depends on editor `main`.
- **App CI tests the vendored copy it ships**, through the app's own tests. They import the library now
  instead of the moved code.
- **The order is one way:** format, then tag, then a vendoring PR in each app.

## Stages, one PR each

0. **This note.** Reviewers: Cora, Cyril, and Clement for web.
1. **Format: the library, moved verbatim.** `src/history.ts`, `src/extensions.ts` and `src/convert.ts` are
   copied from editor `main` at a named commit, with no edits beyond imports. Add the build to `dist/` and
   the editor's unit tests for that code, ported. Stage 1 also builds:
   - **A verbatim check:** each moved function's text in `src/` equals the editor's at the named commit,
     imports aside. This is the only check on `step` and `reconstruct*`, which the conformance corpus never
     calls.
   - **TypeScript 4.6 as a dev dependency** and a type check of `dist/*.d.ts` with it. Format has no
     TypeScript today.
   - **A reproducible build:** building the same commit twice gives the same bytes. The apps' CI depends
     on this.
   - **Parity, on the synthetic corpus in CI:** the harness is built both ways, from `src/` and from the
     editor checkout, and `convertMidstFile` must give identical output for every case. That exercises
     `convert`, `compareStrings` (which `convertMidstFile` calls) and the extension config (through
     `generateJSON` and `generateHTML`). It does not exercise `step` or `reconstruct*`. (The harness's
     `tracking-utils` stub is never used: its filter matches a bare `renderer/tracking/utils`, and `util.ts`
     imports it relatively, so the real file is bundled. Measured: the built `out/converter.cjs` contains
     `tracking/utils.ts`, and the stub's text appears 0 times. Stage 4 removes the stub.)
   - **Parity, on the real archive:** whoever holds it runs the same comparison locally. The two builds'
     outputs are compared in-process, and each poem prints only its index and whether they agree, plus
     totals. No hash is printed: a short frame's hash can be reversed by guessing (`no_text_cases.cjs`,
     `short-frame`). An open change to the moved code, such as editor #196, is either merged before the
     copy or ported into `src/` with it.
   - Tag `v0.2.0`.
2. **Editor: vendor `v0.2.0` and import it.** Delete the moved code from `util.ts`, and delete
   `tracking/utils.ts` and `shared/poemExtensions.ts`. Pin `@tiptap/*` exactly in `package.json`. The Electron glue stays. Add the vendor hook. The existing unit and e2e
   tests are the parity check and run unchanged.
3. **Web: vendor `v0.2.0` and import `history` and `extensions`.** `helpers.ts` is the editor's
   `tracking/utils.ts` byte for byte, so the whole file is deleted, along with the inline extension config.
   Remove `helpers.ts` and its test pairing (the `editor-*` copy of the tracking-utils test) from
   `check-editor-helpers.mjs`, which still guards `follow.ts`, `buildLabel.ts` and the guide. Web's tests of
   the player run unchanged against the import. Reviewer: Clement.
4. **Format: remove the editor build path.** That is `MIDST_EDITOR_SRC`, the CI editor clone and
   `provenance.cjs`, which the stage 1 dual build makes safe to drop. Close editor #23.
5. **Then the fixes**, #169, #15 and format #36, in the library as `v0.3.0`. Each app takes them by a
   vendoring PR, and then there is one reconversion. The reconversion, the release and the deploy are
   Stuart's and Violet's.

## Risks, and what catches each

| Risk                                                                 | Caught by                                                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The move changes `convert`, `compareStrings` or the extension config | the stage 1 dual build (synthetic in CI, the real archive locally); the editor's own tests in stage 2                              |
| The move changes `step` or `reconstruct*`                            | the stage 1 verbatim check; the ported unit tests; the editor's Replay tests (stage 2) and web's player tests (stage 3), unchanged |
| A vendored file is edited by hand                                    | the SHA-256 hook                                                                                                                   |
| The vendored copy and its hashes are edited together                 | the CI job that rebuilds the tag and compares                                                                                      |
| Web and editor resolve different `prosemirror-*` under TipTap 2.5.4  | not caught today, and already true: the same config can parse differently. Out of scope; noted for #9                              |
| `.d.ts` syntax that TypeScript 4.6 cannot read                       | the TypeScript 4.6 check of `dist/` that stage 1 adds to format CI; web's `tsc` in stage 3                                         |

## Decisions for Stuart

1. **Vendored build** (recommended), or a git dependency on a tag, accepting that the Gitea and GitHub
   lockfiles differ.
2. **`follow.ts` and `buildLabel.ts`:** left under web's copy check (recommended), or moved into a second
   shared package later.
