import HardBreak from '@tiptap/extension-hard-break';
import StarterKit from '@tiptap/starter-kit';

// What a poem may contain: paragraphs, line breaks, bold and italic. The editor, the replay and the
// conversion of old Midst files all read and write poems with this one schema, so a mark one of
// them allows cannot be dropped by another.
const poemExtensions = [
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
    // TipTap 3's StarterKit adds these four (#102). A poem has no links, no underline and no lists, and TrailingNode
    // would append a paragraph to a document that ends otherwise, a change the writer never made. Off, so the schema
    // and the documents are TipTap 2's.
    link: false,
    underline: false,
    listKeymap: false,
    trailingNode: false,
  }),
  // TipTap 3 marks the hard break as ProseMirror's linebreakReplacement, so a newline in a parsed text becomes a line
  // break. An old Midst frame's newline is a space, as the old player drew it and TipTap 2 parsed it; a break would add
  // a node and move every later history pos (#102). Same node, without the flag.
  HardBreak.extend({ linebreakReplacement: false }),
];

export default poemExtensions;
