// The moved code is the editor's code (midst-format #50, docs/LIBRARY.md). For each file in each move of
// src/MOVED_FROM.json, the top-level statements of src/<file> must equal those of the editor's file at that
// move's commit, byte for byte, imports aside. This is the only check on `step` and `reconstruct*`, which
// the conformance corpus never calls.
//
//   MIDST_EDITOR_SRC=<editor clone> node tools/verbatim.mjs [--root <format root>] [--ref <editor ref>]
//
// Statements are compared with their leading comments and blank lines, so a comment edit fails too. Only
// statement indexes and declared names are printed: a name is code, never a poem.
import fs from "fs";
import path from "path";
import ts from "typescript";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

function declaredName(stmt) {
  if (ts.isVariableStatement(stmt))
    return stmt.declarationList.declarations
      .map((d) => d.name.getText())
      .join(",");
  if (ts.isExportAssignment(stmt)) return "default";
  if (stmt.name) return stmt.name.getText();
  return ts.SyntaxKind[stmt.kind];
}

// The statements of `text` as { name, text }, imports dropped and `exclude` names dropped. The end of the
// file is a statement too, so a change to what trails the last one is seen.
export function statementsOf(text, exclude = []) {
  const sf = ts.createSourceFile(
    "x.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const out = [];
  const seen = new Set();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) continue;
    const name = declaredName(stmt);
    if (exclude.includes(name)) {
      seen.add(name);
      continue;
    }
    out.push({ name, text: text.slice(stmt.pos, stmt.end) });
  }
  const missing = exclude.filter((n) => !seen.has(n));
  out.push({ name: "<end of file>", text: text.slice(sf.endOfFileToken.pos) });
  return { statements: out, missingExcluded: missing };
}

// Compares two statement lists. Returns the number compared and the mismatches (index and name only).
export function compareStatements(editor, ours) {
  const problems = [];
  const n = Math.min(editor.length, ours.length);
  for (let i = 0; i < n; i++) {
    if (editor[i].text !== ours[i].text) {
      problems.push(
        `statement ${i} (${editor[i].name}${editor[i].name === ours[i].name ? "" : ` vs ${ours[i].name}`}) differs`,
      );
    }
  }
  if (editor.length !== ours.length) {
    problems.push(
      `statement counts differ: editor ${editor.length}, ours ${ours.length}`,
    );
  }
  return { compared: n, problems };
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const editorRoot = process.env.MIDST_EDITOR_SRC;
  if (!editorRoot) {
    console.log(
      "MIDST_EDITOR_SRC is not set: point it at a midst-editor checkout.",
    );
    return 2;
  }
  const root = path.resolve(argValue("--root") ?? path.join(here, ".."));
  const ref = argValue("--ref") ?? "origin/main";
  const moved = JSON.parse(
    fs.readFileSync(path.join(root, "src", "MOVED_FROM.json"), "utf8"),
  );
  const git = (...args) =>
    execFileSync("git", ["-C", editorRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  // Each move names the editor commit its files came from. The files of an earlier move may be gone from the
  // editor since, so one commit cannot stand for all of them.
  const entries = (moved.moves ?? []).flatMap((move) =>
    Object.entries(move.files ?? {}).map(([ours, theirs]) => ({
      ours,
      theirs,
      commit: move.editorCommit,
      exclude:
        ours === "src/convert.ts" ? (move.excludedFromConvert ?? []) : [],
    })),
  );
  if (entries.length === 0) {
    console.log("verbatim: MOVED_FROM.json lists no files");
    return 1;
  }
  const uncommitted = entries.filter((e) => typeof e.commit !== "string");
  if (uncommitted.length) {
    console.log(
      `verbatim: MOVED_FROM.json names no editor commit for ${uncommitted.map((e) => e.ours).join(", ")}`,
    );
    return 1;
  }

  let failed = 0;
  for (const { ours, theirs, commit, exclude } of entries) {
    const editorText = git("show", `${commit}:${theirs}`);
    const e = statementsOf(editorText, exclude);
    const o = statementsOf(fs.readFileSync(path.join(root, ours), "utf8"));
    const r = compareStatements(e.statements, o.statements);
    // An exclusion that matches nothing would drop nothing and look like a pass.
    if (e.missingExcluded.length)
      r.problems.push(
        `excluded names not found in the editor file: ${e.missingExcluded.join(", ")}`,
      );
    console.log(
      `${ours} <- ${theirs} at ${commit}: ${r.compared} statements compared (${exclude.length} excluded), ${r.problems.length} problems`,
    );
    for (const p of r.problems) console.log(`  ${p}`);
    if (r.problems.length) failed++;
  }

  // Drift is information, not a failure: the editor moving on is for a later stage to take up.
  for (const { theirs, commit } of entries) {
    try {
      const changed =
        git("diff", "--name-only", commit, ref, "--", theirs).trim() !== "";
      console.log(
        `drift: ${theirs} ${changed ? `DIFFERS at ${ref}` : `unchanged at ${ref}`}`,
      );
    } catch {
      console.log(
        `drift: ${theirs} not checked (${ref} not readable in the editor clone)`,
      );
    }
  }
  console.log(
    failed
      ? `verbatim FAILED: ${failed} of ${entries.length} files differ`
      : `verbatim OK: ${entries.length} files match`,
  );
  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main();
  } catch (e) {
    console.log(
      `verbatim FAILED: ${e instanceof Error ? e.message : String(e)}`,
    );
    process.exitCode = 1;
  }
}
