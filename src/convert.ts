/* eslint import/prefer-default-export: off */
import { generateJSON, generateHTML } from '@tiptap/html';
import { getSchema } from '@tiptap/core';
import { compareStrings } from './history';
import poemExtensions from './extensions';

interface OldMidstTimelineFrame {
  content: string;
  lineNumber: string;
  timestamp: number;
}

interface NewFrames {
  content: string;
  pos: number;
  t: Date;
}

const CURRENT_VERSION = '1';
const CURRENT_VERSION_LIST = ['1', 'v0.0.1'];

// The header is exactly `midstVersion: <version>` on the first line, ending in \n or \r\n (#32): any other key
// is not a Midst header, and a Windows line ending must not make a current file look old.
// A leading byte order mark (older Windows editors add one when saving UTF-8) is allowed too (silas-397300f6).
const VERSION_HEADER = /^\uFEFF?midstVersion: (\S+?)\r?$/;
export const getFileVersion = (data: string) => {
  if (typeof data !== 'string') return '';
  const m = VERSION_HEADER.exec(data.split('\n', 1)[0]);
  return m ? m[1] : '';
};

export const stripVersionInfo = (data: string) => {
  return data.split('\n')[1];
};
export const includeVersionInfo = (data: string) => {
  return `midstVersion: ${CURRENT_VERSION}\n${data}`;
};

export const fileVersionMatchesCurrent = (data: string) => {
  const firstVersion = getFileVersion(data);
  return CURRENT_VERSION_LIST.includes(firstVersion);
};

// The schema the editor builds from the same extensions, so a position here is the editor's position.
const schema = getSchema(poemExtensions);

// A history entry's pos is a ProseMirror position in the document after the change (#36). An old file records
// only the cursor's line, as an index into the frame's blocks, so a converted pos is the end of that block's
// content: the nearest position the old record supports. Advisory, as every pos is (README, "Replaying
// format C"). A line past the last block names the last; with no usable line (negative, not a number) or no
// block, it is 0, the start of the document.
const endOfBlock = (
  doc: ReturnType<typeof schema.nodeFromJSON>,
  index: number
): number => {
  const blocks = index >= 0 ? Math.min(doc.childCount, index + 1) : 0;
  let size = 0;
  for (let i = 0; i < blocks; i += 1) size += doc.child(i).nodeSize;
  // The end of the last block's content is one before its closing token.
  return blocks === 0 ? 0 : size - 1;
};

// Parse as the editor does (Editor and Replay use preserveWhitespace: true).
// The default collapses tabs and drops a line-leading tab; poets use tabs for spacing.
const frameJSON = (html: string) =>
  generateJSON(dropTrailingBreaks(html), poemExtensions, {
    preserveWhitespace: true,
  });

// The recorded line counts the paragraphs dropInvisibleParagraphs removes, since they were in the old player's
// document, so the line is mapped through the drop: to the last block kept at or before it, which is the line
// itself when it was kept. Each dropped paragraph is first replaced by a marker paragraph, so the line can be read
// against the frame's blocks as the old player had them. The selection markers are already gone, and were never
// counted: the old editor's lineNumber is the data-line-number of the <p> holding the selection, numbered over the
// editor's <p> elements (reflowLineNumbers and captureTimelineFrame in the old player's source, kept in midst-web as
// e2e/legacy-player/Midst.ts), and a marker is a <span>. Returns the block index in the converted
// document, or -1 for none.
const keptBlock = (source: string, lineNumber: string): number => {
  const line = Number(lineNumber);
  if (!Number.isFinite(line) || line < 0) return -1;
  if (dropInvisibleParagraphs(source) === source) return Math.floor(line);
  // A private-use character, lengthened until neither the frame nor its text (character references decoded)
  // contains it, so every block that reads as the mark is a <p>mark</p> this function put there.
  const text = schema.nodeFromJSON(frameJSON(source)).textContent;
  let mark = '\uE000';
  while (source.includes(mark) || text.includes(mark)) mark += '\uE000';
  const marked = markInvisibleParagraphs(source, mark);
  const before = schema.nodeFromJSON(frameJSON(marked));
  // The kept blocks are the converted document's, in order. That holds because a block reads as the mark only if it
  // is one of the <p>mark</p> put here (the mark is in neither the frame nor its decoded text), and the parse keeps
  // each of those a block of its own. It did in 17 nested and container shapes (a <p> inside a <p>, an inline tag, a
  // div, li, blockquote, td, pre or h1) and in every frame of the 54 archive poems, converted at 26b83c9 with a check
  // that threw on any difference in the count (midst-format #65).
  const last = Math.min(before.childCount, Math.floor(line) + 1);
  let kept = 0;
  for (let i = 0; i < last; i += 1)
    if (before.child(i).textContent !== mark) kept += 1;
  return kept - 1;
};

