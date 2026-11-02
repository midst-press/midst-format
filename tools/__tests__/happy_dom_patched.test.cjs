/**
 * @jest-environment node
 */
// Every happy-dom in the lockfile is 21.0.4 or later (#113, GitHub alerts #4, #5). It parses the poem HTML that
// convert and @tiptap/html/server read, which comes from files the poet opens. A copy below 21.0.4 can also arrive
// nested, through a dependency's own range, so every entry is checked, not only the top level.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PATCHED = [21, 0, 4];

const atLeast = (version, floor) => {
  const parts = version.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < 3; i += 1) if (parts[i] !== floor[i]) return parts[i] > floor[i];
  return true;
};

describe("happy-dom", () => {
  it("is 21.0.4 or later wherever the lockfile installs it", () => {
    const { packages } = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
    const found = Object.entries(packages)
      .filter(([where]) => where === "node_modules/happy-dom" || where.endsWith("/node_modules/happy-dom"))
      .map(([where, entry]) => [where, entry.version]);
    // Positive control: the lockfile does install happy-dom, so an empty list cannot pass.
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter(([, version]) => !atLeast(version, PATCHED))).toEqual([]);
  });

  it("compares versions numerically", () => {
    expect(atLeast("21.0.4", PATCHED)).toBe(true);
    expect(atLeast("21.0.10", PATCHED)).toBe(true);
    expect(atLeast("22.0.0", PATCHED)).toBe(true);
    expect(atLeast("21.0.3", PATCHED)).toBe(false);
    expect(atLeast("20.14.6", PATCHED)).toBe(false);
  });
});
