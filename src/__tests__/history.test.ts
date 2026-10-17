/** @jest-environment node */
import {
  ChangeObj,
  compareStrings,
  reconstruct,
  reconstructArray,
  reconstructHTML,
  step,
} from '../history';

// Synthetic strings only: invented words, never a poem.

const T = new Date('2020-11-20T20:43:29.127Z');

/** Builds the history for a sequence of states, starting from the empty string. */
const buildHistory = (states: string[]): ChangeObj[] =>
  states.map((s, i) => compareStrings(i === 0 ? '' : states[i - 1], s, 0));

/** Applies every change in order, returning the text after each one. */
const replayAll = (changes: ChangeObj[]): string[] =>
  changes.map((_, i) => reconstruct('', changes, i));

describe('compareStrings change object', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(T);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('describes a pure insertion at the end', () => {
    expect(compareStrings('zq', 'zqxv', 7)).toEqual({
      front: 2,
      inserted: 'xv',
      end: 0,
      t: T,
      pos: 7,
    });
  });

  it('describes a pure insertion at the start', () => {
    expect(compareStrings('xv', 'zqxv', 0)).toEqual({
      front: 0,
      inserted: 'zq',
      end: 2,
      t: T,
      pos: 0,
    });
  });

  it('describes a pure deletion in the middle', () => {
    expect(compareStrings('zqxvab', 'zqab', 2)).toEqual({
      front: 2,
      inserted: '',
      end: 2,
      t: T,
      pos: 2,
    });
  });

  it('describes a replacement', () => {
    expect(compareStrings('zq-ab', 'zq+++ab', 3)).toEqual({
      front: 2,
      inserted: '+++',
      end: 2,
      t: T,
      pos: 3,
    });
  });

  it('describes the first change from empty text', () => {
    expect(compareStrings('', 'zq', 2)).toEqual({
      front: 0,
      inserted: 'zq',
      end: 0,
      t: T,
      pos: 2,
    });
  });

  it('describes an unchanged state as a change that keeps the whole text', () => {
    expect(compareStrings('zq', 'zq', 5)).toEqual({
      front: 2,
      inserted: '',
      end: 0,
      t: T,
      pos: 5,
    });
  });

  it('stamps the time the change was made', () => {
    const change = compareStrings('zq', 'zqx', 0);
    expect(change.t).toBeInstanceOf(Date);
    expect(change.t.getTime()).toBe(T.getTime());
  });
});

describe('step', () => {
  it('replaces the span between front and end with the inserted text', () => {
    expect(step('zq-ab', { front: 2, inserted: 'xv', end: 2, t: T })).toBe(
      'zqxvab'
    );
  });

  it('builds text from nothing', () => {
    expect(step('', { front: 0, inserted: 'zq', end: 0, t: T })).toBe('zq');
  });
});

describe('compareStrings with a given time', () => {
  it('records the time it is given, as converting an old file does', () => {
    const when = new Date('2020-11-20T20:23:29.127Z');
    expect(compareStrings('zq', 'zqxv', 2, when)).toEqual({
      inserted: 'xv',
      front: 2,
      end: 0,
      t: when,
      pos: 2,
    });
  });
});

