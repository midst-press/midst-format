import { getSchema, resolveExtensions } from '@tiptap/core';
import { generateJSON } from '@tiptap/html/server';
import poemExtensions from '../extensions';

// What a poem may contain, pinned (#102): TipTap 3's StarterKit turns on more than TipTap 2's did, and a schema or
// plugin that widens without a test would change what the editor writes and what conversion keeps.

test('the schema is paragraphs, text and line breaks, with bold, italic, underline and strike', () => {
  const schema = getSchema(poemExtensions);
  expect(Object.keys(schema.nodes).sort()).toEqual(['doc', 'hardBreak', 'paragraph', 'text']);
  expect(Object.keys(schema.marks).sort()).toEqual(['bold', 'italic', 'strike', 'underline']);
  // A newline in parsed text stays text, as in TipTap 2: no node is a linebreakReplacement.
  expect(schema.linebreakReplacement).toBeNull();
});

test('the extensions are those, plus editing behaviour only: undo, the drop and gap cursors', () => {
  const names = resolveExtensions(poemExtensions).map((extension) => extension.name);
  expect(names.sort()).toEqual(
    ['bold', 'doc', 'dropCursor', 'gapCursor', 'hardBreak', 'italic', 'paragraph', 'starterKit', 'strike', 'text', 'underline', 'undoRedo'].sort(),
  );
});

// #140: every way a document spells underline and strikethrough parses to the two marks, as styled bold and italic
// spans do (#102). Synthetic text only.
test.each([
  ['<u>x</u>', 'underline'],
  ['<span style="text-decoration: underline">x</span>', 'underline'],
  ['<s>x</s>', 'strike'],
  ['<del>x</del>', 'strike'],
  ['<strike>x</strike>', 'strike'],
  ['<span style="text-decoration: line-through">x</span>', 'strike'],
])('%s parses to the %s mark', (inline, mark) => {
  const doc = generateJSON(`<p>${inline}</p>`, poemExtensions, { preserveWhitespace: true });
  expect(doc.content[0].content[0]).toEqual({ type: 'text', text: 'x', marks: [{ type: mark }] });
});

// CONTROL: a mark the schema still leaves out is dropped, so the test above can tell kept from dropped.
test('a mark still off (code) is dropped', () => {
  const doc = generateJSON('<p><code>x</code></p>', poemExtensions, { preserveWhitespace: true });
  expect(doc.content[0].content[0]).toEqual({ type: 'text', text: 'x' });
});
