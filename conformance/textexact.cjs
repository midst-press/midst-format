// Independent text oracle. The trajectory check compares the replay against normalise(frame),
// i.e. against the converter's own parse, so it cannot see anything that parse loses. This
// compares the CHARACTERS of the source frame with the replay, extracted inertly (no ProseMirror):
// tags removed, entities decoded, each line start (<p> or <br>) one separator, never collapsed.
// The source is read as a browser built it (asBuilt, below); the editor's HTML, written by ProseMirror, is read as it is.
// The one transformation allowed: a line break inside text (\n, \r\n or \r) reads as a space, as in the editor.
// textOf(html, { editor: true }) reads the EDITOR's HTML (the replay): ProseMirror draws a trailing hard break
// as a line, so the browser rule that drops one does not apply there.
const SEP = ' ';
// The source as the old player's browser built it (midst-format #81): parse5 is the HTML standard's tree construction,
// as in Chromium. Read lexically, `<p>a<p>b`, a stray `</p>` or `<p><br><p>` counted line starts the browser never
// drew. This is textexact's own parse and walk, not the converter's asBrowserParsed, and no converter rule runs on it:
// the rules below then read the browser's tree, serialised, instead of the tags as written. Two things are done on the
// tree, as a browser lays it out:
//   - an element with display:none draws nothing, whatever it holds, so it goes with everything inside it (a Rangy
//     marker whose FEFF a bold command wrapped in <b>, archive poem #28);
//   - a <div> holding blocks is a container, not a line: its blocks are its lines, and inline content beside them is an
//     anonymous line of its own (`<div><br><p>` is two lines, not three).
const { parse, serializeOuter } = require('parse5');
const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'pre']);
const isHidden = (n) => (n.attrs || []).some((a) => a.name === 'style' && /display\s*:\s*none/i.test(a.value));
const dropHidden = (n) => {
  if (!n.childNodes) return;
  n.childNodes = n.childNodes.filter((c) => !isHidden(c));
  n.childNodes.forEach(dropHidden);
};
const drawsNothing = (n) => (n.nodeName === '#text' && /^[ \n\r\t\f]*$/.test(n.value)) || n.nodeName === '#comment';
const lines = (nodes, top = false) => {
  let out = '';
  let run = [];
  const flush = (inContainer) => {
    const html = run.map((c) => serializeOuter(c)).join('');
    out += inContainer && !run.every(drawsNothing) ? `<p>${html}</p>` : html;
    run = [];
  };
  // The top level is left to wrapLooseRuns below, which runs after the zero-width rules.
  const inContainer = !top && nodes.some((c) => BLOCKS.has(c.nodeName));
  for (const n of nodes) {
    if (!BLOCKS.has(n.nodeName)) run.push(n);
    else {
      flush(inContainer);
      out += n.nodeName === 'div' && n.childNodes.some((c) => BLOCKS.has(c.nodeName)) ? lines(n.childNodes) : serializeOuter(n);
    }
  }
  flush(false);
  return out;
};
const asBuilt = (html) => {
  const htmlEl = parse(`<!DOCTYPE html><body>${html}`).childNodes.find((n) => n.nodeName === 'html');
  const body = htmlEl && htmlEl.childNodes.find((n) => n.nodeName === 'body');
  if (!body) throw new Error('parse5 returned a document with no <body>');
  dropHidden(body);
  return lines(body.childNodes, true);
};
const NAMED = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return Object.hasOwn(NAMED, e) ? NAMED[e] : m;
  });
