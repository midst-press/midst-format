# Size limits: how long a poem the editor and the web player cope with

This page covers midst-editor issue 34 on GitHub. It describes a measurement run by hand and records its results.
**No CI workflow runs it.** The generator's and the driver's own unit tests do run in CI, but this measurement does
not.

## When to run it

- Before a release of the editor or the website.
- After any change to the editor's writing surface, to Replay, or to the web player.

Add the new results to the table below, with the date, the commit of each repository and the machine.

## What it does

`tools/size_search.mjs` takes these steps:

1. **Generates** a long poem with `tools/generate_long_midst.mjs` (seed 1 unless told otherwise).
   - It simulates a person typing a public-domain text into Midst: one history entry per keystroke, with human
     pauses, and deletions that are then retyped.
   - No real poem is read or written at any point.
2. **Runs each app's opt-in spec** on the poem:
   - the editor's `e2e/size-limits.spec.ts`, which covers open, typing, save and Replay;
   - the website's `e2e/size-limits.spec.ts`, which covers load, play and scrub.
   - Both specs are skipped unless `MIDST_SIZE_FILE` is set, so an ordinary `npx playwright test` never runs them.
3. **Applies the thresholds below** to each measured number.
4. **Halves the length** and repeats, starting from the whole text (`--start 1`), until a level passes everything.
5. **Reruns the smallest failing level once**, to show whether the boundary is stable.

Each level is the _leading_ share of the text, so 1/4 is the true beginning of 1/2.

### What the method is pinned to

| Input            | Where                                                                       | What pins it                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source text      | Samuel Richardson, _Clarissa_: nine Project Gutenberg volumes, concatenated | `tools/clarissa_source.json`: each volume's ebook number and URL; the normalised text's length (5,216,723 characters) and its sha256. `tools/fetch_clarissa.mjs` downloads the volumes, verifies the sha256 and writes nothing if it differs.                                                                                                                             |
| Typing behaviour | `tools/long_midst_rates.json`                                               | Each figure has a nominal value, a range, the basis of that range, and its source. Most were measured with `tools/measure_typing_rates.mjs`, which prints aggregates only, on 54 converted beta poems (233,233 history entries). The burst speed of about 310 characters per minute was measured by Violet on the same poems. Override a nominal with `--set name=value`. |
| Randomness       | `--seed` (default 1)                                                        | The same seed, fraction and parameter file give a byte-identical file.                                                                                                                                                                                                                                                                                                    |

Whole-document rewrites, such as a paste or an undo of more than 1000 characters, are not modelled. They are 0.29% of
real edits, and the parameter file's `note` says why they are left out.

### Thresholds

These are **provisional** and are Stuart's to change. They live in `THRESHOLDS` in `tools/size_search.mjs`.

| Measure                                                                                       | Passes when                                                                                                       |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Editor open                                                                                   | under 5 s                                                                                                         |
| Keystroke to the editor's DOM, p95 over 100 keys                                              | under 100 ms                                                                                                      |
| Editor save                                                                                   | under 2 s                                                                                                         |
| Replay pace, and web player pace                                                              | at least 90% of the set rate of 16.67 frames per second (the 90% share is the measurement's choice, not Stuart's) |
| Replay slider, and web scrub: the slowest of 6 positions (with 6 samples, p95 is the maximum) | under 250 ms                                                                                                      |
| Editor and web page                                                                           | no crash, no renderer gone, no uncaught page error                                                                |
| Every step                                                                                    | no failure recorded, every sample taken (100 keys, 6 positions), and each spec exited cleanly                     |

Web load time is reported but has no threshold.

### What each timestamp brackets

- **Typing** runs from the keydown event's own `timeStamp` to the first DOM mutation that lengthens the last
  paragraph. Time queued behind a busy renderer counts. Delivery of the key by the OS and by Playwright does not.
- **"Screen" figures** use the first timer after the next animation frame. They have a floor of about 50 ms on this
  setup, so the thresholds read the DOM figures and the screen figures are reported beside them.
- **Save** runs from the main process receiving `save-file` to the last change of the file that a 10 ms poll sees,
  after which the file must stay unchanged for 2 s. The renderer's work before it sends the message is reported
  separately, as prep.
- **Open** ends when the last paragraph's ending appears. If the app shows its refusal dialog, open fails at once.
- **Pace** is the achieved frame rate, sampled every 25 ms over at least 6 s of play.

## How to run it

The two app repositories must be clones beside this one, on the commits being measured. Before running:

```sh
# once, to build and verify the source text cache
node tools/fetch_clarissa.mjs

# the editor: dependencies, Electron, and a build
(cd ../midst-editor && npm ci && node tools/install-electron.cjs && npm run build)

# the website: dependencies
(cd ../midst-web && npm ci)
```

Then:

```sh
node tools/size_search.mjs [--start 1] [--seed 1] [--results DIR] [--web-port 8197]
```

Expect it to take about two hours from `--start 1`, because the largest levels are slow to fail.

- **Web server.** The driver starts the website's own `npm run e2e:serve` on `--web-port`. It refuses to use a port
  that already answers.
- **Output.** Results go to `--results`. By default that is a dated directory under
  `${XDG_CACHE_HOME:-~/.cache}/midst-format/size-search/`, which is never inside a repository. It holds:
  - `results.md` and `results.json`;
  - a directory per level, with every command's full log.
- **Failures.** A failure prints the step, its own error text and the log's path.
- **Generated poems.** Each poem is deleted after its level unless `--keep-files` is given. They reach about 1 GB.

