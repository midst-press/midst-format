# midst-format

The `.midst` file format: what the three generations are, how to convert between them, and a
conformance suite that proves a conversion did not quietly change anybody's poem.

**No poem content lives in this repository.** See `DATA.md`.

## Why this repository exists

The converter and the editor each carry their own private copy of the same diff algorithm. In
`midst-editor` today:

    src/renderer/tracking/utils.ts   compareStrings   what the EDITOR records history with
    src/main/util.ts                 compareStrings   what the CONVERTER replays with
    src/main/fileConvert.ts          compareStrings   dead code, an older cruder variant

The first two are algorithmically identical, and nothing enforces that. If one is edited, files
written by the editor and files produced by the converter stop agreeing, and no test anywhere would
notice. One library, imported by both, makes that impossible instead of unlikely.

It also gives `midst-web` a documented format to read, rather than reverse-engineering the desktop app.

## The three generations

    A   {"stack":[{"content":{"ops":[...]},"time":...}]}
        Quill editor deltas. One known file survives: Prosperity.midst.

    B   {"editorTimelineFrames":[{"content":"<p ...>","lineNumber":"0","timestamp":1605903809127}]}
        A complete HTML snapshot per keystroke. What every archived poem is stored as.
        Compresses about 100:1 in a zip, because consecutive frames are nearly identical.

    C   {"text":"<p>...</p>","history":[{"front":0,"inserted":"a","end":0,"t":"...","pos":12}]}
        The current format. Final text plus the edit list that produced it, so the whole
        trajectory is reconstructible without storing every state.
        Optional "meta" carries font, size and draft markers: see docs/META.md.

`convertMidstFile` handles **B to C**. Nothing handles A. `Prosperity` exists in both A and B, which
makes that single pair the only worked example available if A ever has to be converted.

## Replaying format C

    step(s, c)   = s.slice(0, c.front) + c.inserted + s.slice(s.length - c.end)
    replay(h)    = h.reduce(step, '')

Each change is one contiguous replacement, located by how much of the previous state it shares at the
front and at the back. `pos` carries the cursor so a replay can show where the poet was typing.

## The conformance suite, and why its shape matters

⚠️ **The obvious check is nearly blind. Do not rely on it.**

The natural way to verify a converter is: convert, replay the history, compare to the final text.
Measured against a real poem — 4,397 edits down to a 175-character poem:

    corruption introduced                      replay==text     per-frame check
    append a char to the LAST change           detected         detected
    drop the last change                       detected         detected
    truncate the history                       detected         detected
    append a char to a MIDDLE change           MISSED           detected
    drop a change from the middle              MISSED           detected
    swap two adjacent middle changes           MISSED           detected
    corrupt `front` mid-history                MISSED           detected

These poems are rewritten so heavily that the replay converges on the ending almost regardless of what
happened in the middle. The endpoint check tests the destination; **the trajectory is the artifact.**
A timelapse of a poem being written is the entire point of Midst.

So the suite asserts, for every poem and **every frame**:

    1  trajectory   replay(history[0..i]) === normalise(oldFrames[i].content)      for all i
    2  no gain      paragraph count in converted text === count in raw final frame
    3  no loss      the same, in the other direction
    4  the control  corrupt one mid-history change; assertion 1 MUST go red

**Assertion 4 is not ceremony — it is the reason the other three mean anything.** A suite without it
would have been green and worthless.

## Current status against the 58 known timelapses

    trajectory (assertion 1)   58 / 58 pass, zero mismatching frames out of ~160,000
    controls   (assertion 4)   58 / 58 fire
    no loss    (assertion 3)   58 / 58 pass
    no gain    (assertion 2)   42 / 58 pass -- 16 poems GAIN a paragraph. See docs/KNOWN-DEVIATIONS.md

## Running it

To contribute, see [CONTRIBUTING.md](CONTRIBUTING.md): the checks, and the rules about poem content.

    npm ci                 # ci, never install: the pins are exact and version-sensitive
    npm run provenance     # asserts the transcribed TipTap config still matches upstream
    MIDST_EDITOR_SRC=<midst-editor checkout> npm run build:harness   # builds the harness the commands below need
    npm test               # the self-tests (Jest): the text oracle, and a poem that FAILS leaves no text in the output; needs no harness
    npm run trajectory -- <poem.midst.zip>   # one archive's frame-by-frame replay, printed; needs the harness
    npm run conformance:coverage   # how much of the editor's converter the corpus runs; numbers only
    npm run conformance    # the real corpus. Requires MIDST_CORPUS to point at it. Never in public CI.

**Stdout is the report; stderr is the error log.** Every failure a script finds or meets is logged on stderr
as one JSON object per line (`conformance/log.cjs`), for example
`{"ts":"…","level":"error","script":"verify_all","event":"poem-error","index":3,"stage":"convert","class":"TypeError"}`.
The fields are an allowlist of numbers and identifiers: never a message, never text from a poem. A throw that
nothing caught is logged by its class alone, and the script exits 2. Usage and setup messages are on stdout.

⚠️ **Dependencies are pinned exactly, not with a caret.** `@tiptap/*` at `^2.5.4` resolves to 2.27.3
today, and HTML generation is version-sensitive, so a caret would verify behaviour the editor does not
have. This was measured, not assumed: the first harness build silently installed 2.27.3.
