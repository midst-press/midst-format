# Known deviations

Things the converter does that differ from the source, each measured, none yet decided. A deviation
stays here, counted, until someone with standing over the work rules on it. It is not silently
tolerated and it is not silently "fixed".

---

## 1. The converter adds a blank line to 16 of 58 poems

**Status: measured, awaiting the editor's judgement. Blocks conformance assertion 2 from becoming a
hard gate.**

The old editor used [Rangy](https://github.com/timdown/rangy) for selection handling, which left
markers in the saved HTML:

    <span id="selectionBoundary_1569885017044_3830383278348277"
          class="rangySelectionBoundary"
          style="line-height: 0; display: none;">&#xFEFF;</span>

They are `display: none` and contain only U+FEFF, so they are **invisible in the old player** and carry
no authored content. TipTap has no span mark, so normalisation unwraps them — and the zero-width
character becomes a paragraph in its own right:

    before   <span ... display:none>&#xFEFF;</span><p data-line-number="0">t</p>
    after    <p>&#xFEFF;</p><p>t</p>

An invisible marker becomes a visible empty line.

Measured by comparing `<p` counts in each poem's raw final frame against its converted text:

    paragraph count GAINED     16 of 58
    paragraph count identical  42 of 58
    paragraph count LOST        0 of 58

+1 paragraph in 14 poems, +2 in two of them. **15 of the 16 gain it as a leading blank line**, so the
poem starts one line lower than the poet wrote it. 39 zero-width-only paragraphs exist across the set;
one poem has 20. 44 of 58 carry a zero-width character somewhere in the final text.

**Nothing is lost. Sixteen poems gain.** In poetry a line break is part of the work, so this is a
content change rather than a cosmetic one — which is exactly why it is not for an engineer to wave
through. Show the 16 poems to the editor rather than asking in the abstract.

If ruled spurious, the fix is small and belongs in `convertMidstFile`: strip elements whose text
content is only zero-width characters, before `generateJSON`.

Fixture: `fixtures/synthetic/synthetic--rangy-span.midst.zip`.

## 2. Marks that `StarterKit` is configured to drop

**Status: no occurrence found in the real corpus. Fixture retained as a regression guard.**

`extensions` in the converter disables `strike`, `bulletList`, `orderedList`, `listItem`, `blockquote`,
`code`, `codeBlock`, `heading` and `horizontalRule`. Anything using those is silently discarded:

    <b>bold</b>            -> <strong>bold</strong>     preserved (renamed)
    <i>it</i>              -> <em>it</em>               preserved (renamed)
    <br>                   -> <br>                     preserved
    <s>struck</s>          -> struck                    MARK DISCARDED
    <h1>head</h1>          -> head                      DISCARDED
    <code>c</code>         -> c                         DISCARDED
    <ul><li>i</li></ul>    -> <p>i</p>                  COLLAPSED

⚠️ **The trajectory assertion cannot see this**, because it normalises both sides with the same
function, so anything normalisation does uniformly is invisible to it. `npm run markloss` is the
separate instrument that can, and its own control is a `<s>` fixture confirmed to be reported as lost
before any real run.

Across the real corpus, markloss reports only `span` (deviation 1 above). No poem was found using a
disabled mark. That is a measurement over the corpus we hold, not a guarantee about future poems — the
editor can still produce them, so the guard stays.

Fixture: `fixtures/synthetic/synthetic--strikethrough.midst.zip`.

## 3. Edit granularity is coarsened where two edits land in one frame

**Status: not a defect. Text fidelity verified; recorded so it is not rediscovered as one.**

`compareStrings` finds the common prefix and the common suffix, so each change is a single contiguous
replacement. A frame containing two separate edits is encoded as one span covering both.

Measured: text reconstruction is **exact** in that case. What differs is that a replay shows both edits
appearing in one step rather than two. Whether that matters is an aesthetic question about the
timelapse, not a correctness one.

Fixture: `fixtures/synthetic/synthetic--middle-insert.midst.zip`.

## 4. The editor's own `compareStrings` has an unreachable early return

**Status: latent, guarded, not reachable. A test should pin it so it stays that way.**

`renderer/tracking/utils.ts` contains `if (str === next) return { inserted, front: 0, end: 0, t }`.
Under the repository's own `step()`, `front: 0, end: 0` reconstructs
`initial.slice(0,0) + '' + initial.slice(len)` = **the empty string**, so an unchanged frame in a saved
history would blank the poem at that point on replay.

The converter's copy has that line commented out, and its loops instead yield `front = str.length`,
which replays as identity — so having it commented out is correct rather than an oversight.

✅ **It cannot fire.** `Editor/index.tsx` guards the only call site with
`if (htmlString === newHtml) { return; }`. Reachability was checked before this was written down; an
earlier draft called it a live bug.

Fixture: `fixtures/synthetic/synthetic--unchanged-frame.midst.zip`.

## 5. Nine of 54 archived zips name their inner file something other than the object

**Status: handled. The extractor is structural; do not reintroduce name-derivation.**

    daniel-borzutzky--...           inner: daniel-borzutsky--...        misspelling
    manuel-arturo-abreu--ablation   inner: manuel-arturo-abreau--...    misspelling
    madeleine-mori--...             inner: maddie-mori--...             nickname
    mónica-de-la-torre--december    inner: NFD-normalised accent        NFC vs NFD
    jared-harél--...                inner: jared-harel--...             accent dropped
    torrin-a.-greathouse--...       inner: torrin-a-greathouse--...     period dropped
    matt-mitchell--...-poem         inner: ...-poem.midst               doubled extension
    kb--subject-line:-...           inner: kb-brookins--...             rename, colon stripped
    kb-brookins--subject-line:-...  inner: kb-brookins--...             colon stripped

⇒ **Extract the whole zip and pick the single entry ending `.midst` off disk**, excluding `._`
resource forks, asserting exactly one. Never derive the inner name from the object name, and never
pass an inner filename back through a command line — an NFD name does not survive argv, which produced
a spurious failure on `december` until it was fixed this way.

Note that `kb` and `kb-brookins` are two objects holding the **same poem** — a poet rename where both
records survived.

Fixture: `fixtures/synthetic/synthetic--inner-name-differs.midst.zip`.
