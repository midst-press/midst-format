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
const normalise = (html) => generateHTML(generateJSON(html, extensions, { preserveWhitespace: true }), extensions);
module.exports = { extensions, normalise };