To run one spec by hand on a file you already have:

```sh
MIDST_SIZE_FILE=/path/poem.midst MIDST_SIZE_RESULT=/path/editor.json npx playwright test e2e/size-limits.spec.ts   # in midst-editor
MIDST_KEY_SCHEME=legacy MIDST_POEM_LIST=bundled MIDST_SIZE_FILE=/path/poem.midst MIDST_SIZE_RESULT=/path/web.json \
  npx playwright test e2e/size-limits.spec.ts                                                                    # in midst-web, with e2e:serve running
```

## Results

### 16 October 2026: seed 1, from the whole text

**Machine:**

- Apple M1 Max (10 cores), 64 GB RAM, Darwin 24.6.0 arm64
- node 26.12.0, npm 12.2.0
- Electron 44.7.1 (Chromium 152.0.7977.149)
- Playwright Chromium 156.0.8078.4

**Largest passing level: 1/256** (20,045 characters, 42,912 history entries, 3.5 MB).
**Smallest failing level: 1/128.** Only the editor's Replay fails there, on pace and on the slider.

This run was judged by an earlier driver that ignored failed steps and spec errors. Its saved results, re-judged
under the current verdict, give the same pass or fail at every level.

Times are in milliseconds. "–" means the step produced no number because an earlier step failed.

|                                  | 1                 | 1/2        | 1/4             | 1/8               | 1/16                     | 1/32                  | 1/64                | 1/128           | 1/256           |
| -------------------------------- | ----------------- | ---------- | --------------- | ----------------- | ------------------------ | --------------------- | ------------------- | --------------- | --------------- |
| characters                       | 5,152,933         | 2,576,441  | 1,287,989       | 643,686           | 321,681                  | 160,995               | 80,217              | 39,912          | 20,045          |
| history entries                  | 11,474,517        | 5,783,299  | 2,956,265       | 1,515,855         | 749,677                  | 373,601               | 192,374             | 88,412          | 42,912          |
| file MB                          | 995.8             | 499.4      | 252.7           | 128.6             | 63.4                     | 31.3                  | 16.0                | 7.3             | 3.5             |
| editor open                      | refused           | refused    | timeout (120 s) | 59,700            | 10,448                   | 4,989                 | 2,755               | 1,460           | 793             |
| keystroke to DOM p50 / p95 / max | –                 | –          | –               | 16 / 19 / 37      | 8.8 / 9.9 / 17.5         | 4.0 / 5.3 / 14.9      | 2.3 / 3.2 / 5.7     | 2.0 / 2.6 / 9.1 | 1.4 / 1.7 / 4.3 |
| keystroke to screen p95          | –                 | –          | –               | 2,572             | 1,281                    | 436                   | 225                 | 106             | 55              |
| editor save                      | –                 | –          | –               | none within 180 s | none within 180 s        | 583                   | 295                 | 135             | 68              |
| Replay open                      | –                 | –          | –               | –                 | 103,218                  | 13,841                | 3,553               | 1,208           | 608             |
| Replay fps achieved (set 16.67)  | –                 | –          | –               | –                 | 0.07                     | 0.59                  | 2.96                | 11.86           | 16.68           |
| Replay slider p50 / p95 / max    | –                 | –          | –               | –                 | 17,106 / 60,740 / 60,740 | 1,973 / 6,336 / 6,336 | 494 / 1,476 / 1,476 | 124 / 362 / 362 | 43 / 118 / 118  |
| web load                         | gave up at 15.6 s | page crash | page crash      | page crash        | page crash               | page crash            | page crash          | 860             | 426             |
| web fps achieved (set 16.67)     | –                 | –          | –               | –                 | –                        | –                     | –                   | 16.59           | 16.59           |
| web scrub p50 / p95 / max        | –                 | –          | –               | –                 | –                        | –                     | –                   | 3 / 4 / 4       | 2 / 3 / 3       |
| level                            | FAIL              | FAIL       | FAIL            | FAIL              | FAIL                     | FAIL                  | FAIL                | FAIL            | PASS            |

Read the table like this:

- **The editor's typing path holds up longest.** Keystroke-to-DOM p95 is under 20 ms even at 1/8, 129 MB. Open is
  what fails first as files grow: 10 s at 1/16, and a refusal from 1/2 up.
  - At the whole text, the editor reports V8's string length limit ("Cannot create a string longer than 0x1fffffe8
    characters").
  - At 1/2, it says only that the file "could not be opened. File may be corrupted", with no cause.
- **Replay is the binding limit for the editor.** It keeps its pace only at 1/256, and at 1/128 it plays at 71% of the
  set rate.
- **The web player crashes from 16 MB (1/64) up to 500 MB (1/2),** and at the whole text it gives up cleanly. The
  cause of the crash was not established.
- **Save at 1/8 and 1/16 is "none within 180 s",** not a measured time. With keystrokes taking over a second each,
  autosaves fire during typing, and none was seen to start after the last key within the timeout.
- **The boundary lies between 1/256 and 1/128.** The search only halves, so it is not narrowed further. The level 1
  rerun failed identically. That run reran the largest failing level; the driver now reruns the smallest.

### Limits of this measurement

- **One machine, one seed, one run per level.** 1/128, the level next to the boundary, was not rerun in this run.
- **The typist is simulated at the end of the document.** Editing in the middle of a long poem is not measured.
- **Failure causes are not measured.** The apps swallow the causes of their refusals and crashes; the specs record
  what the apps show.
