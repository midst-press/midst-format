# Where the poem data lives, and why it is not here

**In this repository specifically:** the conformance suite runs against a *synthetic* corpus committed
under `fixtures/synthetic/`, hand-written to exercise each known behaviour. The real corpus is never
committed; point `MIDST_CORPUS` at it to run `npm run conformance`, and keep that run out of public CI.

**Poem timelapses are not stored in this repository, deliberately.** Code and data are kept formally
separate.

## Why

The timelapses are the poets' work. Several contributors to Midst are exactly the people whose
writing has been taken without consent by systems that profited from it. A file pushed to a public
repository is on GitHub's servers, in forks, in caches, and in every scraper watching the event
firehose, within minutes — and it cannot be withdrawn. So the rule is simple: **no poem content in
this repository, ever, and no poem content in CI logs.**

Derived numbers — frame counts, conversion pass/fail, paragraph deltas — are fine to publish. Text is
not.

## What was removed when this repository was seeded

The fork point (`annelysegelman/midst-journal`, `main` @ `f330169`) carried eight poem files as static
assets under `static/static/assets/`. **No source file referenced any of them** — they are vestigial,
left over from an earlier architecture. They were lifted out rather than deleted:

    Pool.midst                                  28,211,872 bytes   format B
    Prosperity.midst                               575,411         format A (Quill deltas)
    angelo-colavita--a-shade-whiter.js           1,677,277         format B
    annelyse-gelman--alphabet-song.js            1,219,527         format B
    annelyse-gelman--pool.js                    28,211,889         format B
    annelyse-gelman--prosperity.js                 554,071         format B
    untitled--hedgie-choi.js                     4,792,965         format B
    veronica-martin--epilogue-in-summer.js      32,642,924         format B

They now live outside git with sha256 checksums and a provenance manifest, beside the poem archive.
**Four of them exist nowhere else** — not in the CloudFront bucket, not in the archive taken from it,
and not in `src/poems/` metadata:

    angelo-colavita--a-shade-whiter      a poet who appears in no other record
    untitled--hedgie-choi                distinct from her published "I Get It, Phases"
    annelyse-gelman--alphabet-song
    annelyse-gelman--prosperity

All four were verified convertible: every intermediate frame reconstructs exactly, with a corruption
control confirming the check is capable of failing.

Also removed: `yarn-error.log`, a 7,409-line crash log containing a contributor's home directory
paths and full shell `PATH`. It is a build artefact, not source.

## Three generations of the format

    A   {"stack":[{"content":{"ops":[...]},"time":...}]}            Quill editor deltas
    B   {"editorTimelineFrames":[{content,lineNumber,timestamp}]}   full HTML snapshot per keystroke
    C   {"text":...,"history":[{front,inserted,end,t,pos}]}         final text plus an edit list

`convertMidstFile` handles **B to C only.** Format A has exactly one worked example: `Prosperity`
exists in both A and B, so that pair is the only Rosetta stone available if A ever needs converting.

See the `midst-format` repository for the specification and the conformance suite.
