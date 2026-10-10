// Each case must give its stated verdict, so the oracle can say both "equal" and "lost".
const { textOf } = require('./textexact.cjs');
const eq = (a, b) => textOf(a) === textOf(b);
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
];
let bad = 0;
for (const [n, a, b, want] of cases) { const got = eq(a, b); if (got !== want) bad++; console.log(`${got === want ? 'ok ' : 'BAD'} ${n}`); }
process.exit(bad ? 1 : 0);
