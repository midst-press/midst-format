// Unit tests: the suite's own self-tests. The conformance runs (verify_all, render_lines, shapes_fuzz,
// markloss, coverage) are Node scripts run against a corpus, and are not collected here.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/conformance/**/*.test.cjs', '<rootDir>/tools/**/*.test.cjs'],
  // The tests do not run in a clone whose git hooks are missing (tools/install-hooks.cjs).
  globalSetup: '<rootDir>/tools/require-hooks.cjs',
  coverageProvider: 'v8',
};
