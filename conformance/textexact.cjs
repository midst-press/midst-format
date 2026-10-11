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
const textOf = (html, { editor = false } = {}) =>
  decode(
    (editor ? html : dropUndrawnBreaks(html))
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
