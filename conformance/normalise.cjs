// TRANSCRIBED VERBATIM from jshafto/midst-app src/main/util.ts lines 11-23.
// provenance.cjs asserts this matches the source bytes; if the source changes, the assert fails.
const { generateJSON, generateHTML } = require('@tiptap/html');
const StarterKit = require('@tiptap/starter-kit').default || require('@tiptap/starter-kit');
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
    strike: false,
  }),
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
  `(<p\\b[^>]*>)(?:${ZERO_WIDTH_LINE_FILL})*?${SHOWN_ZERO_WIDTH_ELEMENT}(?:${ZERO_WIDTH_LINE_FILL})*(</p>)`,
  'gi'
);
const dropZeroWidthOnlyElements = (html) => {
  let current = html.replace(SHOWN_ZERO_WIDTH_LINE, '$1<br>$2');
  let next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '');
  while (next !== current) {
    current = next;
    next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '');
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
const { parse, serialize } = require('parse5');
const asBrowserParsed = (html) => {
  const htmlEl = parse(`<!DOCTYPE html><body>${html}`).childNodes.find((n) => n.nodeName === 'html');
  const body = htmlEl && htmlEl.childNodes.find((n) => n.nodeName === 'body');
  if (!body) throw new Error('parse5 returned a document with no <body>');
  return serialize(body);
};
// The order matches convertMidstFile:
// dropTrailingBreaks(dropInvisibleParagraphs(dropZeroWidthOnlyElements(asBrowserParsed(html)))).
const normalise = (html) =>
  generateHTML(
    generateJSON(dropTrailingBreaks(dropInvisibleParagraphs(dropZeroWidthOnlyElements(asBrowserParsed(html)))), extensions, {
      preserveWhitespace: true,
    }),
    extensions,
  );
module.exports = { extensions, normalise, asBrowserParsed, TRAILING_BREAK, dropTrailingBreaks, dropZeroWidthOnlyElements, dropInvisibleParagraphs };
