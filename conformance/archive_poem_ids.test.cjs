// Archive poems matched to published poemIds (midst-editor #350): each rule of the match, and that a run prints
// only indexes, poemIds and counts.
//
//   npm test
//
// Needs the `zip` command. It does not need the harness built from midst-editor: a stand-in converter is used.
const fs = require("fs"),
  path = require("path"),
  os = require("os");
const { execFileSync } = require("child_process");
const { match, historyKey, main } = require("./archive_poem_ids.cjs");

const ID_A = "0a1b2c3d-1111-4222-8333-444455556666";
const ID_B = "9f8e7d6c-1111-4222-9333-444455556666";
const ID_C = "aaaaaaaa-1111-4222-a333-444455556666";

test("a history is keyed by its number of changes and its first and last times", () => {
  const t0 = "2020-01-01T00:00:00.000Z",
    t1 = "2020-01-02T00:00:00.000Z";
  expect(historyKey([{ t: t0 }, { t: "x" }, { t: t1 }])).toBe(`3|${t0}|${t1}`);
  expect(historyKey([])).toBeNull();
  expect(historyKey(undefined)).toBeNull();
});

test("the same .midst inside matches by content, before history is looked at", () => {
  const r = match(
    [{ index: 1, midstHash: "h1", historyKey: "k9" }],
    [
      { poemId: ID_A, midstHash: "h1", historyKey: "k1" },
      { poemId: ID_B, midstHash: "h2", historyKey: "k9" },
    ],
  );
  expect(r).toEqual([{ index: 1, poemId: ID_A, how: "content" }]);
});

test("different bytes with the same history match by history", () => {
  const r = match(
    [{ index: 2, midstHash: "hx", historyKey: "k1" }],
    [{ poemId: ID_A, midstHash: "h1", historyKey: "k1" }],
  );
  expect(r).toEqual([{ index: 2, poemId: ID_A, how: "history" }]);
});

test("no match is unmatched, and a poem with no history is never matched by history", () => {
  const r = match(
    [
      { index: 3, midstHash: "hx", historyKey: "k2" },
      { index: 4, midstHash: "hy", historyKey: null },
    ],
    [
      { poemId: ID_A, midstHash: "h1", historyKey: "k1" },
      { poemId: ID_B, midstHash: "h2", historyKey: null },
    ],
  );
  expect(r.map((x) => x.how)).toEqual(["unmatched", "unmatched"]);
});

test("two published poems with the same content or history leave the archive poem ambiguous", () => {
  const r = match(
    [
      { index: 5, midstHash: "h1", historyKey: "k5" },
      { index: 6, midstHash: "hz", historyKey: "k2" },
    ],
    [
      { poemId: ID_A, midstHash: "h1", historyKey: "k1" },
      { poemId: ID_B, midstHash: "h1", historyKey: "k2" },
      { poemId: ID_C, midstHash: "h3", historyKey: "k2" },
    ],
  );
  expect(r).toEqual([
    { index: 5, poemId: null, how: "ambiguous" },
    { index: 6, poemId: null, how: "ambiguous" },
  ]);
});

test("two archive poems claiming one poemId name neither", () => {
  const r = match(
    [
      { index: 7, midstHash: "h1", historyKey: "k7" },
      { index: 8, midstHash: "hq", historyKey: "k1" },
      { index: 9, midstHash: "h2", historyKey: "k9" },
    ],
    [
      { poemId: ID_A, midstHash: "h1", historyKey: "k1" },
      { poemId: ID_B, midstHash: "h2", historyKey: "k2" },
    ],
  );
  expect(r).toEqual([
    { index: 7, poemId: null, how: "ambiguous" },
    { index: 8, poemId: null, how: "ambiguous" },
    { index: 9, poemId: ID_B, how: "content" },
  ]);
});

test("a run matches real zips, numbers the archive as glide_estimate does, and prints no poem data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "midst-ids-test-"));
  try {
    // Two archive poems: the first published byte for byte, the second published re-exported (other bytes,
    // same history). A third published poem matches nothing in the archive.
    const zipOf = (zipPath, name, body) => {
      const midst = path.join(dir, name);
      fs.writeFileSync(midst, body);
      fs.mkdirSync(path.dirname(zipPath), { recursive: true });
      execFileSync("zip", ["-q", "-j", zipPath, midst]);
      fs.rmSync(midst);
    };
    const archive = path.join(dir, "archive");
    const published = path.join(dir, "published");
    zipOf(
      path.join(archive, "MARKERPOET", "AMARKERPOEM.midst.zip"),
      "AMARKERPOEM.midst",
      '{"poem":"one"}',
    );
    zipOf(
      path.join(archive, "MARKERPOET", "BMARKERPOEM.midst.zip"),
      "BMARKERPOEM.midst",
      '{"poem":"two"}',
    );
    zipOf(
      path.join(published, ID_B, "timelapse.midst.zip"),
      "x.midst",
      '{"poem":"one"}',
    );
    zipOf(
      path.join(published, ID_A, "timelapse.midst.zip"),
      "y.midst",
      '{"poem":"two","re":"exported"}',
    );
    zipOf(
      path.join(published, ID_C, "timelapse.midst.zip"),
      "z.midst",
      '{"poem":"three"}',
    );
    // The stand-in converter gives each poem its own history from what the file says.
    const histories = {
      one: [{ t: "T1", inserted: "MARKERTEXT" }],
      two: [{ t: "T2" }, { t: "T3" }],
      three: [{ t: "T4" }],
    };
    const convertMidstFile = (text) =>
      JSON.stringify({
        text: "MARKERTEXT",
        history: histories[JSON.parse(text).poem],
        meta: { title: "MARKERTITLE" },
      });
    const out = [];
    const rc = main([archive, published], {
      convertMidstFile,
      log: (...a) => out.push(a.join(" ")),
      err: (...a) => out.push(a.join(" ")),
    });
    const printed = out.join("\n");
    expect(rc).toBe(0);
    expect(printed).toContain(`#1 -> ${ID_B} (content)`);
    expect(printed).toContain(`#2 -> ${ID_A} (history)`);
    expect(printed).toContain(
      "matched 2 (by content 1, by history 1), ambiguous 0, unmatched 0",
    );
    for (const marker of [
      "MARKERTITLE",
      "MARKERPOET",
      "MARKERPOEM",
      "MARKERTEXT",
    ])
      expect(printed).not.toContain(marker);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("missing directories are a usage error", () => {
  const out = [];
  expect(main([], { log: (m) => out.push(m), err: (m) => out.push(m) })).toBe(
    2,
  );
  expect(
    main(["/nonexistent-a", "/nonexistent-b"], {
      log: (m) => out.push(m),
      err: (m) => out.push(m),
    }),
  ).toBe(2);
});
