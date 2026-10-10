// Independent text oracle. The trajectory check compares the replay against normalise(frame),
// i.e. against the converter's own parse, so it cannot see anything that parse loses. This
// compares the CHARACTERS of the source frame with the replay, extracted inertly (no ProseMirror):
// tags removed, entities decoded, each line start (<p> or <br>) one separator, never collapsed.
// The one transformation allowed: a line break inside text (\n, \r\n or \r) reads as a space, as in the editor.
const SEP = ' ';
const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return Object.hasOwn(NAMED, e) ? NAMED[e] : m;
  });
const textOf = (html) =>
  decode(
    html
      // Whitespace BETWEEN paragraphs belongs to no line; the editor drops it, and so does this.
      .replace(/(^|<\/p>)\s+(?=<p\b|$)/gi, '$1')
      // One separator per line start: every <p> and every <br>. Never collapsed, so the NUMBER
      // of empty lines (a stanza break) is compared, not just their presence.
      .replace(/<p\b[^>]*>|<br\s*\/?>/gi, SEP)
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\r\n?|\n/g, ' ')
    // The first line has no line before it.
    .replace(new RegExp(`^${SEP}`), '');
module.exports = { textOf };
