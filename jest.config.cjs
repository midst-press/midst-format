// Unit tests: the suite's own self-tests (.cjs) and the library's ported tests (src/__tests__, TypeScript). The
// conformance runs (verify_all, render_lines, shapes_fuzz, markloss, coverage) are Node scripts run against a
// corpus, and are not collected here.
const selfTests = {
  displayName: "self-tests",
  testEnvironment: "node",
  testMatch: [
    "<rootDir>/conformance/**/*.test.cjs",
    "<rootDir>/tools/**/*.test.cjs",
  ],
  // The tests do not run in a clone whose git hooks are missing (tools/install-hooks.cjs).
  globalSetup: "<rootDir>/tools/require-hooks.cjs",
  // dist/ holds a package.json of the same name as the root's.
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
};

// The tests ported from midst-editor with the code they test (midst-format #50, docs/LIBRARY.md).
const libraryTests = {
  displayName: "library",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/__tests__/*.test.ts"],
  transform: {
    "\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }],
  },
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
};

module.exports = {
  projects: [selfTests, libraryTests],
  coverageProvider: "v8",
  // The error log's allowlist is what keeps poem text out of stderr, so every line of it is covered (#38). src/ is
  // measured and reported, with no threshold yet.
  collectCoverageFrom: ["conformance/log.cjs", "src/*.ts"],
  // Its own directory: coverage/ also holds coverage.cjs's converter report, which this must never overwrite.
  coverageDirectory: "coverage/jest",
  coverageThreshold: {
    "./conformance/log.cjs": {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};
