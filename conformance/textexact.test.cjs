// Each case must give its stated verdict, so the oracle can say both "equal" and "lost".
//
//   npm test
const { textOf } = require('./textexact.cjs');
// A fifth element 'editor' reads b as the editor's HTML (the replay), as verify_lib does.
const eq = (a, b, side) => textOf(a) === textOf(b, { editor: side === 'editor' });
const cases = [
  ['tab collapsed', '<p>a\tb</p>', '<p>a b</p>', false],
  ['lead tab dropped', '<p>\ta</p>', '<p>a</p>', false],
  ['two spaces collapsed', '<p>a  b</p>', '<p>a b</p>', false],
  ['trailing space dropped', '<p>a </p>', '<p>a</p>', false],
  ['nbsp entity vs char', '<p>a&nbsp;b</p>', '<p>a b</p>', true],
  ['quot entity vs char', '<p>&quot;a&#39;</p>', '<p>"a\'</p>', true],
  ['newline reads as space', '<p>a\nb</p>', '<p>a b</p>', true],
  ['CR reads as space', '<p>a\rb</p>', '<p>a b</p>', true],
  ['CRLF reads as one space', '<p>a\r\nb</p>', '<p>a b</p>', true],
  ['attributes ignored', '<p data-line-number="0">a</p>', '<p>a</p>', true],
  ['em ignored', '<p>a<em>b</em></p>', '<p>a<em>b</em></p>', true],
  ['paragraph split detected', '<p>ab</p>', '<p>a</p><p>b</p>', false],
  ['br vs paragraph equal', '<p>a<br>b</p>', '<p>a</p><p>b</p>', true],
  ['text change detected', '<p>ab</p>', '<p>aX</p>', false],
  ['space between paragraphs ignored', '<p>a</p> <p>b</p>', '<p>a</p><p>b</p>', true],
  ['space before first paragraph ignored', '  <p>a</p>\n', '<p>a</p>', true],
  // A paragraph with nothing a browser draws had no height in the old player, so it is no line (midst-editor #169).
  ['a space-only paragraph is no line', '<p>a</p><p> </p><p>b</p>', '<p>a</p><p>b</p>', true],
  ['a space-only paragraph and an empty one are both nothing', '<p> </p>', '<p></p>', true],
  ['an empty paragraph is no line', '<p>a</p><p></p><p>b</p>', '<p>a</p><p>b</p>', true],
  ['an empty paragraph of empty tags is no line', '<p>a</p><p><em> </em></p><p>b</p>', '<p>a</p><p>b</p>', true],
  ['a no-break space is a line', '<p>a</p><p>&nbsp;</p><p>b</p>', '<p>a</p><p>b</p>', false],
  ['spaces kept by white-space are a line', '<p>a</p><p><span style="white-space: pre"> </span></p><p>b</p>', '<p>a</p><p>b</p>', false],
  ['an empty source paragraph the editor draws as a line is found', '<p>a</p><p></p><p>b</p>', '<p>a</p><p></p><p>b</p>', false, 'editor'],
  ['a space-only source paragraph the editor draws as a line is found', '<p>a</p><p> </p><p>b</p>', '<p>a</p><p></p><p>b</p>', false, 'editor'],
  ['two blank lines vs one', '<p>a</p><p><br></p><p><br></p><p>b</p>', '<p>a</p><p></p><p>b</p>', false, 'editor'],
  ['br-only line dropped', '<p>a</p><p><br></p><p>b</p>', '<p>a</p><p>b</p>', false],
  ['double br vs single', '<p>a<br><br>b</p>', '<p>a<br>b</p>', false],
  ['leading blank lines dropped', '<p><br></p><p><br></p><p>a</p>', '<p>a</p>', false],
  ['trailing blank line dropped', '<p>a</p><p><br></p>', '<p>a</p>', false],
  ['text before first paragraph is a line', 'x<p>a</p>', '<p>x</p><p>a</p>', true],
  ['empty doc vs one empty line', '', '<p></p>', true],
  ['blank line saved with <br> equals the editor\'s empty paragraph', '<p>a</p><p><br></p><p>b</p>', '<p>a</p><p></p><p>b</p>', true, 'editor'],
  ['trailing <br> is not a line', '<p>a<br></p>', '<p>a</p>', true],
  ['two trailing <br> keep one line', '<p>a<br><br></p>', '<p>a</p>', false],
  ['a selection marker inside a line is not drawn', '<p>ab<span class="rangySelectionBoundary" style="display: none;">&#xFEFF;</span>cd</p>', '<p>abcd</p>', true],
  ['a selection marker before the first paragraph is no line', '<span class="rangySelectionBoundary" style="display: none;">&#xFEFF;</span><p>t</p>', '<p>t</p>', true],
  ['a literal zero-width-only span is not drawn', '<p>a<span>\u200B</span>b</p>', '<p>ab</p>', true],
  ['a zero-width character beside text is still compared', '<p>a&#x200B;b</p>', '<p>ab</p>', false],
  ['a span with text is drawn', '<p>a<span>x</span>b</p>', '<p>ab</p>', false],
  // Text after a closed block is a line of its own (midst-format #13).
  ['text between paragraphs is a line', '<p>a</p>x<p>b</p>', '<p>a</p><p>x</p><p>b</p>', true],
  ['text after the last paragraph is a line', '<p>a</p>x', '<p>a</p><p>x</p>', true],
  ['text after a block inside a container is a line', '<div><p>a</p>tail</div>', '<p>a</p><p>tail</p>', true],
  ['text after a container is a line', '<div><p>a</p></div>tail', '<p>a</p><p>tail</p>', true],
  ['styled text after a paragraph is a line', '<p>a</p><em>x</em>', '<p>a</p><p><em>x</em></p>', true],
  ['text after a paragraph is not joined to it', '<p>a</p>x', '<p>ax</p>', false],
  ['a <br> then text after a paragraph is an empty line then a line', '<p>a</p><br>x<p>b</p>', '<p>a</p><p><br>x</p><p>b</p>', true],
  ['a lone <br> between paragraphs is one empty line, as before', '<p>a</p><br><p>b</p>', '<p>a</p><p></p><p>b</p>', true, 'editor'],
  ['a zero-width-only element after a paragraph is no line', '<p>a</p><span>\u200B</span><p>b</p>', '<p>a</p><p>b</p>', true],
  ['div is a line, as a browser saves it', 'a<div><br></div>', '<p>a</p><p><br></p>', true],
  ['div line dropped', 'a<div>b</div>', '<p>ab</p>', false],
  ['space between divs ignored', '<div>a</div> <div>b</div>', '<p>a</p><p>b</p>', true],
  ['div wrapping paragraphs is not a line', '<div><p>a</p><p>b</p></div>', '<p>a</p><p>b</p>', true],
  ['text then a div of paragraphs', 'a<div><p><br></p><p>b</p></div>', '<p>a</p><p><br></p><p>b</p>', true],
  ['nested wrapping divs', '<div><div><p>a</p></div></div>', '<p>a</p>', true],
  // The editor draws a trailing hard break, so its <p><br></p> is two lines, like the browser's <p><br><br></p>.
  ['editor trailing hard break is a line', '<p><br><br></p>', '<p><br></p>', true, 'editor'],
  ['editor trailing hard break is not nothing', '<p><br><br></p>', '<p></p>', false, 'editor'],
  ['editor blank line', '<p><br></p>', '<p></p>', true, 'editor'],
];
// One argument per case: a row shorter than the callback's parameter list makes Jest read the spare
// parameter as its `done` callback, and the test then waits for a call that never comes.
test.each(cases.map((row) => [row[0], row]))('%s', (_name, [, a, b, want, side]) => {
  expect(eq(a, b, side)).toBe(want);
});

// A table that lost its rows would pass by running nothing.
test('the table holds both verdicts', () => {
  expect(cases.filter((c) => c[3] === true).length).toBeGreaterThan(0);
  expect(cases.filter((c) => c[3] === false).length).toBeGreaterThan(0);
});
