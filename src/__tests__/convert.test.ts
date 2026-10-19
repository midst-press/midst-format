/** @jest-environment node */
import { getSchema } from '@tiptap/core';
import { generateJSON } from '@tiptap/html';
import { reconstruct } from '../history';
import poemExtensions from '../extensions';
import {
  convertMidstFile,
  dropTrailingBreaks,
  dropZeroWidthOnlyElements,
  fileVersionMatchesCurrent,
  getFileVersion,
  includeVersionInfo,
  serializeDocument,
  stripVersionInfo,
} from '../convert';

// Synthetic documents only: invented words, never a poem.

describe('the version header', () => {
  it('reads the version from the first line', () => {
    expect(getFileVersion('midstVersion: 1\n{"text":""}')).toBe('1');
    expect(getFileVersion('midstVersion: v0.0.1\n{"text":""}')).toBe('v0.0.1');
  });

  // #32: a file whose line endings were changed to Windows ones is still a current file.
  it('reads a header that ends in CRLF', () => {
    expect(getFileVersion('midstVersion: 1\r\n{"text":""}')).toBe('1');
    expect(fileVersionMatchesCurrent('midstVersion: 1\r\n{}')).toBe(true);
    expect(stripVersionInfo('midstVersion: 1\r\n{"text":""}')).toBe(
      '{"text":""}'
    );
  });

  // An older Windows editor saves UTF-8 with a byte order mark (silas-397300f6, review of #196).
  it('reads a header after a UTF-8 byte order mark, with CRLF too', () => {
    const file = '\uFEFFmidstVersion: 1\r\n{"text":""}';
    expect(getFileVersion(file)).toBe('1');
    expect(fileVersionMatchesCurrent(file)).toBe(true);
    expect(stripVersionInfo(file)).toBe('{"text":""}');
  });

  it('accepts both versions the editor has written, and no other', () => {
    expect(fileVersionMatchesCurrent('midstVersion: 1\n{}')).toBe(true);
    expect(fileVersionMatchesCurrent('midstVersion: v0.0.1\n{}')).toBe(true);
    expect(fileVersionMatchesCurrent('midstVersion: 2\n{}')).toBe(false);
    expect(fileVersionMatchesCurrent('midstVersion: 10\n{}')).toBe(false);
  });

  it.each([
    ['an empty file', ''],
    ['a file with no header', '{"editorTimelineFrames":[]}'],
    ['a header with no value', 'midstVersion:\n{}'],
    ['a header with no space after the colon', 'midstVersion:1\n{}'],
    ['a version on the second line', '{}\nmidstVersion: 1'],
    ['text that merely contains a colon', '{"content":"<p>zq: 1</p>"}'],
    // #32: the header's name is checked, not just whatever follows the first ': '.
    ['another key with a current value', 'title: 1\n{}'],
    ['the header name inside a longer key', 'xmidstVersion: 1\n{}'],
    ['a current value followed by more', 'midstVersion: 1 zq\n{}'],
  ])('does not take %s for a current file', (_name, data) => {
    expect(fileVersionMatchesCurrent(data)).toBe(false);
  });

  // fs.readFile hands its callback `undefined` when the read fails, and both open paths pass that
  // straight in. It must come back as "not a current file", not as a throw.
  it('answers a file that could not be read with an empty version', () => {
    expect(getFileVersion(undefined as never)).toBe('');
    expect(fileVersionMatchesCurrent(undefined as never)).toBe(false);
  });

  it('writes a header the editor then accepts, and gives the body back unchanged', () => {
    const body = JSON.stringify({ text: '<p>zq</p>', history: [] });
    const file = includeVersionInfo(body);
    expect(file.split('\n')).toHaveLength(2);
    expect(fileVersionMatchesCurrent(file)).toBe(true);
    expect(stripVersionInfo(file)).toBe(body);
  });

  it('has no body to give for a file that is only a header', () => {
    expect(stripVersionInfo('midstVersion: 1')).toBeUndefined();
  });
});

