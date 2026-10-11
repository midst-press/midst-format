// Bundled into the Chromium page by render_lines.cjs: a REAL TipTap editor with midst-editor's
// extension set (normalise.cjs mirrors it, provenance-checked), so the editor side is rendered, not modelled.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
const extensions = [
  StarterKit.configure({
    bulletList: false, orderedList: false, blockquote: false, code: false, codeBlock: false,
    heading: false, horizontalRule: false, listItem: false, strike: false,
  }),
];
let editor = null;
window.renderEditor = (html) => {
  const el = document.getElementById('e');
  if (editor) editor.destroy();
  el.innerHTML = '';
  editor = new Editor({ element: el, extensions, content: html, parseOptions: { preserveWhitespace: true } });
  return el.getBoundingClientRect().height;
};
// The top-level line (paragraph index) a ProseMirror position falls in, after renderEditor(html): what Replay's
// domAtPos(pos) scrolls to. Clamped to the document, as a position past the end would throw.
window.lineOfPos = (pos) => {
  const doc = editor.state.doc;
  return doc.resolve(Math.max(0, Math.min(pos, doc.content.size))).index(0);
};
