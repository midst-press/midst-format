# `meta`: how a poem is presented

Format C as first shipped carried only `text` and `history`. Format B also carried, per poem, the font,
the size and the poet's draft markers, and the website's player applied them to the whole poem. The
converter dropped them, so a converted poem played in Helvetica 14 with no drafts. Measured across the
54 archived poems: 11 use another font, 6 another size, and 22 carry draft markers (94 in all). This
document adds them back as an optional `meta` object.

    {"text": "...", "history": [...], "meta": {...}}

## Fields

| field                | type           | default       | B source                       | used by players                                     |
| -------------------- | -------------- | ------------- | ------------------------------ | --------------------------------------------------- |
| `fontFamily`         | string         | `"Helvetica"` | `editorFontFamily`             | yes: the whole poem                                 |
| `fontSize`           | number, CSS px | `14`          | `editorFontSize`               | yes: the whole poem                                 |
| `draftMarkers`       | array, below   | `[]`          | `editorDraftMarkers`           | yes: named points on the timeline                   |
| `highestDraftNumber` | integer >= 0   | `0`           | `editorHighestEverDraftNumber` | editor only: the next default name is `Draft <n+1>` |
| `title`              | string         | absent        | `editorTitle`                  | no; carried so conversion loses nothing             |
| `author`             | string         | absent        | `editorAuthor`                 | no; carried so conversion loses nothing             |

**Values the editors produced.** `fontFamily`: `Bell`, `Courier`, `Garamond`, `Helvetica`, `Lato`,
`Times New Roman` (the old editor's Font Family menu). `fontSize`: `10`, `12`, `14`, `24`, `36`. A
reader MUST NOT reject a file for another value: it keeps the value, so that a save writes it back, and
renders the nearest thing it can.

**A draft marker** is `{"index": i, "name": "...", "defaultName": "Draft n"}`. `index` is a 0-based
position in `history`: the marker sits at the state reached by applying `history[0..i]`. That is B's
`timelineIndex` unchanged, because the converter emits exactly one change per B frame (54 of 54
archived poems). `name` is what the poet called the draft and `defaultName` is what the editor
suggested. `0 <= index < history.length`; a reader drops an out-of-range marker rather than rejecting the
file. Order is the file's order.

⚠️ **A marker's `name` is the poet's own words.** It is poem content under DATA.md: never printed,
logged or committed. Conformance tools compare it by hash.

## Absent and unknown

- **No `meta`, or a field missing:** use the default. Files the current editor has already written have
  no `meta`, and they are valid.
- **Unknown keys** inside `meta`: a reader ignores them and a writer that loaded them writes them back.
  That is what lets a later field be added without breaking older readers or losing data in them.

## Who does what

- **Converter (B to C):** copies each B field into `meta` as in the table, unchanged. `meta` is always
  written by the converter, even when every field equals its default, so a converted file states what the
  poet chose rather than leaving the reader to infer it.
- **Players** (the editor's Replay and the website's): apply `fontFamily` and `fontSize` to the poem,
  and show `draftMarkers` on the timeline.
- **Editor:** reads `meta` on open and writes it back on save, unknown keys included. Whether the new
  editor lets a poet _change_ font or size, or add markers, is a product decision for Annelyse; this
  format supports either answer.

## Conformance

The real-corpus run fails a poem whose `meta` differs from its B source in any field. Names are compared
by hash. A control mutates one copied field and must be reported, or the check proves nothing.

## Open, not settled here

- **How a player turns `fontFamily` into a real font.** The website declares no web font for Bell or
  Garamond, so from the code those two render only where the reader's own machine has a font of exactly
  that name (not measured in a browser yet). Bundling `Bell MT` or `Garamond` as web fonts is a licensing
  question, not a format one.
