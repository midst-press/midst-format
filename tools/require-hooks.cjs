// jest's globalSetup: the tests do not run in a clone whose git hooks are missing.
// See tools/install-hooks.cjs for why, and for the two cases (CI, not a clone) where this passes.
const path = require('path');
const { ensureHooks } = require('./install-hooks.cjs');

module.exports = async () => {
  const result = ensureHooks(path.join(__dirname, '..'), { checkOnly: true });
  if (!result.ok) throw new Error(result.message);
};