describe('the file body the editor saves', () => {
  it('holds the text and the history, and no meta when the document has none', () => {
    const body = serializeDocument('<p>zq</p>', '[{"inserted":"zq"}]', '');
    expect(JSON.parse(body)).toEqual({
      text: '<p>zq</p>',
      history: [{ inserted: 'zq' }],
    });
  });

  it('writes the meta back when there is one', () => {
    const body = serializeDocument('<p>zq</p>', '[]', '{"title":"zq title"}');
    expect(JSON.parse(body).meta).toEqual({ title: 'zq title' });
  });

  // Only an object can hold an author (#181); any other meta a file holds is written back as it is.
  it.each([
    ['null', null],
    ['an array', [1]],
    ['a string', 'zq'],
  ])('writes back a meta that is %s unchanged', (_label, meta) => {
    const body = serializeDocument('<p>zq</p>', '[]', JSON.stringify(meta));
    expect(JSON.parse(body).meta).toEqual(meta);
  });

  it('is one line, so the version header stays the only other line', () => {
    const body = serializeDocument('<p>zq</p><p>xv</p>', '[]', '');
    expect(body).not.toContain('\n');
    expect(stripVersionInfo(includeVersionInfo(body))).toBe(body);
  });

  // A save that cannot read its own history must fail, not write a file without one.
  it.each([
    ['history', '[{"inserted":', ''],
    ['meta', '[]', '{"title":'],
  ])('throws when the stored %s is not JSON', (_name, history, meta) => {
    expect(() => serializeDocument('<p>zq</p>', history, meta)).toThrow(
      SyntaxError
    );
  });
});

describe('converting an old file', () => {
  const T0 = 1605903809127;
  const convert = (frames: { content: string; lineNumber: string }[]) =>
    JSON.parse(
      convertMidstFile(
        JSON.stringify({
          editorTimelineFrames: frames.map((f, i) => ({
            ...f,
            timestamp: T0 + i * 100,
          })),
        })
      )
    );

  it('keeps the last frame as the text, and gives an empty meta when the old file has none', () => {
    const c = convert([
      { content: '<p>zq</p>', lineNumber: '0' },
      { content: '<p>zq xv</p>', lineNumber: '0' },
    ]);
    expect(c.text).toBe('<p>zq xv</p>');
    expect(c.meta).toEqual({});
  });

  it('records each frame as what changed from the one before, with its time', () => {
    const c = convert([
      { content: '<p>zq</p>', lineNumber: '0' },
      { content: '<p>zq xv</p>', lineNumber: '0' },
      { content: '<p>zq xv</p>', lineNumber: '0' },
      { content: '<p>z xv</p>', lineNumber: '0' },
    ]);
    expect(
      c.history.map(({ pos, ...change }: { pos: number }) => change)
    ).toEqual([
      // The whole first frame is an insertion into nothing.
      { inserted: '<p>zq</p>', front: 0, end: 0, t: new Date(T0).toJSON() },
      { inserted: ' xv', front: 5, end: 4, t: new Date(T0 + 100).toJSON() },
      // A frame identical to the last still gets a change, so indices line up with the old frames.
      { inserted: '', front: 12, end: 0, t: new Date(T0 + 200).toJSON() },
      // A deletion inserts nothing; front and end close over the removed text.
      { inserted: '', front: 4, end: 7, t: new Date(T0 + 300).toJSON() },
    ]);
  });

  // pos is a ProseMirror position in the document after the change (#36). An old frame records only its line,
  // so the converted pos is the end of that line's block.
  describe('the cursor position of a frame', () => {
    const pos = (content: string, lineNumber: string) =>
      convert([{ content, lineNumber }]).history[0].pos;

    it('is the end of the line, in ProseMirror positions', () => {
      expect(pos('<p>zq</p>', '0')).toBe(3);
      expect(pos('<p></p>', '0')).toBe(1);
    });

    it('is the end of the line being written, past the lines before it', () => {
      expect(pos('<p>zq</p><p>xv</p><p>kj</p>', '0')).toBe(3);
      expect(pos('<p>zq</p><p>xv</p><p>kj</p>', '1')).toBe(7);
      expect(pos('<p>zq</p><p>xv</p><p>kj</p>', '2')).toBe(11);
    });

    it('counts a line break inside a line as one position', () => {
      expect(pos('<p>zq<br>xv</p>', '0')).toBe(6);
    });

    it('counts formatted text by its characters, not its tags', () => {
      expect(pos('<p>z<strong>q</strong><em>x</em></p>', '0')).toBe(4);
    });

    it('is the end of the last line for a line past the end', () => {
      expect(pos('<p>zq</p><p>xv</p>', '5')).toBe(7);
    });

    it('is the start of the document when the line cannot be used', () => {
      expect(pos('<p>zq</p>', '-1')).toBe(0);
      expect(pos('<p>zq</p>', 'zq')).toBe(0);
    });

    // The end of a block's content is where a cursor typing at the end of that line sits.
    it('is a position in the converted document that ends a block', () => {
      const schema = getSchema(poemExtensions);
      const content = '<p>zq</p><p>x<em>v</em><br>kj</p><p></p>';
      const doc = schema.nodeFromJSON(
        generateJSON(content, poemExtensions, { preserveWhitespace: true })
      );
      ['0', '1', '2'].forEach((line) => {
        const at = doc.resolve(pos(content, line));
        expect(at.parent.type.name).toBe('paragraph');
        expect(at.parentOffset).toBe(at.parent.content.size);
        expect(at.index(0)).toBe(Number(line));
      });
    });
  });
});

