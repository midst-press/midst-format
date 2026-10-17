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
    strike: false,
  }),
];

export default poemExtensions;
