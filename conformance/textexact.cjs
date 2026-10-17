// Independent text oracle. The trajectory check compares the replay against normalise(frame),
// i.e. against the converter's own parse, so it cannot see anything that parse loses. This
// compares the CHARACTERS of the source frame with the replay, extracted inertly (no ProseMirror):
// tags removed, entities decoded, each line start (<p> or <br>) one separator, never collapsed.
// The one transformation allowed: a line break inside text (\n, \r\n or \r) reads as a space, as in the editor.
// textOf(html, { editor: true }) reads the EDITOR's HTML (the replay): ProseMirror draws a trailing hard break
// as a line, so the browser rule that drops one does not apply there.
const SEP = ' ';
const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return Object.hasOwn(NAMED, e) ? NAMED[e] : m;
  });
// A <br> that ends a paragraph or div is not drawn by a browser, so it is not a line. (Browser
// semantics, so p AND div; the converter's own rule is p only, for the editor's sake.)
const dropUndrawnBreaks = (html) => html.replace(/<br\s*\/?>((?:\s*<\/(?:em|strong|i|b|u|span|s|strike|a)>)*\s*<\/(?:p|div)>)/gi, '$1');
// An inline element holding only zero-width characters draws nothing (Rangy's selection markers are also
// display:none), so it is no part of any line. Written here independently of the converter, as browser semantics.
const ZW_ONLY_ELEMENT =
  /<(span|em|strong|i|b|u|s|strike|a)\b[^>]*>(?:[\uFEFF\u200B\u200C\u200D\u2060]|&#(?:x0*(?:feff|200b|200c|200d|2060)|0*(?:65279|8203|8204|8205|8288));)+<\/\1>/gi;
const dropUndrawnElements = (html) => {
  let current = html;
  let next = current.replace(ZW_ONLY_ELEMENT, '');
  while (next !== current) {
    current = next;
    next = current.replace(ZW_ONLY_ELEMENT, '');
  }
  return current;
};
// Inline content after a closed block is a line box of its own, as a browser draws it (midst-format #13): <p>a</p>x
// is two lines, a and x, and <p>a</p><br>x is three (the <br> ends an empty one). So a run of it, up to the next
// block, reads as its own paragraph, and the rules below then apply to it unchanged: a lone <br> there is still one
// empty line, as it always was. A run of whitespace alone is no line, and is left to the rule below that drops it.
const wrapLooseRuns = (html) =>
  html.replace(/(<\/(?:p|div)>)((?:(?!<\/?(?:p|div)\b)[\s\S])+)/gi, (m, close, run) => (/\S/.test(run) ? `${close}<p>${run}</p>` : m));
const textOf = (html, { editor = false } = {}) =>
  decode(
    (editor ? html : dropUndrawnBreaks(wrapLooseRuns(dropUndrawnElements(html))))
      // Whitespace BETWEEN paragraphs belongs to no line; the editor drops it, and so does this.
      .replace(/(^|<\/(?:p|div)>)\s+(?=<(?:p|div)\b|$)/gi, '$1')
      // One separator per line start: every <p>, <div> (how a browser saves a typed line) and <br>. Never collapsed, so the NUMBER
      // of empty lines (a stanza break) is compared, not just their presence.
      // A <div> that directly wraps another block is a container, not a line of its own.
      .replace(/<div\b[^>]*>(?=\s*<(?:p|div)\b)/gi, '')
      .replace(/<(?:p|div)\b[^>]*>|<br\s*\/?>/gi, SEP)
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\r\n?|\n/g, ' ')
    // The first line has no line before it.
    .replace(new RegExp(`^${SEP}`), '');
module.exports = { textOf };