// A <br> that ends a paragraph or div is not drawn by a browser, so it is not a line. (Browser
// semantics, so p AND div; the converter's own rule is p only, for the editor's sake.)
// What may follow it is anything that draws nothing: whitespace, and inline tags opening or closing with nothing in
// them, <font>, <sup> and <sub> included (midst-editor #15); a tag that keeps its whitespace is never passed over.
const INLINE = 'em|strong|i|b|u|span|s|strike|a|font|sup|sub';
const UNDRAWN_BREAK = new RegExp(`<br\\s*\\/?>((?:\\s|<\\/(?:${INLINE})>|<(?:${INLINE})\\b(?![^>]*white-space)[^>]*>)*<\\/(?:p|div)>)`, 'gi');
const dropUndrawnBreaks = (html) => html.replace(UNDRAWN_BREAK, '$1');
// An inline element holding only zero-width characters draws nothing (Rangy's selection markers are also
// display:none), so it is no part of any line. Written here independently of the converter, as browser semantics.
const ZW_ONLY_ELEMENT =
  /<(span|em|strong|i|b|u|s|strike|a)\b[^>]*>(?:[\uFEFF\u200B\u200C\u200D\u2060]|&#(?:x0*(?:feff|200b|200c|200d|2060)|0*(?:65279|8203|8204|8205|8288));)+<\/\1>/gi;
// Only a HIDDEN one draws nothing at all. One without display:none is drawn: alone in a paragraph it is that
// paragraph's line, though its character has no width (midst-format #71, measured in Chromium). So hidden ones go
// before the paragraph rule below, which then sees the shown one's character and keeps its line; all go after it.
const HIDDEN_ZW_ONLY_ELEMENT =
  /<(span|em|strong|i|b|u|s|strike|a)\b(?=[^>]*display\s*:\s*none)[^>]*>(?:[\uFEFF\u200B\u200C\u200D\u2060]|&#(?:x0*(?:feff|200b|200c|200d|2060)|0*(?:65279|8203|8204|8205|8288));)+<\/\1>/gi;
const dropHiddenElements = (html) => {
  let current = html;
  for (;;) {
    const next = current.replace(HIDDEN_ZW_ONLY_ELEMENT, '');
    if (next === current) return current;
    current = next;
  }
};
const dropUndrawnElements = (html) => {
  let current = html;
  let next = current.replace(ZW_ONLY_ELEMENT, '');
  while (next !== current) {
    current = next;
    next = current.replace(ZW_ONLY_ELEMENT, '');
  }
  return current;
};
// A paragraph with nothing a browser draws (no <br>, no text after entities are decoded, only collapsible spaces and
// newlines, nothing under a white-space that keeps them) has no height in the old player, so it is no line
// (midst-editor #169). Written here independently of the converter, as browser semantics: decoded text, not a regex
// over tags.
const undrawnParagraph = (inner) =>
  !/<br\b/i.test(inner) && !/white-space\s*:/i.test(inner) && /^[ \n\r\f]*$/.test(decode(inner.replace(/<[^>]*>/g, '')));
const dropUndrawnParagraphs = (html) => {
  let current = html;
  for (;;) {
    const next = current.replace(/<p\b([^>]*)>((?:(?!<\/?p\b)[\s\S])*)<\/p>/gi, (m, attrs, inner) =>
      !/white-space\s*:/i.test(attrs) && undrawnParagraph(inner) ? '' : m,
    );
    if (next === current) return current;
    current = next;
  }
};
// Inline content after a closed block is a line box of its own, as a browser draws it (midst-format #13): <p>a</p>x
// is two lines, a and x, and <p>a</p><br>x is three (the <br> ends an empty one). So a run of it, up to the next
// block, reads as its own paragraph, and the rules below then apply to it unchanged: a lone <br> there is still one
// empty line, as it always was. A run of whitespace alone is no line, and is left to the rule below that drops it.
const wrapLooseRuns = (html) =>
  html.replace(/(<\/(?:p|div)>)((?:(?!<\/?(?:p|div)\b)[\s\S])+)/gi, (m, close, run) => (/\S/.test(run) ? `${close}<p>${run}</p>` : m));
const textOf = (html, { editor = false } = {}) =>
  decode(
    (editor ? html : dropUndrawnBreaks(wrapLooseRuns(dropUndrawnElements(dropUndrawnParagraphs(dropHiddenElements(asBuilt(html)))))))
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
