/* eslint import/prefer-default-export: off */
import { generateJSON, generateHTML } from '@tiptap/html';
import { JSONContent } from '@tiptap/core';
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

export const getFileVersion = (data: string) => {
  try {
    const rows = data.split('\n');
    return rows[0].split(': ')[1];
  } catch {
    return '';
  }
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

const getTextLengthFromJSONContent = (doc: JSONContent): number => {
  // count all the characters (hard breaks are two)
  // each is a line of text or hardbreak
  // then that text count is actually the position
  if (doc.type === 'text') {
    return doc.text?.length || 0;
  }
  if (doc.type === 'hardBreak') {
    return 2;
  }
  if (doc.type === 'paragraph' || doc.type === 'doc') {
    const contents = doc.content || [];
    const lengths: number[] = contents.map((item) => {
      return getTextLengthFromJSONContent(item);
    });
    const amount = lengths.reduce((partialSum, a) => partialSum + a, 1);
    return amount;
  }
  return 0;
};

// A browser never draws a <br> that is the last thing in its block: <p><br></p> is ONE empty line,
// <p>a<br></p> is one line. ProseMirror draws the same <br> as a hard break plus a trailing line, so
// every blank line of an old poem doubled. Drop exactly that one <br> (closing inline tags may follow
// it); a second <br> before it is a real line and stays. Paragraphs only: an emptied <div> would lose
// its line in the editor (measured by midst-format's render_lines, html-shape--div-as-line).
const TRAILING_BREAK =
  /<br\s*\/?>((?:\s*<\/(?:em|strong|i|b|u|span|s|strike|a)>)*\s*<\/p>)/gi;
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
export const dropZeroWidthOnlyElements = (html: string) => {
  let current = html;
  let next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '');
  while (next !== current) {
    current = next;
    next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '');
  }
  return current;
};

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
    // Parse as the editor does (Editor and Replay use preserveWhitespace: true).
    // The default collapses tabs and drops a line-leading tab; poets use tabs for spacing.
    const jsonContentAtFrame = generateJSON(
      dropTrailingBreaks(dropZeroWidthOnlyElements(el.content)),
      poemExtensions,
      {
        preserveWhitespace: true,
      }
    );
    const htmlContentAtFrame = generateHTML(jsonContentAtFrame, poemExtensions);
    // get the slice of the content before the line number
    const truncatedJsonContentAtFrame = {
      ...jsonContentAtFrame,
      content: jsonContentAtFrame.content.slice(0, Number(el.lineNumber) + 1),
    };
    const position = getTextLengthFromJSONContent(truncatedJsonContentAtFrame);

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
