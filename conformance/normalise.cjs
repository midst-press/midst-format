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
const normalise = (html) => generateHTML(generateJSON(dropTrailingBreaks(html), extensions, { preserveWhitespace: true }), extensions);
module.exports = { extensions, normalise, TRAILING_BREAK, dropTrailingBreaks };
