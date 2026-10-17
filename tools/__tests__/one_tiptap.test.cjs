/**
 * @jest-environment node
 */
// tools/one_tiptap.cjs: the lockfile holds one TipTap, at the version the apps run (#52).
const path = require("path");
const { tiptapProblems, check } = require("../one_tiptap.cjs");

const ROOT = path.join(__dirname, "..", "..");

describe("this repository", () => {
  it("has every @tiptap package once, at the top level, at the pinned version", () => {
    const { want, seen, problems } = check(
      path.join(ROOT, "package-lock.json"),
      path.join(ROOT, "package.json"),
    );
    expect(want).toBe("2.5.4");
    // Positive control on the corpus: the lockfile does hold TipTap entries to check.
    expect(seen).toBeGreaterThan(10);
    expect(problems).toEqual([]);
  });
});

describe("tiptapProblems", () => {
  const lock = (packages) => ({ packages });

  it("accepts top-level entries at the pinned version, and ignores other packages", () => {
    expect(
      tiptapProblems(
        lock({
          "": {},
          "node_modules/@tiptap/core": { version: "2.5.4" },
          "node_modules/@tiptap/starter-kit": { version: "2.5.4" },
          "node_modules/prosemirror-model": { version: "1.25.12" },
          "node_modules/x/node_modules/prosemirror-model": { version: "1.0.0" },
          // Not TipTap, though it sits under a TipTap package.
          "node_modules/@tiptap/starter-kit/node_modules/@remirror/core-constants":
            { version: "3.0.0" },
        }),
        "2.5.4",
      ),
    ).toEqual([]);
  });

  it("refuses a TipTap nested under another package, whatever its version", () => {
    expect(
      tiptapProblems(
        lock({
          "node_modules/@tiptap/starter-kit": { version: "2.5.4" },
          "node_modules/@tiptap/starter-kit/node_modules/@tiptap/core": {
            version: "2.27.3",
          },
          "node_modules/@tiptap/starter-kit/node_modules/@tiptap/pm": {
            version: "2.5.4",
          },
        }),
        "2.5.4",
      ),
    ).toEqual([
      "@tiptap/core nested under node_modules/@tiptap/starter-kit, at 2.27.3",
      "@tiptap/pm nested under node_modules/@tiptap/starter-kit, at 2.5.4",
    ]);
  });

  it("refuses a top-level TipTap at another version", () => {
    expect(
      tiptapProblems(
        lock({ "node_modules/@tiptap/html": { version: "2.6.0" } }),
        "2.5.4",
      ),
    ).toEqual(["@tiptap/html at 2.6.0, not 2.5.4"]);
  });
});
