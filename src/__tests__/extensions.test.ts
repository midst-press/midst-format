import { getSchema, resolveExtensions } from '@tiptap/core';
import poemExtensions from '../extensions';

// What a poem may contain, pinned (#102): TipTap 3's StarterKit turns on more than TipTap 2's did, and a schema or
// plugin that widens without a test would change what the editor writes and what conversion keeps.

test('the schema is paragraphs, text and line breaks, with bold and italic', () => {
  const schema = getSchema(poemExtensions);
  expect(Object.keys(schema.nodes).sort()).toEqual(['doc', 'hardBreak', 'paragraph', 'text']);
  expect(Object.keys(schema.marks).sort()).toEqual(['bold', 'italic']);
  // A newline in parsed text stays text, as in TipTap 2: no node is a linebreakReplacement.
  expect(schema.linebreakReplacement).toBeNull();
});

test('the extensions are those, plus editing behaviour only: undo, the drop and gap cursors', () => {
  const names = resolveExtensions(poemExtensions).map((extension) => extension.name);
  expect(names.sort()).toEqual(
    ['bold', 'doc', 'dropCursor', 'gapCursor', 'hardBreak', 'italic', 'paragraph', 'starterKit', 'text', 'undoRedo'].sort(),
  );
});