describe('round trip: compareStrings then step', () => {
  const pairs: [string, string, string][] = [
    ['insert at start', 'xv', 'zqxv'],
    ['insert in middle', 'zqxv', 'zqabxv'],
    ['insert at end', 'zq', 'zqxv'],
    ['delete at start', 'zqxv', 'xv'],
    ['delete in middle', 'zqabxv', 'zqxv'],
    ['delete at end', 'zqxv', 'zq'],
    ['replace in middle', 'zq-xv', 'zq+++xv'],
    ['replace everything', 'zq', 'xv'],
    ['unchanged empty', '', ''],
    ['from empty', '', 'zq'],
    ['to empty', 'zq', ''],
    ['repeat grows', 'aaa', 'aaaa'],
    ['repeat shrinks', 'aaaa', 'aaa'],
    ['repeat inserted inside run', 'aaa', 'aabaa'],
    ['repeated pattern shrinks', 'abab', 'ab'],
    ['repeated pattern grows', 'ab', 'abab'],
    ['repeated pattern loses its head', 'abab', 'bab'],
    ['repeat char inserted at start', 'ab', 'aab'],
    ['repeat char deleted from the middle', 'abba', 'aba'],
    ['edit overlapping prefix and suffix', 'abcab', 'abcabcab'],
    ['html insertion at end of tag content', '<p>zq</p>', '<p>zq xv</p>'],
    ['html new paragraph', '<p>zq</p>', '<p>zq</p><p>xv</p>'],
    ['html tag swap', '<p>zq</p>', '<h1>zq</h1>'],
    ['newline insertion', 'zq\nxv', 'zq\n\nxv'],
    ['multi-code-unit text', 'zq', 'zqéé'],
  ];

  it.each(pairs)('%s', (_name, from, to) => {
    expect(step(from, compareStrings(from, to, 0))).toBe(to);
  });

  it('is exact in both directions for every pair', () => {
    pairs.forEach(([name, from, to]) => {
      expect([name, step(to, compareStrings(to, from, 0))]).toEqual([
        name,
        from,
      ]);
    });
  });

  // The editor does not record an unchanged state today, but a change for one must be safe to replay:
  // it once came back as front 0, end 0, which step() applies by erasing the text.
  it.each(['', 'z', 'zq xv', '<p>zq</p>', 'zq\nxv', 'aaaa'])(
    'an unchanged state replays as the same text: %j',
    (text) => {
      expect(step(text, compareStrings(text, text, 0))).toBe(text);
    }
  );

  it('reproduces each state of a history that repeats a state', () => {
    const states = ['zq', 'zq', 'zq xv', 'zq xv', '', '', 'ab'];
    expect(replayAll(buildHistory(states))).toEqual(states);
  });

  it('reproduces each state of a multi-step history', () => {
    const states = [
      'z',
      'zq',
      'zqq',
      'zq',
      'zq xv',
      'xv',
      '',
      'aaa',
      'aaaa',
      'abab',
      'ab',
    ];
    expect(replayAll(buildHistory(states))).toEqual(states);
  });

  it('reproduces each state of an HTML history', () => {
    const states = [
      '<p></p>',
      '<p>zq</p>',
      '<p>zq xv</p>',
      '<p>zq xv</p><p></p>',
      '<p>zq xv</p><p>ab</p>',
      '<p>zq</p><p>ab</p>',
    ];
    expect(replayAll(buildHistory(states))).toEqual(states);
  });
});

describe('reconstruct', () => {
  const states = ['zq', 'zq xv', 'xv'];
  const changes = buildHistory(states);

  it('applies changes up to and including the index', () => {
    expect(reconstruct('', changes, 0)).toBe('zq');
    expect(reconstruct('', changes, 1)).toBe('zq xv');
    expect(reconstruct('', changes, 2)).toBe('xv');
  });

  it('stops at the end of the history when the index is past it', () => {
    expect(reconstruct('', changes, 99)).toBe('xv');
  });

  it('returns the initial text when there are no changes', () => {
    expect(reconstruct('zq', [], 0)).toBe('zq');
  });

  it('returns an empty string when there is no history at all', () => {
    expect(reconstruct('zq', undefined as unknown as ChangeObj[], 0)).toBe('');
  });
});

describe('reconstructHTML', () => {
  it('returns the text at the step the replay is on', () => {
    const states = ['<p>zq</p>', '<p>zq xv</p>'];
    const changes = buildHistory(states);
    expect(reconstructHTML('', changes, 0)).toBe(states[0]);
    expect(reconstructHTML('', changes, 1)).toBe(states[1]);
  });

  it('returns an empty string for an empty history', () => {
    expect(reconstructHTML('<p>zq</p>', [], 0)).toBe('');
  });
});

describe('reconstructArray', () => {
  it('returns no rows for an empty history', () => {
    expect(reconstructArray('', [], 0)).toEqual([]);
  });

  it('splits the text into keyed rows', () => {
    const changes = buildHistory(['zq\nxv']);
    expect(reconstructArray('', changes, 0).map((r) => r.text)).toEqual([
      'zq',
      'xv',
    ]);
    expect(reconstructArray('', changes, 0).map((r) => r.key)).toEqual([0, 1]);
  });

  it('marks the row where the change ended as the insert row', () => {
    const changes = buildHistory(['zq', 'zq\nxv', 'zq\nxvab']);
    const rows = reconstructArray('', changes, 2);
    expect(rows.map((r) => r.isInsertRow)).toEqual([false, true]);

    // A change that itself adds a line ends on the new line, not on the line where it began.
    const newLine = reconstructArray('', changes, 1);
    expect(newLine.map((r) => r.isInsertRow)).toEqual([false, true]);

    const first = reconstructArray('', changes, 0);
    expect(first).toEqual([{ text: 'zq', isInsertRow: true, key: 0 }]);
  });

  it('marks the earlier row when an edit happens above the last one', () => {
    const changes = buildHistory(['zq\nxv', 'zqab\nxv']);
    const rows = reconstructArray('', changes, 1);
    expect(rows.map((r) => r.isInsertRow)).toEqual([true, false]);
  });
});
