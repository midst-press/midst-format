/* eslint import/prefer-default-export: off */
import { generateJSON, generateHTML } from '@tiptap/html';
import { getSchema } from '@tiptap/core';
import { parse, serializeOuter } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
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

// The frame as the old player's browser parsed it: parse5 is the HTML standard's tree construction, as in Chromium.
// generateJSON parses with zeed-dom, which stops at a closing tag with nothing open to close and drops every word
// after it (midst-format #78). Here a stray </div> or </span> is ignored and a stray </p> becomes an empty <p></p>,
// a <p> opened inside a <p> closes the first, and the regex passes below see the browser's tree, not the file's.
// The elements a browser lays out as a line of their own; anything else at the top level is inline content.
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'table', 'hr', 'address', 'article', 'aside', 'details', 'fieldset', 'figure', 'figcaption', 'footer', 'form', 'header', 'main', 'nav', 'section']);
type Parse5Node = DefaultTreeAdapterMap['childNode'];
const isBlock = (n: Parse5Node) => BLOCK_TAGS.has(n.nodeName);
const isBlankText = (n: Parse5Node) =>
  n.nodeName === '#text' && 'value' in n && /^[ \n\r\t\f]*$/.test(n.value);
// A comment draws nothing: `<!--StartFragment-->`, left by a paste from a word processor, is no line (clement-7074f29f).
const drawsNothing = (n: Parse5Node) => isBlankText(n) || n.nodeName === '#comment';
// The top level as the lines a browser draws, each made a <p>: a run of inline content between blocks is an
// anonymous line, and a <div> holding no block is a line. TipTap makes a paragraph of each already, so the number of
// blocks is unchanged; written as <p>, the paragraph rules (dropTrailingBreaks, dropInvisibleParagraphs) reach them:
// a bare <br> between paragraphs, or <div><br></div>, is one line in a browser (midst-editor #15).
const asParagraphLines = (nodes: Parse5Node[]): string => {
  let out = '';
  let run: Parse5Node[] = [];
  const flush = () => {
    if (run.length > 0 && !run.every(drawsNothing))
      out += `<p>${run.map((n) => serializeOuter(n)).join('')}</p>`;
    else out += run.map((n) => serializeOuter(n)).join('');
    run = [];
  };
  for (const n of nodes) {
    if (!isBlock(n)) {
      run.push(n);
    } else {
      flush();
      if (n.nodeName === 'div' && 'childNodes' in n && !n.childNodes.some(isBlock)) {
        const attrs = 'attrs' in n ? n.attrs.map((a: { name: string; value: string }) => ` ${a.name}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('') : '';
        out += `<p${attrs}>${n.childNodes.map((c: Parse5Node) => serializeOuter(c)).join('')}</p>`;
      } else if (n.nodeName === 'div' && 'childNodes' in n) {
        // A <div> holding blocks: its children are lines as at the top level, so a <br> in an anonymous run inside it
        // is a <p> the paragraph rules reach (#85). TipTap flattened such a div into its blocks already.
        out += asParagraphLines(n.childNodes);
      } else out += serializeOuter(n);
    }
  }
  flush();
  return out;
};

export const asBrowserParsed = (html: string) => {
  const htmlEl = parse(`<!DOCTYPE html><body>${html}`).childNodes.find(
    (n) => n.nodeName === 'html'
  );
  const body =
    htmlEl && 'childNodes' in htmlEl
      ? htmlEl.childNodes.find((n) => n.nodeName === 'body')
      : undefined;
  if (!body || !('childNodes' in body))
    throw new Error('parse5 returned a document with no <body>');
  return asParagraphLines(body.childNodes);
};

// Parse as the editor does (Editor and Replay use preserveWhitespace: true).
// The default collapses tabs and drops a line-leading tab; poets use tabs for spacing.
const frameJSON = (html: string) =>
  generateJSON(dropTrailingBreaks(html), poemExtensions, {
    preserveWhitespace: true,
  });

// A private-use character, lengthened until neither the frame nor its text (character references decoded) contains
// it, nor `other`: every block that reads as it, or starts with it, is one this file put there.
const freshMark = (source: string, text: string, other = '', base = '\uE000'): string => {
  let mark = base;
  while (source.includes(mark) || text.includes(mark) || (other !== '' && other.includes(mark))) mark += base;
  return mark;
};

// The converted block of the one <p> whose data-line-number is `line`, or undefined when no <p> or more than one
// carries it. The <p> is marked by a private-use character at the start of its content, and the paragraphs
// dropInvisibleParagraphs removes are marked as in keptBlock, so one parse gives the kept blocks before it. When that
// <p> is itself one that is removed, the line maps to the last kept block before it, as keptBlock maps an index.
const NUMBERED_P = /<p\b[^>]*?\sdata-line-number="([^"]*)"[^>]*>/gi;
const numberedBlock = (source: string, line: number): number | undefined => {
  const hits: RegExpExecArray[] = [];
  NUMBERED_P.lastIndex = 0; // the library targets ES2019: no String.prototype.matchAll
  for (let m = NUMBERED_P.exec(source); m !== null; m = NUMBERED_P.exec(source))
    if (m[1].trim() !== '' && Number(m[1]) === line) hits.push(m);
  if (hits.length !== 1) return undefined;
  const open = hits[0];
  const at = open.index + open[0].length;
  const end = source.indexOf('</p>', at);
  if (end < 0) return undefined;
  const paragraph = source.slice(open.index, end + 4);
  const invisible = dropInvisibleParagraphs(paragraph) === '';
  const text = schema.nodeFromJSON(frameJSON(source)).textContent;
  const target = freshMark(source, text);
  const dropped = freshMark(source, text, target, '\uE001'); // a different character, so neither mark starts the other
  const withTarget = invisible
    ? `${source.slice(0, open.index)}<p>${target}</p>${source.slice(end + 4)}`
    : `${source.slice(0, at)}${target}${source.slice(at)}`;
  const doc = schema.nodeFromJSON(frameJSON(markInvisibleParagraphs(withTarget, dropped)));
  let kept = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const t = doc.child(i).textContent;
    // A dropped paragraph is checked first: its mark must never be read as the target's.
    if (t === dropped) continue;
    if (t.startsWith(target)) return invisible ? kept - 1 : kept;
    kept += 1;
  }
  return undefined; // the mark did not survive the parse: the index is used instead
};

// The recorded line counts the paragraphs dropInvisibleParagraphs removes, since they were in the old player's
// document, so the line is mapped through the drop: to the last block kept at or before it, which is the line
// itself when it was kept. Each dropped paragraph is first replaced by a marker paragraph, so the line can be read
// against the frame's blocks as the old player had them. The selection markers are already gone, and were never
// counted: the old editor's lineNumber is the data-line-number of the <p> holding the selection, numbered over the
// editor's <p> elements (reflowLineNumbers and captureTimelineFrame in the old player's source, kept in midst-web as
// e2e/legacy-player/Midst.ts, where both are commented out because that player does not record), and a marker is a
// <span>. Returns the block index in the converted document, or -1 for none.
//
// A recorded line is found by that attribute when exactly one <p> carries it (227,271 of the archive's 233,233
// frames, midst-format #69): the old editor renumbered only when the count of <p> changed, so an index can name the
// wrong line after paragraphs moved. With no such <p>, or more than one, the index is used as before. A missing,
// null or blank lineNumber names no line (Number() would read null and '' as 0).
const keptBlock = (source: string, lineNumber: unknown): number => {
  const blank =
    lineNumber === undefined ||
    lineNumber === null ||
    (typeof lineNumber === 'string' && lineNumber.trim() === '');
  const line = Number(lineNumber);
  if (blank || !Number.isFinite(line) || line < 0) return -1;
  const numbered = numberedBlock(source, Math.floor(line));
  if (numbered !== undefined) return numbered;
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
const ZERO_WIDTH_LINE_FILL = `[ \\n\\r\\f]|<(?:${ZERO_WIDTH_TAGS})\\b[^>]*>(?:[${ZERO_WIDTH_CHARS}]|${ZERO_WIDTH_ENTITY})+</(?:${ZERO_WIDTH_TAGS})>|<(?:${ZERO_WIDTH_TAGS})\\b${NOT_HIDDEN}[^>]*>|</(?:${ZERO_WIDTH_TAGS})>`;
const SHOWN_ZERO_WIDTH_LINE = new RegExp(
  `(<p\\b[^>]*>)(?:${ZERO_WIDTH_LINE_FILL})*?${SHOWN_ZERO_WIDTH_ELEMENT}(?:${ZERO_WIDTH_LINE_FILL})*(</p>)`,
  'gi'
);
// A hidden inline element left empty, e.g. a Rangy marker whose FEFF a bold command had wrapped in <b>, once that
// <b> is removed, perhaps still holding empty inline tags: display:none draws nothing, so it goes too, and the paragraph
// rule can then see what is left (#88). Never past a closing tag of its own name, so no stray closing tag is left.
const EMPTY_HIDDEN_ELEMENT = new RegExp(
  `<(span|em|strong|i|b|u|s|strike|a|font|sup|sub)\\b(?=[^>]*display\\s*:\\s*none)[^>]*>(?:</?(?!\\1\\b)(?:span|em|strong|i|b|u|s|strike|a|font|sup|sub)\\b[^>]*>)*</\\1>`,
  'gi'
);
export const dropZeroWidthOnlyElements = (html: string) => {
  let current = html.replace(SHOWN_ZERO_WIDTH_LINE, '$1<br>$2');
  let next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '').replace(EMPTY_HIDDEN_ELEMENT, '');
  while (next !== current) {
    current = next;
    next = current.replace(ZERO_WIDTH_ONLY_ELEMENT, '').replace(EMPTY_HIDDEN_ELEMENT, '');
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
    const source = dropZeroWidthOnlyElements(asBrowserParsed(el.content));
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