// A browser never draws a <br> that is the last thing in its block: <p><br></p> is ONE empty line,
// <p>a<br></p> is one line. ProseMirror draws the same <br> as a hard break plus a trailing line, so
// every blank line of an old poem doubled. Drop exactly that one <br>; a second <br> before it is a real line and
// stays. What may follow it is anything that draws nothing: whitespace, and inline tags opening or closing with
// nothing in them, <font>, <sup> and <sub> included (contenteditable writes <font> for colour and size), but never a
// tag whose own style could give it a box or keep its whitespace (midst-editor #15). Paragraphs only: an emptied <div>
// would lose its line in the editor (render_lines, html-shape--div-as-line), and <div> lines are still open (#15).
const TRAILING_BREAK =
  /<br\s*\/?>((?:\s|<\/(?:em|strong|i|b|u|span|s|strike|a|font|sup|sub)>|<(?:em|strong|i|b|u|span|s|strike|a|font|sup|sub)\b(?![^>]*[\s;"'](?:white-space|display|min-height|height|margin|padding|border)[\w-]*\s*:)[^>]*>)*<\/p>)/gi;
export const dropTrailingBreaks = (html: string) =>
  html.replace(TRAILING_BREAK, '$1');

// Characters that draw nothing: BOM / zero-width no-break space (U+FEFF, what Rangy's selection markers
// hold), zero-width space, non-joiner, joiner (U+200B-U+200D) and word joiner (U+2060).
export const ZERO_WIDTH_CHARS = '\\uFEFF\\u200B\\u200C\\u200D\\u2060';
const ZERO_WIDTH_ENTITY_CODES = [0xfeff, 0x200b, 0x200c, 0x200d, 0x2060];
const ZERO_WIDTH_ENTITY = ZERO_WIDTH_ENTITY_CODES.map(
  (c) => `&#(?:x0*${c.toString(16)}|0*${c});`
).join('|');
// One inline element holding nothing but zero-width characters (literal or as a character reference),
// no child tag. Paragraphs and divs are not inline elements, so a blank line the poet left is never matched.
const ZERO_WIDTH_ONLY_ELEMENT = new RegExp(
  `<(span|em|strong|i|b|u|s|strike|a)\\b[^>]*>(?:[${ZERO_WIDTH_CHARS}]|${ZERO_WIDTH_ENTITY})+</\\1>`,
  'gi'
);

// Old files hold Rangy's selection markers, e.g. <span class="rangySelectionBoundary"
// style="display: none;">&#xFEFF;</span>: invisible in the old player, no authored content. TipTap has no
// span mark, so it unwraps the span and the FEFF becomes a paragraph of its own: the poem starts a line
// lower than written. Remove such elements before parsing. Zero-width characters beside visible text are
// left alone, and so are <p><br></p> and <p></p>. Repeats so a marker wrapped in a marker goes too.
//
// Rangy's markers are display:none, but a zero-width-only element without it is drawn: a paragraph holding only
// one is a line in the old player, as a browser draws the zero-width character's line box (#71). Removing it left
// <p></p>, which dropInvisibleParagraphs then drops, losing that line. So a paragraph whose only content is such
// SHOWN elements, with hidden ones, empty inline tags and whitespace around them, becomes <p><br></p> first: the
// blank line it was, without the invisible character. Elsewhere, beside text or outside a paragraph, they go as before.
const ZERO_WIDTH_TAGS = 'span|em|strong|i|b|u|s|strike|a';
const NOT_HIDDEN = '(?![^>]*display\\s*:\\s*none)';
const SHOWN_ZERO_WIDTH_ELEMENT = `<(?:${ZERO_WIDTH_TAGS})\\b${NOT_HIDDEN}[^>]*>(?:[${ZERO_WIDTH_CHARS}]|${ZERO_WIDTH_ENTITY})+</(?:${ZERO_WIDTH_TAGS})>`;
const ZERO_WIDTH_LINE_FILL = `\\s|<(?:${ZERO_WIDTH_TAGS})\\b[^>]*>(?:[${ZERO_WIDTH_CHARS}]|${ZERO_WIDTH_ENTITY})+</(?:${ZERO_WIDTH_TAGS})>|<(?:${ZERO_WIDTH_TAGS})\\b${NOT_HIDDEN}[^>]*>|</(?:${ZERO_WIDTH_TAGS})>`;
const SHOWN_ZERO_WIDTH_LINE = new RegExp(
  `(<p\\b[^>]*>)(?:${ZERO_WIDTH_LINE_FILL})*?${SHOWN_ZERO_WIDTH_ELEMENT}(?:${ZERO_WIDTH_LINE_FILL})*(</p>)`,
  'gi'
);
export const dropZeroWidthOnlyElements = (html: string) => {
  let current = html.replace(SHOWN_ZERO_WIDTH_LINE, '$1<br>$2');
  let next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '');
  while (next !== current) {
    current = next;
    next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '');
  }
  return current;
};

// A paragraph that draws nothing in the old player: no text, no <br>, no no-break space, no tab, only collapsible
// whitespace (space, newline) and inline tags with nothing in them. The old player's only paragraph rule is
// `.editor .editable p { margin: 0; padding: 0; }` (midst-web's seed, midst-player-hack/style.css): no minimum
// height and no white-space, so such a paragraph is zero height and the poet never saw it as a line. ProseMirror
// draws every paragraph, so each became a blank line (midst-editor #169). A tag whose own style could give it a
// box or keep its whitespace (white-space, display, height, min-height, margin, padding or border, longhands such as
// padding-left or margin-top included) is never matched, and nor is anything not listed here: such a paragraph is
// kept, as before. Runs before dropTrailingBreaks, which turns the
// visible <p><br></p> into <p></p>. Repeats, so a paragraph emptied by the removal of one inside it goes too.
const INLINE_TAGS = 'em|strong|i|b|u|span|s|strike|a|font|sup|sub';
const NO_BOX_STYLE = `(?![^>]*[\\s;"'](?:white-space|display|min-height|height|margin|padding|border)[\\w-]*\\s*:)`;
const INVISIBLE_PARAGRAPH = new RegExp(
  `<p\\b${NO_BOX_STYLE}[^>]*>(?:[ \\n\\r\\f]|<(?:${INLINE_TAGS})\\b${NO_BOX_STYLE}[^>]*>|</(?:${INLINE_TAGS})>)*</p>`,
  'gi'
);
const replaceInvisibleParagraphs = (html: string, by: string) => {
  let current = html;
  let next = current.replace(INVISIBLE_PARAGRAPH, by);
  while (next !== current) {
    current = next;
    next = current.replace(INVISIBLE_PARAGRAPH, by);
  }
  return current;
};
export const dropInvisibleParagraphs = (html: string) =>
  replaceInvisibleParagraphs(html, '');
// The same paragraphs, each replaced by <p>mark</p> instead of removed, for mapping a recorded line.
const markInvisibleParagraphs = (html: string, mark: string) =>
  replaceInvisibleParagraphs(html, `<p>${mark}</p>`);

/**
 * Format B's per-poem presentation, as format C's `meta` (midst-format docs/META.md). Each field
 * is copied unchanged; a field B does not have is left out, so the reader's default applies.
 */
export const metaFromOldMidst = (old: Record<string, unknown> = {}) => {
  const meta: Record<string, unknown> = {};
  if ('editorFontFamily' in old) meta.fontFamily = old.editorFontFamily;
  if ('editorFontSize' in old) meta.fontSize = old.editorFontSize;
  if (Array.isArray(old.editorDraftMarkers))
    meta.draftMarkers = old.editorDraftMarkers.map(
      ({ timelineIndex, ...rest }: Record<string, unknown>) => ({
        index: timelineIndex,
        ...rest,
      })
    );
  if ('editorHighestEverDraftNumber' in old)
    meta.highestDraftNumber = old.editorHighestEverDraftNumber;
  if ('editorTitle' in old) meta.title = old.editorTitle;
  // No author: a poem file carries no name by design (Annelyse; Stuart, 18 Oct; Gitea #181).
  return meta;
};

// A poem file carries no author (Gitea #181): a writer is never made to attach a name to their work.
// A file converted before that decision may still hold one (the old app's placeholder), so a save drops
// it. Every other key is written back unchanged.
const withoutAuthor = (meta: unknown) => {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta))
    return meta;
  const { author, ...rest } = meta as Record<string, unknown>;
  return rest;
};

