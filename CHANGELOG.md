# Changelog

Each version is a tag `vX.Y.Z` on `main`, and each app takes it by vendoring the tag (docs/LIBRARY.md).

## 0.7.1

- **happy-dom 21.0.4** (#113, GitHub alerts #4 and #5: SSRF through a stylesheet or iframe in parsed HTML, and host code
  execution through an import alias). It parses the poem HTML that `convert` reads.
- **TipTap 3.32.2.** `@tiptap/html` 3.32.0 accepts only happy-dom 20, so 3.32.2 is the first that takes the fix. Each app
  moves to TipTap 3.32.2 and happy-dom 21.0.4 when it vendors this version.

## 0.7.0

- **Underline and strikethrough** (#108; midst-editor#140, GitHub midst-press/midst-editor#30). The poem schema's marks are
  now bold, italic, underline and strike: `<u>` and `text-decoration: underline` parse as underline; `<s>`, `<del>`,
  `<strike>` and `text-decoration: line-through` as strike. An app that vendors this version can write both, and its
  player shows them. No existing Midst poem contains either (archive scan, 54 poems), so reconversion changes nothing.
  - The conformance oracle, still TipTap 2.5.4, gains `@tiptap/extension-underline` 2.5.4 so it models the same marks.
  - The mark-loss control is now `<code>`, a mark still off.
  - The two marks bring their TipTap shortcuts: Mod-U for underline and Mod-Shift-S for strike. In midst-editor,
    Mod-Shift-S is Save As, so the editor rebinds strike when it vendors this version (midst-editor#140).

## 0.6.0

- **TipTap 3.32.0** (#102). Each app needs TipTap 3 before vendoring this version.
  - The poem schema is unchanged. StarterKit 3 adds link, underline, list keymap and trailing node, and all four are
    off. The hard break is not ProseMirror's `linebreakReplacement`, so a newline in a parsed frame stays a space.
  - Peers: `extensions` needs `@tiptap/starter-kit` and `@tiptap/extension-hard-break`. `convert` needs
    `@tiptap/core`, `@tiptap/pm` and `happy-dom`, which is optional and replaces `@tiptap/html`.
  - The converter parses and serializes in one reused happy-dom window. With a window per call, a conversion of
    thousands of frames ran out of memory.
- **Stored text is HTML as the HTML standard serializes it.** A no-break space is `&nbsp;`, and `"` and `'` in
  text are written as themselves. Under TipTap 2 they were a raw U+00A0, `&quot;` and `&apos;`, so history offsets
  in files converted by 0.5.0 differ from those converted by 0.6.0. The text renders the same.
- **A span styled bold or italic** (`font-weight: bold`, `700` or `bolder`; `font-style: italic`) now converts to
  bold or italic, as TipTap reads it in a browser. TipTap 2 in Node dropped it. No archived poem has one.
- **A line holding only shown zero-width elements keeps its whitespace** (#100), as Chromium draws it (`<p> </p>`),
  where 0.5.0 wrote an empty line. This too can move history offsets against files converted by 0.5.0.
- **THIRD_PARTY_NOTICES** gives each bundled package directory its own section (#101). The notices are unchanged.
- **The conformance oracle stays on TipTap 2.5.4** (`conformance/oracle`), the old app's version, and maps its
  `&nbsp;` and quote forms to the standard's before comparing. With the 0.6.0 converter, all 54 archived poems
  verify, and render the same lines in the editor as in a browser.
