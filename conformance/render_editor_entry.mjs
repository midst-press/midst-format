// Bundled into the Chromium page by render_lines.cjs: a REAL TipTap editor with the poem schema itself
// (src/extensions.ts, the one the editor uses), so the editor side is rendered, not modelled.
import { Editor } from '@tiptap/core';
import extensions from '../src/extensions';
let editor = null;
window.renderEditor = (html) => {
  const el = document.getElementById('e');
  if (editor) editor.destroy();
  el.innerHTML = '';
  editor = new Editor({ element: el, extensions, content: html, parseOptions: { preserveWhitespace: true } });
  return el.getBoundingClientRect().height;
};