/**
 * The file body the editor saves. `meta` is the stored JSON string ('' when the document has
 * none) and every key is written back unchanged, unknown keys included, so a save never loses one,
 * except `author`, which a save drops (#181).
 */
export const serializeDocument = (
  text: string,
  history: string,
  meta: string
) =>
  JSON.stringify({
    text,
    history: JSON.parse(history),
    ...(meta ? { meta: withoutAuthor(JSON.parse(meta)) } : {}),
  });

export const convertMidstFile = (oldMidst: string) => {
  const oldMidstJSON = JSON.parse(oldMidst);
  const frames = oldMidstJSON.editorTimelineFrames;

  const newFrames = frames.map((el: OldMidstTimelineFrame) => {
    const source = dropZeroWidthOnlyElements(el.content);
    const jsonContentAtFrame = frameJSON(dropInvisibleParagraphs(source));
    const htmlContentAtFrame = generateHTML(jsonContentAtFrame, poemExtensions);
    const doc = schema.nodeFromJSON(jsonContentAtFrame);
    const position = endOfBlock(doc, keptBlock(source, el.lineNumber));

    return {
      content: htmlContentAtFrame,
      pos: position,
      t: new Date(el.timestamp),
    };
  });
  const history = newFrames.map((el: NewFrames, ind: number) => {
    if (ind === 0) {
      return compareStrings('', el.content, el.pos, el.t);
    }
    return compareStrings(newFrames[ind - 1].content, el.content, el.pos, el.t);
  });
  const text = newFrames[newFrames.length - 1].content;

  const fullContents = JSON.stringify({
    text,
    history,
    meta: metaFromOldMidst(oldMidstJSON.meta),
  });
  return fullContents;
};
