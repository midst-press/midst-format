// Unit tests: the suite's own self-tests. The conformance runs (verify_all, render_lines, shapes_fuzz,
// markloss, coverage) are Node scripts run against a corpus, and are not collected here.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/conformance/**/*.test.cjs', '<rootDir>/tools/**/*.test.cjs'],
  // The tests do not run in a clone whose git hooks are missing (tools/install-hooks.cjs).
  globalSetup: '<rootDir>/tools/require-hooks.cjs',
  coverageProvider: 'v8',
  // The error log's allowlist is what keeps poem text out of stderr, so every line of it is covered (#38).
  collectCoverageFrom: ['conformance/log.cjs'],
  // Its own directory: coverage/ also holds coverage.cjs's converter report, which this must never overwrite.
  coverageDirectory: 'coverage/jest',
  coverageThreshold: { './conformance/log.cjs': { branches: 100, functions: 100, lines: 100, statements: 100 } },
};
