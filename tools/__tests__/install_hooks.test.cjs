/**
 * @jest-environment node
 */
// tools/install-hooks.cjs: a clone cannot be left without its git hooks.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureHooks, missingHooks, MARK } = require('../install-hooks.cjs');

const SCRIPT = path.join(__dirname, '..', 'install-hooks.cjs');
let work;
let repo;
let fakeBin;
let emptyBin;

// A stand-in for pre-commit: `pre-commit install` writes the three hooks the way the real one marks
// them. FAKE_PRECOMMIT=one writes only the first; FAKE_PRECOMMIT=fail writes nothing and fails.
const FAKE = `#!/bin/sh
[ "$FAKE_PRECOMMIT" = fail ] && { echo "Cowardly refusing to install hooks" >&2; exit 1; }
hooks=$(git rev-parse --git-path hooks)
mkdir -p "$hooks"
echo "# ${MARK}" > "$hooks/pre-commit"
[ "$FAKE_PRECOMMIT" = one ] || echo "# ${MARK}" > "$hooks/commit-msg"
[ "$FAKE_PRECOMMIT" = one ] || echo "# ${MARK}" > "$hooks/pre-push"
`;

beforeEach(() => {
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-')));
  repo = path.join(work, 'repo');
  fakeBin = path.join(work, 'bin');
  emptyBin = path.join(work, 'empty');
  [repo, fakeBin, emptyBin].forEach((dir) => fs.mkdirSync(dir));
  fs.writeFileSync(path.join(fakeBin, 'pre-commit'), FAKE, { mode: 0o755 });
  spawnSync('git', ['init', '-q'], { cwd: repo });
});
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

// The environment a contributor has: not CI, with the stand-in pre-commit first on PATH.
const withFake = (extra = {}) => ({
  PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`,
  ...extra,
});
const hook = (name) => path.join(repo, '.git', 'hooks', name);

describe('missingHooks', () => {
  it('names both hooks in a new clone', () => {
    expect(missingHooks(repo)).toEqual([
      'pre-commit',
      'commit-msg',
      'pre-push',
    ]);
  });

  it('does not count a hook that pre-commit did not write', () => {
    fs.mkdirSync(path.dirname(hook('pre-commit')), { recursive: true });
    fs.writeFileSync(hook('pre-commit'), '#!/bin/sh\nexit 0\n');
    expect(missingHooks(repo)).toContain('pre-commit');
  });
});

describe('ensureHooks', () => {
  it('installs both hooks in a clone that has none, and says so', () => {
    const result = ensureHooks(repo, { env: withFake() });
    expect(result).toEqual({
      ok: true,
      message: 'Installed the git hooks: pre-commit, commit-msg, pre-push.',
    });
    expect(missingHooks(repo)).toEqual([]);
  });

  it('says nothing and changes nothing when both are already installed', () => {
    ensureHooks(repo, { env: withFake() });
    const before = fs.statSync(hook('pre-commit')).mtimeMs;
    expect(ensureHooks(repo, { env: { PATH: emptyBin } })).toEqual({
      ok: true,
      message: '',
    });
    expect(fs.statSync(hook('pre-commit')).mtimeMs).toBe(before);
  });

  it('installs the one that is missing when only one is there', () => {
    ensureHooks(repo, { env: withFake() });
    fs.rmSync(hook('commit-msg'));
    expect(ensureHooks(repo, { env: withFake() }).message).toBe(
      'Installed the git hooks: commit-msg.'
    );
    expect(missingHooks(repo)).toEqual([]);
  });

  it('fails, and says how to get pre-commit, when it is not on PATH', () => {
    const result = ensureHooks(repo, { env: { PATH: emptyBin } });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('pre-commit was not found');
    expect(result.message).toContain('brew install pre-commit');
    expect(missingHooks(repo)).toHaveLength(3);
  });

  it('fails with pre-commit’s own words when the install fails', () => {
    const result = ensureHooks(repo, {
      env: withFake({ FAKE_PRECOMMIT: 'fail' }),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Cowardly refusing');
  });

  it('fails when the install leaves a hook missing, naming it', () => {
    const result = ensureHooks(repo, {
      env: withFake({ FAKE_PRECOMMIT: 'one' }),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('missing: commit-msg, pre-push');
  });

  it('with checkOnly, installs nothing and says what to run', () => {
    const result = ensureHooks(repo, { env: withFake(), checkOnly: true });
    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      'missing: pre-commit, commit-msg, pre-push'
    );
    expect(result.message).toContain('node tools/install-hooks.cjs');
    expect(missingHooks(repo)).toHaveLength(3);
  });

  it('does nothing in CI, which runs the checks itself', () => {
    expect(ensureHooks(repo, { env: withFake({ CI: 'true' }) })).toEqual({
      ok: true,
      message: '',
    });
    expect(missingHooks(repo)).toHaveLength(3);
  });

  it('does nothing where there is no clone', () => {
    const plain = path.join(work, 'plain');
    fs.mkdirSync(plain);
    // GIT_CEILING_DIRECTORIES is not needed: the temporary directory is outside any repository.
    expect(ensureHooks(plain, { env: withFake() })).toEqual({
      ok: true,
      message: '',
    });
  });

  it('does nothing in a directory that is inside some other repository', () => {
    const inner = path.join(repo, 'vendored');
    fs.mkdirSync(inner);
    expect(ensureHooks(inner, { env: withFake() })).toEqual({
      ok: true,
      message: '',
    });
    expect(missingHooks(repo)).toHaveLength(3);
  });

  it('installs into the shared hooks directory from a worktree', () => {
    const run = (args) => spawnSync('git', args, { cwd: repo });
    run([
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'first',
    ]);
    const tree = path.join(work, 'tree');
    run(['worktree', 'add', '-q', tree]);
    expect(ensureHooks(tree, { env: withFake() }).ok).toBe(true);
    expect(missingHooks(tree)).toEqual([]);
    expect(missingHooks(repo)).toEqual([]);
  });
});

describe('the command', () => {
  it('this clone has its hooks, or this is CI', () => {
    // The script checks the repository it lives in. Run under jest, that is this clone, where
    // globalSetup has already refused to start if the hooks were missing.
    const result = spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
  });
});
