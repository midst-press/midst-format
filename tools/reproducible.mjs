// The apps rebuild a tag and compare it byte for byte with what they vendored (midst-format #50,
// docs/LIBRARY.md), so building the same commit twice must give the same bytes.
//
//   node tools/reproducible.mjs
//
// Builds twice into two fresh temporary directories and compares every file. Prints the number of files compared
// and the number that differ, and the names of those (code paths, never data).
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

const filesUnder = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();

// Compares two directories file by file. A file in one and not the other differs.
export function compareDirs(a, b) {
  const names = [...new Set([...filesUnder(a), ...filesUnder(b)])].sort();
  const differing = names.filter((n) => {
    const pa = path.join(a, n);
    const pb = path.join(b, n);
    return (
      !fs.existsSync(pa) ||
      !fs.existsSync(pb) ||
      !fs.readFileSync(pa).equals(fs.readFileSync(pb))
    );
  });
  return { compared: names.length, differing };
}

function main(build = path.join(here, "build-lib.mjs")) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "midst-repro-"));
  try {
    const out = [path.join(tmp, "one"), path.join(tmp, "two")];
    for (const dir of out)
      execFileSync(process.execPath, [build, "--out", dir], {
        stdio: ["ignore", "ignore", "inherit"],
      });
    const { compared, differing } = compareDirs(out[0], out[1]);
    console.log(
      `reproducible: ${compared} files compared, ${differing.length} differ`,
    );
    for (const n of differing) console.log(`  differs: ${n}`);
    if (compared === 0) {
      console.log("reproducible FAILED: the build produced no files");
      return 1;
    }
    console.log(differing.length ? "reproducible FAILED" : "reproducible OK");
    return differing.length ? 1 : 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.log(
      `reproducible FAILED: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exitCode = 1;
  }
}
