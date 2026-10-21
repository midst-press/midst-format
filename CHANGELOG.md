# Changelog

Each version is a tag `vX.Y.Z` on `main`, and each app takes it by vendoring the tag (docs/LIBRARY.md).

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
- **The conformance oracle stays on TipTap 2.5.4** (`conformance/oracle`), the old app's version, and maps its
  `&nbsp;` and quote forms to the standard's before comparing. With the 0.6.0 converter, all 54 archived poems
  verify, and render the same lines in the editor as in a browser.
