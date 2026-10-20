/** @jest-environment node */
import { getSchema } from '@tiptap/core';
import { generateJSON } from '@tiptap/html';
import { reconstruct } from '../history';
import poemExtensions from '../extensions';
import {
  convertMidstFile,
  dropInvisibleParagraphs,
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
      expect(pos('<p><br></p>', '0')).toBe(1);
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
      const content = '<p>zq</p><p>x<em>v</em><br>kj</p><p>z</p>';
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

    // The recorded line counts the paragraphs the old player drew nothing for, which the converted document
    // drops (midst-editor #169), so the line is mapped through the drop.
    it('is the end of the same line when a paragraph before it was dropped', () => {
      expect(pos('<p>zq</p><p></p><p>xv</p>', '0')).toBe(3);
      // A line after the one written, so the end of the document is not also the right answer.
      expect(pos('<p>zq</p><p></p><p>xv</p><p>kj</p>', '2')).toBe(7);
      expect(pos('<p></p><p> </p><p>zq</p><p>xv</p>', '2')).toBe(3);
    });

    it('is the end of the line before when the recorded line itself was dropped', () => {
      expect(pos('<p>zq</p><p></p><p>xv</p>', '1')).toBe(3);
      expect(pos('<p>zq</p><p><em></em></p><p></p><p>xv</p>', '2')).toBe(3);
    });

    it('is the start of the document when no line at or before it was kept', () => {
      expect(pos('<p></p><p>zq</p>', '0')).toBe(0);
      expect(pos('<p></p><p>zq</p>', '1')).toBe(3);
      expect(pos('<p></p>', '0')).toBe(0);
    });

    it('maps the line when the frame already holds the mark character', () => {
      expect(pos('<p>\uE000</p><p></p><p>zq</p>', '2')).toBe(6);
    });

    it('maps the line when a kept line reads as the mark through a character reference', () => {
      expect(pos('<p>&#xE000;</p><p></p><p>zq</p>', '1')).toBe(2);
      expect(pos('<p>&#xE000;</p><p></p><p>zq</p>', '2')).toBe(6);
    });

    it('is the end of the last kept line for a line past the end', () => {
      expect(pos('<p>zq</p><p></p>', '5')).toBe(3);
    });

    it('does not count a visible blank line as dropped', () => {
      expect(pos('<p>zq</p><p><br></p><p>xv</p>', '2')).toBe(9);
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
    // midst-editor #15
    ['a break inside <font>', '<p><font color="red">zq<br></font></p>', '<p><font color="red">zq</font></p>'],
    ['a break inside <sup> and <sub>', '<p><sup>zq<br></sup></p><p><sub><br></sub></p>', '<p><sup>zq</sup></p><p><sub></sub></p>'],
    ['a break before an empty tag', '<p>zq<br><b></b></p>', '<p>zq<b></b></p>'],
    ['a break before empty tags nested, with spaces', '<p>zq<br> <em><strong> </strong></em></p>', '<p>zq <em><strong> </strong></em></p>'],
  ])('is dropped from %s', (_name, html, expected) => {
    expect(dropTrailingBreaks(html)).toBe(expected);
  });

  it.each([
    ['a break between two lines of text', '<p>zq<br>xv</p>'],
    ['a <div>, which would lose its line', '<div>zq<br></div>'],
    ['a tag that keeps its whitespace after it', '<p>zq<br><span style="white-space: pre"> </span></p>'],
    ['text after it inside a tag', '<p>zq<br><em>xv</em></p>'],
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

  // <p><br></p> is a blank line the poet saw; <p></p> drew nothing in the old player (midst-editor #169).
  it('keeps a line the poet left blank, and drops an empty paragraph that showed nothing', () => {
    const c = convert([`${RANGY}<p>zq</p><p><br></p><p></p><p>xv</p>`]);
    expect(paragraphs(c.text)).toEqual(['zq', '', 'xv']);
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

  // #71: without display:none the element is drawn, so a paragraph holding only such elements was a line in the old
  // player (a browser draws the zero-width character's line box). It stays a blank line, without the character.
  const HIDDEN = '<span class="rangySelectionBoundary" style="line-height: 0; display: none;">&#xFEFF;</span>';
  it.each([
    ['a shown zero-width span', '<p><span>&#x200B;</span></p>'],
    ['Rangy’s class without display:none, which a browser draws', '<p><span class="rangySelectionBoundary">&#xFEFF;</span></p>'],
    ['a shown one wrapped in a shown one', '<p><span><span>&#xFEFF;</span></span></p>'],
    ['a shown one beside a hidden one, with spaces', `<p> ${HIDDEN}<em>&#x200B;</em> </p>`],
    ['an attribute on the paragraph', '<p data-line-number="2"><span>&#x200B;</span></p>'],
  ])('keeps a paragraph holding only %s as a blank line', (_name, html) => {
    expect(dropZeroWidthOnlyElements(`<p>zq</p>${html}<p>xv</p>`)).toMatch(
      /^<p>zq<\/p><p\b[^>]*><br><\/p><p>xv<\/p>$/
    );
  });

  it.each([
    ['a hidden marker alone', `<p>${HIDDEN}</p>`, '<p></p>'],
    // The emptied hidden wrapper goes too (#88): kept, it held its paragraph past the invisible-paragraph rule.
    ['a shown one inside a hidden wrapper', '<p><em style="display:none"><span>&#x200B;</span></em></p>', '<p></p>'],
    ['a shown one beside text', '<p>zq<span>&#x200B;</span></p>', '<p>zq</p>'],
    ['a shown one outside any paragraph', '<span>&#x200B;</span><p>zq</p>', '<p>zq</p>'],
    // cyril-9137f1ee: JavaScript's \\s also matches these, which must not be deleted as filler.
    ['a raw no-break space beside a shown one', '<p>\u00A0<span>&#x200B;</span></p>', '<p>\u00A0</p>'],
    ['a raw tab beside a shown one', '<p>\t<span>&#x200B;</span></p>', '<p>\t</p>'],
    ['a raw ideographic space beside a shown one', '<p>\u3000<span>&#x200B;</span></p>', '<p>\u3000</p>'],
    ['a raw U+2003 beside a shown one', '<p>\u2003<span>&#x200B;</span></p>', '<p>\u2003</p>'],
  ])('leaves no line for %s, as before', (_name, html, out) => {
    expect(dropZeroWidthOnlyElements(html)).toBe(out);
  });

  it('a paragraph holding only a shown one stays a blank line through the whole conversion', () => {
    const c = convert([`<p>zq</p><p><span>&#x200B;</span></p><p>${HIDDEN}</p><p>xv</p>`]);
    expect(paragraphs(c.text)).toEqual(['zq', '', 'xv']);
    expect(c.text).not.toMatch(ZERO_WIDTH);
  });
});

// midst-editor #169: a paragraph with nothing a browser draws had no height in the old player (its only paragraph
// rule is margin 0, padding 0), but ProseMirror draws every paragraph, so each became a blank line.
describe('a paragraph that drew nothing', () => {
  it.each([
    ['an empty paragraph', '<p></p>'],
    ['spaces and newlines only', '<p> \n </p>'],
    ['an attribute on the paragraph', '<p data-line-number="3"></p>'],
    ['an empty inline tag', '<p><span></span></p>'],
    ['empty tags nested, with spaces', '<p> <em><strong> </strong></em> </p>'],
    ['an inline style that gives no box', '<p><span style="font-size: 12px; line-height: 0"></span></p>'],
    ['a <font>, <sup> or <sub> holding nothing', '<p><font color="red"></font><sup></sup><sub> </sub></p>'],
  ])('is dropped: %s', (_name, html) => {
    expect(dropInvisibleParagraphs(`<p>zq</p>${html}<p>xv</p>`)).toBe(
      '<p>zq</p><p>xv</p>'
    );
  });

  it.each([
    ['a blank line the poet left', '<p><br></p>'],
    ['a <br> inside a tag', '<p><em><br></em></p>'],
    ['a no-break space', '<p>&nbsp;</p>'],
    ['a literal no-break space', '<p> </p>'],
    ['a tab', '<p>\t</p>'],
    ['a character reference', '<p>&#32;</p>'],
    ['text', '<p>zq</p>'],
    ['spaces kept by white-space', '<p><span style="white-space: pre">  </span></p>'],
    ['white-space on the paragraph', '<p style="white-space: pre-wrap"> </p>'],
    ['a tag with a height', '<p><span style="display: inline-block; height: 20px"></span></p>'],
    ['a min-height on the paragraph', '<p style="min-height: 1em"></p>'],
    ['padding', '<p><span style="padding: 4px"></span></p>'],
    ['a border', '<p style="border: 1px solid"></p>'],
    // clement-7074f29f, review of #65: longhands and margins give a box too.
    ['a padding longhand', '<p><span style="padding-left: 4px"></span></p>'],
    ['a border longhand', '<p><span style="border-bottom: 1px solid"></span></p>'],
    ['a margin on the paragraph', '<p style="margin-top: 20px"></p>'],
    ['a margin on a tag', '<p><span style="margin-left: 4px"></span></p>'],
    ['a tag not listed', '<p><img src="x"></p>'],
    ['a zero-width character not removed before', '<p>​</p>'],
  ])('is kept: %s', (_name, html) => {
    expect(dropInvisibleParagraphs(html)).toBe(html);
  });

  it('goes when the paragraph inside it goes, as a browser parses nested paragraphs', () => {
    expect(dropInvisibleParagraphs('<p>zq</p><p><span><p></p></span></p>')).toBe(
      '<p>zq</p>'
    );
  });

  it('is dropped by the converter at every frame, and the visible lines stay', () => {
    const T0 = 1605903809127;
    const contents = ['<p>zq</p><p></p>', '<p>zq</p><p></p><p><br></p><p> </p><p>xv</p>'];
    const c = JSON.parse(
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
    expect(c.history.map((_: unknown, i: number) => reconstruct('', c.history, i))).toEqual([
      '<p>zq</p>',
      '<p>zq</p><p></p><p>xv</p>',
    ]);
    expect(c.text).toBe('<p>zq</p><p></p><p>xv</p>');
  });

  // The selection marker goes first, so a paragraph that held only a marker drew nothing and goes too.
  it('drops a paragraph that held only a selection marker', () => {
    const RANGY =
      '<span class="rangySelectionBoundary" style="line-height: 0; display: none;">&#xFEFF;</span>';
    const c = JSON.parse(
      convertMidstFile(
        JSON.stringify({
          editorTimelineFrames: [
            { content: `<p>zq</p><p>${RANGY}</p><p>xv</p>`, lineNumber: '0', timestamp: 1 },
          ],
        })
      )
    );
    expect(c.text).toBe('<p>zq</p><p>xv</p>');
  });
});

// A closing tag with nothing open to close: a browser ignores it (a stray </p> becomes an empty <p></p>) and keeps
// every word after it. The editor's parser stopped there and dropped them (midst-format #78).
describe('a stray closing tag', () => {
  const convertFrame = (content: string) =>
    JSON.parse(
      convertMidstFile(
        JSON.stringify({ editorTimelineFrames: [{ content, lineNumber: '0', timestamp: 1 }] })
      )
    ).text;

  it.each([
    ['a stray </p>', '<p>zq</p></p><p>xv</p>', '<p>zq</p><p>xv</p>'],
    ['two stray </p>', '<p>zq</p></p></p><p>xv</p>', '<p>zq</p><p>xv</p>'],
    ['a stray </div>', '<p>zq</p></div><p>xv</p>', '<p>zq</p><p>xv</p>'],
    ['a stray </span>', '<p>zq</p></span><p>xv</p>', '<p>zq</p><p>xv</p>'],
    ['a stray </font> before bare text', '<p>zq</p></font>xv', '<p>zq</p><p>xv</p>'],
    ['a stray </p> inside a paragraph', '<p>zq</p><p>x</p>v</p><p>wy</p>', '<p>zq</p><p>x</p><p>v</p><p>wy</p>'],
    ['a stray </p> first', '</p><p>xv</p>', '<p>xv</p>'],
    // Converted correctly before #78 too: kept so the re-parse cannot regress it.
    ['a <p> inside a <p>, then its stray close', '<p>zq<p>xv</p></p><p>wy</p>', '<p>zq</p><p>xv</p><p>wy</p>'],
    // The <br> ends its paragraph once the next <p> closes it, so it draws one line, as in a browser.
    ['the html-shape fixture', '<p>zq</p></p></p><p><br><p>xv</p>', '<p>zq</p><p></p><p>xv</p>'],
  ])('keeps every word after %s', (_, frame, expected) => {
    expect(convertFrame(frame)).toBe(expected);
  });
});

// A browser draws a run of inline content between blocks as a line, and a <div> holding no block as a line, and in
// both a last <br> draws nothing more. Written as <p>, the paragraph rules reach them (midst-editor #15).
describe('the top-level lines', () => {
  const convertFrame = (content: string) =>
    JSON.parse(
      convertMidstFile(
        JSON.stringify({ editorTimelineFrames: [{ content, lineNumber: '0', timestamp: 1 }] })
      )
    ).text;

  it.each([
    ['a bare <br> between paragraphs is one blank line', '<p>zq</p><br><p>xv</p>', '<p>zq</p><p></p><p>xv</p>'],
    ['two bare <br>s are two blank lines', '<p>zq</p><br><br><p>xv</p>', '<p>zq</p><p><br></p><p>xv</p>'],
    ['bare text with a last <br> is one line', '<p>zq</p>xv<br><p>wy</p>', '<p>zq</p><p>xv</p><p>wy</p>'],
    ['<div><br></div> is one blank line', 'zq<div><br></div>', '<p>zq</p><p></p>'],
    ['a <div> line keeps its words and drops its last <br>', 'zq<div>xv<br></div>', '<p>zq</p><p>xv</p>'],
    ['a styled <div> line too', '<div style="color: red">zq<br></div>', '<p>zq</p>'],
    // A comment draws nothing, alone or with whitespace (clement-7074f29f, review of #84).
    ['a comment between paragraphs is no line', '<p>zq</p><!--StartFragment--><p>xv</p>', '<p>zq</p><p>xv</p>'],
    ['a comment with whitespace is no line', '<p>zq</p>\n<!-- c -->\n<p>xv</p>', '<p>zq</p><p>xv</p>'],
    // A block outside the poem's schema is left as main left it, not made a line (cyril-9137f1ee, review of #84).
    ['an <hr> between paragraphs is left as before', '<p>zq</p><hr><p>xv</p>', '<p>zq</p><p>xv</p>'],
    // A <div> holding blocks: its children are lines as at the top level (#85; archive poems #13 and #44).
    ['a <br> first in a <div> of paragraphs is one blank line', 'zq<div><br><p>xv</p></div>', '<p>zq</p><p></p><p>xv</p>'],
    ['a <br> last in a <div> of paragraphs is one blank line', '<div><p>zq</p><br></div>', '<p>zq</p><p></p>'],
    ['the same in a <div> inside a <div>', '<div><div><br><p>zq</p></div></div>', '<p></p><p>zq</p>'],
    ['whitespace between blocks is no line (so before #15 too: a guard)', '<p>zq</p> <p>xv</p>', '<p>zq</p><p>xv</p>'],
  ])('%s', (_, frame, expected) => {
    expect(convertFrame(frame)).toBe(expected);
  });
});

// A Rangy marker whose FEFF a bold command wrapped in <b> (archive poem #28): once the <b> holding only the FEFF is
// removed, the marker is an empty display:none element, which draws nothing, so it goes too (#88).
describe('a hidden marker emptied by the zero-width rule', () => {
  const MARKER = '<span class="rangySelectionBoundary" style="line-height: 0; display: none;">';
  const convertFrame = (content: string) =>
    JSON.parse(
      convertMidstFile(
        JSON.stringify({ editorTimelineFrames: [{ content, lineNumber: '0', timestamp: 1 }] })
      )
    ).text;

  it.each([
    ['its FEFF in <b>', `<p>zq</p><p><i>${MARKER}<b>&#xFEFF;</b></span></i></p><p>xv</p>`, '<p>zq</p><p>xv</p>'],
    ['its FEFF in <b><i>', `<p>zq</p><p>${MARKER}<b><i>﻿</i></b></span></p><p>xv</p>`, '<p>zq</p><p>xv</p>'],
    ['beside text, the text stays (so before #88 too: a guard)', `<p>zq${MARKER}<b>&#xFEFF;</b></span>xv</p>`, '<p>zqxv</p>'],
    // A hidden span inside a hidden span: the outer one is never closed early, so no stray </span> is left.
    ['nested in another hidden span', `<p>zq</p><p>${MARKER}${MARKER}<b>&#xFEFF;</b></span></span></p><p>xv</p>`, '<p>zq</p><p>xv</p>'],
  ])('goes when %s', (_, frame, expected) => {
    expect(convertFrame(frame)).toBe(expected);
  });
});
