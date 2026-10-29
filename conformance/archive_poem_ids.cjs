// Which published poem each archive poem is, by poemId (midst-editor #350), so a ranking by archive index can be
// named from the published list.
//
//   node conformance/archive_poem_ids.cjs <archive dir> <published dir>
//
//   <archive dir>    the corpus glide_estimate.cjs reads; a poem's index is its place in the same sorted order.
//   <published dir>  staged timelapses, each <poemId>/timelapse.midst.zip, as midst-web's canonical key scheme
//                    names them.
//
// Neither the titles nor the zips can join the two: every archive meta.title is a placeholder, and no published zip
// hashes the same as an archive zip. So a poem is matched by:
//   1. content: the .midst inside the zip, byte for byte, so only the wrapping differed; else
//   2. history: the number of changes and the first and last change's time, from the converted history.
// A poem with no match is unmatched. One that matches more than one poemId, or shares its poemId with another archive
// poem, is ambiguous, and so is every archive poem in that clash.
//
// NO POEM DATA ON STDOUT (midst-format #7, #41): archive indexes, poemIds and counts only.
const fs = require("fs"),
  path = require("path");
const { archiveZips, readPoem } = require("./glide_estimate.cjs");

// A random version-4 UUID, lower case, as midst-web's key-scheme.js checks a poemId.
const ID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Each <poemId>/timelapse.midst.zip under the published directory, in poemId order. */
function publishedZips(dir) {
  const found = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "timelapse.midst.zip") {
        const poemId = path.basename(d);
        if (ID_SHAPE.test(poemId)) found.push({ poemId, zip: p });
      }
    }
  })(dir);
  return found.sort((a, b) => (a.poemId < b.poemId ? -1 : 1));
}

/** The history's number of changes and its first and last times, as one key. */
function historyKey(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  return `${history.length}|${String(history[0].t)}|${String(history[history.length - 1].t)}`;
}

/** Which keys of an index point at exactly one value, and which at more. */
function byKey(rows, key) {
  const map = new Map();
  for (const r of rows) {
    const k = r[key];
    if (k === null) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r.poemId);
  }
  return map;
}

/**
 * Match archive poems to poemIds.
 * @param {{index: number, midstHash: string, historyKey: string|null}[]} archive
 * @param {{poemId: string, midstHash: string, historyKey: string|null}[]} published
 */
function match(archive, published) {
  const content = byKey(published, "midstHash");
  const history = byKey(published, "historyKey");
  const results = archive.map((a) => {
    const byContent = content.get(a.midstHash) ?? [];
    if (byContent.length === 1)
      return { index: a.index, poemId: byContent[0], how: "content" };
    if (byContent.length > 1)
      return { index: a.index, poemId: null, how: "ambiguous" };
    const byHistory =
      a.historyKey === null ? [] : (history.get(a.historyKey) ?? []);
    if (byHistory.length === 1)
      return { index: a.index, poemId: byHistory[0], how: "history" };
    if (byHistory.length > 1)
      return { index: a.index, poemId: null, how: "ambiguous" };
    return { index: a.index, poemId: null, how: "unmatched" };
  });
  // A poemId claimed by two archive poems names neither of them.
  const claims = new Map();
  for (const r of results)
    if (r.poemId) claims.set(r.poemId, (claims.get(r.poemId) ?? 0) + 1);
  return results.map((r) =>
    r.poemId && claims.get(r.poemId) > 1
      ? { index: r.index, poemId: null, how: "ambiguous" }
      : r,
  );
}

function main(
  argv,
  { convertMidstFile = null, log = console.log, err = console.error } = {},
) {
  const [archiveDir, publishedDir] = argv;
  if (
    !archiveDir ||
    !publishedDir ||
    !fs.existsSync(archiveDir) ||
    !fs.existsSync(publishedDir)
  ) {
    err(
      "usage: node conformance/archive_poem_ids.cjs <archive dir> <published dir>",
    );
    return 2;
  }
  const zips = archiveZips(archiveDir);
  const staged = publishedZips(publishedDir);
  if (zips.length === 0 || staged.length === 0) {
    err(
      `found ${zips.length} archive poem(s) and ${staged.length} published timelapse(s); both are needed`,
    );
    return 2;
  }
  // Required where used, so a usage error is reported without a built harness; a test passes its own.
  const convert =
    convertMidstFile ?? require("../out/converter.cjs").convertMidstFile;
  const failed = [];
  const read = (zip, label) => {
    try {
      const { history, midstHash } = readPoem(zip, convert);
      return { midstHash, historyKey: historyKey(history) };
    } catch (error) {
      // The error's class only: a message may quote the file.
      failed.push(`${label} not read (${error?.constructor?.name ?? "Error"})`);
      return null;
    }
  };
  const archive = [];
  zips.forEach((zip, i) => {
    const r = read(zip, `archive #${i + 1}`);
    if (r) archive.push({ index: i + 1, ...r });
  });
  const published = [];
  for (const { poemId, zip } of staged) {
    const r = read(zip, `published ${poemId}`);
    if (r) published.push({ poemId, ...r });
  }

  const results = match(archive, published);
  const count = (how) => results.filter((r) => r.how === how).length;
  log(
    `archive poems ${zips.length}, published timelapses ${staged.length}, could not be read ${failed.length}`,
  );
  for (const f of failed) log(`  ${f}`);
  log(
    `matched ${count("content") + count("history")} (by content ${count("content")}, by history ${count("history")}), ambiguous ${count("ambiguous")}, unmatched ${count("unmatched")}`,
  );
  log("");
  for (const r of results)
    log(
      r.poemId
        ? `#${r.index} -> ${r.poemId} (${r.how})`
        : `#${r.index} ${r.how}`,
    );
  return failed.length ? 1 : 0;
}

module.exports = { match, historyKey, publishedZips, main };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
