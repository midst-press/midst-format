import { buildLabel, isPreRelease, utcMinute } from '../buildLabel';

describe('buildLabel', () => {
  const commit = 'a1b2c3d';
  const committedAt = '2026-10-13T20:30:00Z';

  it('names the tag, the commit and when it was committed', () => {
    expect(buildLabel({ tag: 'v0.3.0-beta.1', commit, committedAt })).toBe(
      'Version v0.3.0-beta.1, commit a1b2c3d, committed 2026-10-13 20:30 UTC'
    );
  });

  it('says so when the build has no tag', () => {
    expect(buildLabel({ commit, committedAt })).toBe(
      'Untagged build, commit a1b2c3d, committed 2026-10-13 20:30 UTC'
    );
  });

  it('is a development build when it was told nothing', () => {
    expect(buildLabel({})).toBe('Development build');
    expect(buildLabel({ tag: '', commit: ' ', committedAt: '\t' })).toBe(
      'Development build'
    );
  });

  it('leaves out a part it was not given', () => {
    expect(buildLabel({ tag: 'v0.3.0' })).toBe('Version v0.3.0');
    expect(buildLabel({ tag: 'v0.3.0', commit })).toBe(
      'Version v0.3.0, commit a1b2c3d'
    );
    expect(buildLabel({ committedAt })).toBe(
      'Untagged build, committed 2026-10-13 20:30 UTC'
    );
    expect(buildLabel({ tag: ' ', commit, committedAt: '' })).toBe(
      'Untagged build, commit a1b2c3d'
    );
  });

  it('prints the tag and a dirty commit exactly as given, without the spaces around them', () => {
    expect(
      buildLabel({ tag: ' v1.0.0-rc.1 ', commit: ' a1b2c3d-dirty ' })
    ).toBe('Version v1.0.0-rc.1, commit a1b2c3d-dirty');
  });

  it('shows the date in UTC whatever zone it was written in', () => {
    expect(
      buildLabel({ commit, committedAt: '2026-10-14T09:30:00+13:00' })
    ).toBe('Untagged build, commit a1b2c3d, committed 2026-10-13 20:30 UTC');
  });

  it('shows a date it cannot read as it was given', () => {
    expect(buildLabel({ commit, committedAt: 'zq not a date' })).toBe(
      'Untagged build, commit a1b2c3d, committed zq not a date'
    );
  });
});

describe('utcMinute', () => {
  it('pads every part to two digits', () => {
    expect(utcMinute('2026-01-02T03:04:59Z')).toBe('2026-01-02 03:04 UTC');
  });

  it('crosses a year boundary with the zone', () => {
    expect(utcMinute('2027-01-01T00:30:00+01:00')).toBe('2026-12-31 23:30 UTC');
  });

  it('is undefined for what is not a date', () => {
    expect(utcMinute('zq')).toBeUndefined();
    expect(utcMinute('')).toBeUndefined();
  });
});

describe('isPreRelease', () => {
  it.each(['v0.2.1', 'v0.0.0', 'v0.3.0-beta.1', 'v0.10.0'])(
    '%s is a pre-release: everything before 1.0 is',
    (tag) => expect(isPreRelease(tag)).toBe(true)
  );

  it.each(['v1.0.0-dev.3', 'v1.2.3-beta.1', 'v2.0.0-rc.1', 'v10.0.0-rc1'])(
    '%s is a pre-release: it has a suffix',
    (tag) => expect(isPreRelease(tag)).toBe(true)
  );

  it.each(['v1.0.0', 'v1.2.3', 'v10.0.0', 'v2.10.7'])(
    '%s is a full release',
    (tag) => expect(isPreRelease(tag)).toBe(false)
  );

  it.each([
    '1.0.0',
    'v1.0',
    'v1.0.0.0',
    'v1.0.0-',
    'v1.0.0 ',
    'V1.0.0',
    'v1.0.0+build',
    'release',
    '',
    'v01.0.0x',
  ])(
    '"%s" is not a tag this rule knows, so it is never a full release',
    (tag) => expect(isPreRelease(tag)).toBe(true)
  );
});