describe('a <br> that ends a paragraph', () => {
  it.each([
    ['an empty line', '<p><br></p>', '<p></p>'],
    ['a line of text', '<p>zq<br></p>', '<p>zq</p>'],
    ['a self-closed break', '<p>zq<br /></p>', '<p>zq</p>'],
    [
      'a break inside closing tags',
      '<p><em>zq<br></em></p>',
      '<p><em>zq</em></p>',
    ],
    ['every paragraph', '<p><br></p><p>zq<br></p>', '<p></p><p>zq</p>'],
  ])('is dropped from %s', (_name, html, expected) => {
    expect(dropTrailingBreaks(html)).toBe(expected);
  });

  it.each([
    ['a break between two lines of text', '<p>zq<br>xv</p>'],
    ['a <div>, which would lose its line', '<div>zq<br></div>'],
  ])('is not what %s has, so it stays', (_name, html) => {
    expect(dropTrailingBreaks(html)).toBe(html);
  });

  it('takes only the last of two, since the first is a real blank line', () => {
    expect(dropTrailingBreaks('<p>zq<br><br></p>')).toBe('<p>zq<br></p>');
  });
});

describe('a selection marker left in an old file', () => {
  // Rangy's marker, as the old editor saved it: invisible, and nothing the poet wrote.
  const RANGY =
    '<span id="selectionBoundary_1_2" class="rangySelectionBoundary" style="line-height: 0; display: none;">&#xFEFF;</span>';
  const ZERO_WIDTH = /\uFEFF|\u200B|\u200C|\u200D|\u2060/g;
  const T0 = 1605903809127;

  const convert = (contents: string[]) =>
    JSON.parse(
      convertMidstFile(
        JSON.stringify({
          editorTimelineFrames: contents.map((content, i) => ({
            content,
            lineNumber: '0',
            timestamp: T0 + i * 100,
          })),
        })
      )
    );

  // The text of each <p>, in order, tags stripped.
  const paragraphs = (html: string) =>
    [...html.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map((m) =>
      m[1].replace(/<[^>]*>/g, '')
    );
  const zeroWidthOnly = (html: string) =>
    paragraphs(html).filter(
      (t) => t.length > 0 && t.replace(ZERO_WIDTH, '') === ''
    );
  // What the poet wrote: no tag, no marker, no zero-width character, no space; one character per entry.
  const authored = (html: string) =>
    html
      .split(RANGY)
      .join('')
      .replace(/<[^>]*>/g, '')
      .replace(ZERO_WIDTH, '')
      .replace(/&#xFEFF;/gi, '')
      .replace(/\s/g, '')
      .split('');
  const count = (chars: string[]) =>
    chars.reduce(
      (m, c) => m.set(c, (m.get(c) ?? 0) + 1),
      new Map<string, number>()
    );

  // Every frame of the history, replayed from nothing, as the editor's Replay rebuilds it.
  const replay = (c: { history: Parameters<typeof reconstruct>[1] }) =>
    c.history.map((_, i) => reconstruct('', c.history, i));

  const FRAMES = [
    `${RANGY}<p data-line-number="0">zq</p>`,
    `<p data-line-number="0">zq</p>${RANGY}<p data-line-number="1">xv</p>`,
    `${RANGY}<p data-line-number="0">zq</p><p data-line-number="1">xv${RANGY}</p><p data-line-number="2">kj</p>`,
  ];

  it('leaves no paragraph of zero-width characters, and the poem as written', () => {
    const c = convert(FRAMES);
    expect(zeroWidthOnly(c.text)).toEqual([]);
    expect(paragraphs(c.text)).toEqual(['zq', 'xv', 'kj']);
  });

  it('leaves no such paragraph at any step, and loses no authored character at any step', () => {
    const c = convert(FRAMES);
    const steps = replay(c);
    expect(steps).toHaveLength(FRAMES.length);
    steps.forEach((html, i) => {
      expect(zeroWidthOnly(html)).toEqual([]);
      const have = count(authored(html));
      count(authored(FRAMES[i])).forEach((n, ch) => {
        expect(have.get(ch) ?? 0).toBeGreaterThanOrEqual(n);
      });
    });
    expect(steps[steps.length - 1]).toBe(c.text);
  });

  it('keeps a line the poet left blank', () => {
    const c = convert([`${RANGY}<p>zq</p><p><br></p><p></p><p>xv</p>`]);
    expect(paragraphs(c.text)).toEqual(['zq', '', '', 'xv']);
  });

  it('keeps the paragraph and its text when the marker sits inside it, and drops the marker', () => {
    const c = convert([`<p>ab${RANGY}cd</p>`]);
    expect(c.text).toBe('<p>abcd</p>');
    expect(c.text).not.toMatch(/\uFEFF/);
  });

  it('leaves a zero-width character beside visible text in the text', () => {
    const html = '<p>ab﻿cd</p>';
    expect(dropZeroWidthOnlyElements(html)).toBe(html);
  });

  it.each([
    ['U+200B', '&#x200B;'],
    ['U+200C', '&#x200c;'],
    ['U+200D', '&#8205;'],
    ['U+2060', '&#x2060;'],
    ['a literal U+FEFF', '﻿'],
    ['several in a row', '&#xFEFF;​'],
  ])('is removed whatever it holds: %s', (_name, held) => {
    expect(dropZeroWidthOnlyElements(`<span>${held}</span><p>zq</p>`)).toBe(
      '<p>zq</p>'
    );
  });

  it('is removed when wrapped in another marker, leaving only an empty wrapper', () => {
    expect(
      dropZeroWidthOnlyElements('<span><span>&#xFEFF;</span></span><p>zq</p>')
    ).toBe('<span></span><p>zq</p>');
  });

  it.each([
    ['a span with a word in it', '<span>zq&#xFEFF;</span>'],
    ['a span with a break in it', '<span>&#xFEFF;<br></span>'],
    ['an empty span', '<span></span>'],
    ['a blank paragraph', '<p><br></p>'],
    ['an empty paragraph', '<p></p>'],
  ])('is not removed with %s', (_name, html) => {
    expect(dropZeroWidthOnlyElements(html)).toBe(html);
  });
});
