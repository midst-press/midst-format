// Parity (midst-format #50, docs/LIBRARY.md): the library's convertMidstFile (dist/convert/index.cjs, built from
// src/) must give the same output as the editor's (out/converter.cjs, built from the editor checkout by
// build:harness), for every input verify_all.cjs reads.
//
//   MIDST_CORPUS=<dir of .midst.zip> node conformance/parity.cjs
//
// The inputs are read by verifyZip (verify_lib.cjs), the code verify_all uses, with a converter that runs both and
// remembers what each gave. The two outputs are compared in-process as exact strings and never printed.
// NOTHING PRINTED MAY BE POEM DATA: one line per poem, its index and agree or DIFFER, then counts. No hash, no
// length, no text, no title, no file name (a short frame's hash can be reversed by guessing; see no_text_cases.cjs).
const fs = require("fs"),
  os = require("os"),
  path = require("path");
const { verifyZip } = require("./verify_lib.cjs");

// What a converter did with one input: its output, or the NAME of what it threw (never the message).
const attempt = (convert, input) => {
  try {
    return { threw: false, output: convert(input) };
  } catch (e) {
    return { threw: true, name: String((e && e.name) || typeof e), error: e };
  }
};
const same = (a, b) =>
  a.threw && b.threw
    ? a.name === b.name
    : !a.threw && !b.threw && a.output === b.output;

// Runs both converters over every zip. Returns one entry per zip: { index, agree, compared }. `compared` is false
// when the zip was never read as far as the converter, which counts as a DIFFER: nothing was shown to agree.
function runParity(zips, { editorConvert, libConvert, normalise }) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "midst-parity-"));
  try {
    return zips.map((zip, i) => {
      let result = null;
      const both = (input) => {
        const editor = attempt(editorConvert, input);
        const lib = attempt(libConvert, input);
        result = same(editor, lib);
        // verifyZip wants a conversion or a throw; what it makes of the row is not this check's business.
        if (editor.threw) throw editor.error;
        if (lib.threw) throw lib.error;
        return editor.output;
      };
      verifyZip(zip, i + 1, { convertMidstFile: both, normalise, outDir });
      return {
        index: i + 1,
        agree: result === true,
        compared: result !== null,
      };
    });
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

const line = (r) =>
  `#${String(r.index).padStart(2, "0")} ${r.agree ? "agree" : "DIFFER"}`;

function summarise(results) {
  const agree = results.filter((r) => r.agree).length;
  const notCompared = results.filter((r) => !r.compared).length;
  const differ = results.length - agree;
  return {
    agree,
    differ,
    notCompared,
    total: results.length,
    exitCode: results.length > 0 && differ === 0 ? 0 : 1,
  };
}

function findZips(corpus) {
  const zips = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".midst.zip")) zips.push(p);
    }
  })(corpus);
  return zips.sort();
}

function main() {
  const corpus = process.env.MIDST_CORPUS;
  if (!corpus) {
    console.log(
      "MIDST_CORPUS is not set. Point it at a directory of .midst.zip files.",
    );
    return 2;
  }
  const editorPath = path.join(__dirname, "..", "out", "converter.cjs");
  const libPath = path.join(__dirname, "..", "dist", "convert", "index.cjs");
  for (const [what, p, how] of [
    ["editor build", editorPath, "npm run build:harness"],
    ["library build", libPath, "npm run build:lib"],
  ]) {
    if (!fs.existsSync(p)) {
      console.log(
        `parity: ${what} missing (${path.relative(path.join(__dirname, ".."), p)}); run ${how}`,
      );
      return 2;
    }
  }
  const results = runParity(findZips(corpus), {
    editorConvert: require(editorPath).convertMidstFile,
    libConvert: require(libPath).convertMidstFile,
    normalise: require("./normalise.cjs").normalise,
  });
  for (const r of results) console.log(line(r));
  const s = summarise(results);
  console.log(
    `\nagree ${s.agree}   DIFFER ${s.differ}   of ${s.total}   (never compared: ${s.notCompared})`,
  );
  if (s.total === 0) console.log("parity FAILED: no poems to compare");
  return s.exitCode;
}

module.exports = { runParity, summarise, line, attempt, same };

if (require.main === module) {
  // An uncaught error is logged by class, never printed with its message (log.cjs).
  require("./log.cjs").installUncaughtHandler();
  process.exitCode = main();
}
