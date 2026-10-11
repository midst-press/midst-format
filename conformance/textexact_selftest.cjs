// Each case must give its stated verdict, so the oracle can say both "equal" and "lost".
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
  ['space inside a paragraph still counts', '<p>a</p><p> </p><p>b</p>', '<p>a</p><p>b</p>', false],
  ['space-only line kept vs empty line', '<p> </p>', '<p></p>', false],
  ['empty line dropped', '<p>a</p><p></p><p>b</p>', '<p>a</p><p>b</p>', false],
  ['two empty lines vs one', '<p>a</p><p></p><p></p><p>b</p>', '<p>a</p><p></p><p>b</p>', false],
  ['br-only line dropped', '<p>a</p><p><br></p><p>b</p>', '<p>a</p><p>b</p>', false],
  ['double br vs single', '<p>a<br><br>b</p>', '<p>a<br>b</p>', false],
  ['leading empty lines dropped', '<p></p><p></p><p>a</p>', '<p>a</p>', false],
  ['trailing empty line dropped', '<p>a</p><p></p>', '<p>a</p>', false],
  ['text before first paragraph is a line', 'x<p>a</p>', '<p>x</p><p>a</p>', true],
  ['empty doc vs one empty line', '', '<p></p>', true],
  ['blank line saved with <br> equals an empty paragraph', '<p>a</p><p><br></p><p>b</p>', '<p>a</p><p></p><p>b</p>', true],
  ['trailing <br> is not a line', '<p>a<br></p>', '<p>a</p>', true],
  ['two trailing <br> keep one line', '<p>a<br><br></p>', '<p>a</p>', false],
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
let bad = 0;
for (const [n, a, b, want, side] of cases) { const got = eq(a, b, side); if (got !== want) bad++; console.log(`${got === want ? 'ok ' : 'BAD'} ${n}`); }
process.exit(bad ? 1 : 0);
