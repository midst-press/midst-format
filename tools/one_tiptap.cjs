// One TipTap in the lockfile, at the version the apps run (#52). A copy nested under another package
// would run a different TipTap from the editor's and web's while every check here still passed: the
// oracle would be checking a schema the apps do not use. Run by its test in `npm test`.
const fs = require("fs");

// Every @tiptap/* entry in a package-lock (v2/v3) that is not at the top of node_modules, and every
// top-level one at a version other than `want`.
function tiptapProblems(lock, want) {
  const problems = [];
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    // The package is whatever follows the last node_modules/: a key can hold several.
    const at = key.lastIndexOf("node_modules/");
    const name = key.slice(at + "node_modules/".length);
    if (at === -1 || !name.startsWith("@tiptap/")) continue;
    if (at !== 0)
      problems.push(
        `${name} nested under ${key.slice(0, at - 1)}, at ${entry.version}`,
      );
    else if (entry.version !== want)
      problems.push(`${name} at ${entry.version}, not ${want}`);
  }
  return problems;
}

function check(lockPath, packagePath) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const want = pkg.dependencies["@tiptap/core"];
  const seen = Object.keys(lock.packages || {}).filter((k) =>
    /(^|\/)node_modules\/@tiptap\/[^/]+$/.test(k),
  ).length;
  return { want, seen, problems: tiptapProblems(lock, want) };
}

module.exports = { tiptapProblems, check };
