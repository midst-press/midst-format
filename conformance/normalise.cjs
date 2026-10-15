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
// TRAILING_BREAK mirrors midst-editor util.ts (provenance.cjs asserts the two regexes are identical):
// a <br> that ends a paragraph is not a line, so the converter drops it before parsing.
const TRAILING_BREAK = /<br\s*\/?>((?:\s*<\/(?:em|strong|i|b|u|span|s|strike|a)>)*\s*<\/p>)/gi;
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
const dropZeroWidthOnlyElements = (html) => {
  let current = html;
  let next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '');
  while (next !== current) {
    current = next;
    next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '');
  }
  return current;
};
// The order matches convertMidstFile: dropTrailingBreaks(dropZeroWidthOnlyElements(html)).
const normalise = (html) =>
  generateHTML(generateJSON(dropTrailingBreaks(dropZeroWidthOnlyElements(html)), extensions, { preserveWhitespace: true }), extensions);
module.exports = { extensions, normalise, TRAILING_BREAK, dropTrailingBreaks, dropZeroWidthOnlyElements };
