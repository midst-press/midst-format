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
// What Replay does with pos, after renderEditor(html): editor.view.domAtPos(pos).node.scrollIntoView?.().
// Returns the top-level line index that scrolls into view, or a string: 'none' (a Text node: no
// scrollIntoView, nothing moves), 'editor' (the editor element itself: the whole poem is centred),
// 'throws' (domAtPos raised; Replay's effect would throw).
window.scrollTargetOfPos = (pos) => {
  let node;
  try {
    ({ node } = editor.view.domAtPos(pos));
  } catch (e) {
    return 'throws';
  }
  if (!node || typeof node.scrollIntoView !== 'function') return 'none';
  const root = editor.view.dom;
  if (node === root) return 'editor';
  let n = node;
  while (n && n.parentNode !== root) n = n.parentNode;
  return n ? Array.prototype.indexOf.call(root.childNodes, n) : 'none';
};
