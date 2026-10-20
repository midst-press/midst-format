// TRANSCRIBED VERBATIM from jshafto/midst-app src/main/util.ts lines 11-23.
// provenance.cjs asserts this matches the source bytes; if the source changes, the assert fails.
// TipTap comes from conformance/oracle/, its own package at 2.5.4, the version the old app ran: this file models the
// old app, so it must not move with the library (now on TipTap 3, #102). Run `npm ci --prefix conformance/oracle` first.
const oracle = require('module').createRequire(require('path').join(__dirname, 'oracle', 'package.json'));
const { generateJSON, generateHTML } = oracle('@tiptap/html');
const StarterKit = oracle('@tiptap/starter-kit').default || oracle('@tiptap/starter-kit');
const HardBreak = oracle('@tiptap/extension-hard-break').default || oracle('@tiptap/extension-hard-break');
// The option set mirrors src/extensions.ts (provenance.cjs). Under TipTap 2 the options TipTap 3 added are no-ops.
const extensions = [
  StarterKit.configure({
    bulletList: false,
    orderedList: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    listItem: false,
    hardBreak: false,
    strike: false,
    link: false,
    underline: false,
    listKeymap: false,
    trailingNode: false,
  }),
  HardBreak.extend({ linebreakReplacement: false }),
];
// Parse options mirror convertMidstFile's call (preserveWhitespace: true, as the editor parses).
// TRAILING_BREAK mirrors convert.ts (provenance.cjs asserts the two regexes are identical):
// a <br> that ends a paragraph is not a line, so the converter drops it before parsing.
const TRAILING_BREAK = /<br\s*\/?>((?:\s|<\/(?:em|strong|i|b|u|span|s|strike|a|font|sup|sub)>|<(?:em|strong|i|b|u|span|s|strike|a|font|sup|sub)\b(?![^>]*[\s;"'](?:white-space|display|min-height|height|margin|padding|border)[\w-]*\s*:)[^>]*>)*<\/p>)/gi;
const dropTrailingBreaks = (html) => html.replace(TRAILING_BREAK, '$1');
// The zero-width rule mirrors midst-editor util.ts (its e91b01b, GitHub #31; provenance.cjs asserts the declarations
// are identical): an inline element holding only zero-width characters (Rangy's display:none selection markers) is
// removed before parsing, so it does not become a paragraph of its own.
const ZERO_WIDTH_CHARS = '\\uFEFF\\u200B\\u200C\\u200D\\u2060';
const ZERO_WIDTH_ENTITY_CODES = [0xfeff, 0x200b, 0x200c, 0x200d, 0x2060];
const ZERO_WIDTH_ENTITY = ZERO_WIDTH_ENTITY_CODES.map(
  (c) => `&#(?:x0*${c.toString(16)}|0*${c});`
).join('|');
const ZERO_WIDTH_ONLY_ELEMENT = new RegExp(
  `<(span|em|strong|i|b|u|s|strike|a)\\b[^>]*>(?:[${ZERO_WIDTH_CHARS}]|${ZERO_WIDTH_ENTITY})+</\\1>`,
  'gi'
);
// A paragraph holding only zero-width-only elements the old player showed (not display:none) stays a blank line
// (midst-format #71); provenance.cjs asserts these declarations are identical to convert.ts's.
const ZERO_WIDTH_TAGS = 'span|em|strong|i|b|u|s|strike|a';
const NOT_HIDDEN = '(?![^>]*display\\s*:\\s*none)';
const SHOWN_ZERO_WIDTH_ELEMENT = `<(?:${ZERO_WIDTH_TAGS})\\b${NOT_HIDDEN}[^>]*>(?:[${ZERO_WIDTH_CHARS}]|${ZERO_WIDTH_ENTITY})+</(?:${ZERO_WIDTH_TAGS})>`;
const ZERO_WIDTH_LINE_FILL = `[ \\n\\r\\f]|<(?:${ZERO_WIDTH_TAGS})\\b[^>]*>(?:[${ZERO_WIDTH_CHARS}]|${ZERO_WIDTH_ENTITY})+</(?:${ZERO_WIDTH_TAGS})>|<(?:${ZERO_WIDTH_TAGS})\\b${NOT_HIDDEN}[^>]*>|</(?:${ZERO_WIDTH_TAGS})>`;
const SHOWN_ZERO_WIDTH_LINE = new RegExp(
  `(<p\\b[^>]*>)((?:${ZERO_WIDTH_LINE_FILL})*?${SHOWN_ZERO_WIDTH_ELEMENT}(?:${ZERO_WIDTH_LINE_FILL})*)(</p>)`,
  'gi'
);
// What such a line keeps: its whitespace, without the tags and zero-width characters around it (#98).
const ZERO_WIDTH_OR_TAG = new RegExp(`<[^>]*>|[${ZERO_WIDTH_CHARS}]|${ZERO_WIDTH_ENTITY}`, 'gi');
// A hidden inline element left empty, e.g. a Rangy marker whose FEFF a bold command had wrapped in <b>, once that
// <b> is removed, perhaps still holding empty inline tags: display:none draws nothing, so it goes too, and the paragraph
// rule can then see what is left (#88). Never past a closing tag of its own name, so no stray closing tag is left.
const EMPTY_HIDDEN_ELEMENT = new RegExp(
  `<(span|em|strong|i|b|u|s|strike|a|font|sup|sub)\\b(?=[^>]*display\\s*:\\s*none)[^>]*>(?:</?(?!\\1\\b)(?:span|em|strong|i|b|u|s|strike|a|font|sup|sub)\\b[^>]*>)*</\\1>`,
  'gi'
);
const dropZeroWidthOnlyElements = (html) => {
  let current = html.replace(
    SHOWN_ZERO_WIDTH_LINE,
    (_m, open, fill, close) =>
      `${open}${fill.replace(ZERO_WIDTH_OR_TAG, '')}<br>${close}`
  );
  let next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '').replace(EMPTY_HIDDEN_ELEMENT, '');
  while (next !== current) {
    current = next;
    next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '').replace(EMPTY_HIDDEN_ELEMENT, '');
  }
  return current;
};
// The invisible-paragraph rule mirrors convert.ts (midst-editor #169; provenance.cjs asserts the declarations are
// identical): a paragraph with nothing a browser draws had no height in the old player, so it is not a line.
const INLINE_TAGS = 'em|strong|i|b|u|span|s|strike|a|font|sup|sub';
const NO_BOX_STYLE = `(?![^>]*[\\s;"'](?:white-space|display|min-height|height|margin|padding|border)[\\w-]*\\s*:)`;
const INVISIBLE_PARAGRAPH = new RegExp(
  `<p\\b${NO_BOX_STYLE}[^>]*>(?:[ \\n\\r\\f]|<(?:${INLINE_TAGS})\\b${NO_BOX_STYLE}[^>]*>|</(?:${INLINE_TAGS})>)*</p>`,
  'gi'
);
const dropInvisibleParagraphs = (html) => {
  let current = html;
  let next = current.replace(INVISIBLE_PARAGRAPH, '');
  while (next !== current) {
    current = next;
    next = current.replace(INVISIBLE_PARAGRAPH, '');
  }
  return current;
};
// The frame as a browser parsed it, mirroring convert.ts's asBrowserParsed (midst-format #78): parse5, the HTML
// standard's tree construction, so a stray closing tag no longer ends the parse.
const { parse, serializeOuter } = require('parse5');
// Mirrors convert.ts's asParagraphLines: each top-level line a browser draws, written as a <p> (midst-editor #15).
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'table', 'hr', 'address', 'article', 'aside', 'details', 'fieldset', 'figure', 'figcaption', 'footer', 'form', 'header', 'main', 'nav', 'section']);
const isBlock = (n) => BLOCK_TAGS.has(n.nodeName);
const isBlankText = (n) => n.nodeName === '#text' && /^[ \n\r\t\f]*$/.test(n.value);
const drawsNothing = (n) => isBlankText(n) || n.nodeName === '#comment';
const asParagraphLines = (nodes) => {
  let out = '';
  let run = [];
  const flush = () => {
    if (run.length > 0 && !run.every(drawsNothing)) out += `<p>${run.map((n) => serializeOuter(n)).join('')}</p>`;
    else out += run.map((n) => serializeOuter(n)).join('');
    run = [];
  };
  for (const n of nodes) {
    if (!isBlock(n)) run.push(n);
    else {
      flush();
      if (n.nodeName === 'div' && !n.childNodes.some(isBlock)) {
        const attrs = n.attrs.map((a) => ` ${a.name}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
        out += `<p${attrs}>${n.childNodes.map((c) => serializeOuter(c)).join('')}</p>`;
      } else if (n.nodeName === 'div') {
        out += asParagraphLines(n.childNodes); // a <div> holding blocks: its children are lines (#85)
      } else out += serializeOuter(n);
    }
  }
  flush();
  return out;
};
const asBrowserParsed = (html) => {
  const htmlEl = parse(`<!DOCTYPE html><body>${html}`).childNodes.find((n) => n.nodeName === 'html');
  const body = htmlEl && htmlEl.childNodes.find((n) => n.nodeName === 'body');
  if (!body) throw new Error('parse5 returned a document with no <body>');
  return asParagraphLines(body.childNodes);
};
// The order matches convertMidstFile:
// dropTrailingBreaks(dropInvisibleParagraphs(dropZeroWidthOnlyElements(asBrowserParsed(html)))).
// Stored text is HTML as the HTML standard serializes it (docs/LIBRARY.md). The oracle's TipTap 2 (zeed-dom) differs
// in three characters of text (of &, <, >, ", ', U+00A0, tab and others probed, #102): a no-break space it writes raw, the standard as &nbsp;; " and ' it writes as &quot; and
// &apos;, the standard raw. Mapped here, once, in text only (between tags), so every comparison is exact.
const asStandardText = (html) =>
  html
    .replace(/\u00a0/g, '&nbsp;')
    .replace(/(^|>)([^<]*)/g, (whole, open, text) => open + text.replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
const normalise = (html) =>
  asStandardText(generateHTML(
    generateJSON(dropTrailingBreaks(dropInvisibleParagraphs(dropZeroWidthOnlyElements(asBrowserParsed(html)))), extensions, {
      preserveWhitespace: true,
    }),
    extensions,
  ));
module.exports = { extensions, normalise, asBrowserParsed, TRAILING_BREAK, dropTrailingBreaks, dropZeroWidthOnlyElements, dropInvisibleParagraphs };
