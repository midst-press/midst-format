// The failing fixtures for no_text.test.cjs, and the marker words hidden in them. Shared by the test,
// which builds the archives and searches the outputs, and no_text_child.cjs, which verifies them.
const MARK = {
  frame: 'QUIXOTICFRAMEMARK', // in the text of a frame
  json: 'XYLOQUARTZ', // at the start of a file that is not JSON (JSON.parse quotes about ten characters)
  entry: 'ZEPHYRENTRYMARK', // in the name of an entry inside the zip
  key: 'KUMQUATKEYMARK', // in a JSON key of a file with no frames array
  thrown: 'OBSIDIANTHROWNMARK', // in the message of an exception the converter throws
  object: 'JACARANDAOBJECTMARK', // in the zip's own file name
  meta: 'MARZIPANMETAMARK', // in a title and a draft marker's name (docs/META.md: poem data)
};
const FRAMES = ['<p>a</p>', `<p>a ${MARK.frame}</p>`, `<p>a ${MARK.frame} b</p>`, `<p>a ${MARK.frame} b c</p>`];
const B = (frames) =>
  JSON.stringify({ editorTimelineFrames: frames.map((content, i) => ({ content, lineNumber: '0', timestamp: i })), meta: {} });

// name -> { entries: {entry name: content}, convert: 'ok' | 'corrupt' | 'throw' }, or raw bytes for a broken zip
const CASES = {
  passes: { entries: { 'inner.midst': B(FRAMES) }, convert: 'ok' },
  mismatch: { entries: { 'inner.midst': B(FRAMES) }, convert: 'corrupt' },
  'two-entries': { entries: { [`${MARK.entry}-one.midst`]: B(FRAMES), [`${MARK.entry}-two.midst`]: B(FRAMES) }, convert: 'ok' },
  'not-json': { entries: { 'inner.midst': `${MARK.json} is not JSON` }, convert: 'ok' },
  'no-frames': { entries: { 'inner.midst': JSON.stringify({ [MARK.key]: [1] }) }, convert: 'ok' },
  'converter-throws': { entries: { 'inner.midst': B(FRAMES) }, convert: 'throw' },
  // The first bad frame is ONE short word: the case where a printed hash and length could be inverted.
  'short-frame': { entries: { 'inner.midst': B(['<p>a</p>', '<p>cat</p>', '<p>cat sat</p>']) }, convert: 'corrupt' },
  'long-history': { entries: { 'inner.midst': B(FRAMES) }, convert: 'extra' },
  'broken-zip': { raw: 'this is not a zip archive' },
  // A title and a marker name are poem data. A converter that drops meta must fail without either
  // reaching any output.
  'meta-dropped': {
    entries: {
      'inner.midst': JSON.stringify({
        ...JSON.parse(B(FRAMES)),
        meta: {
          editorTitle: `${MARK.meta} title`,
          editorDraftMarkers: [{ timelineIndex: 1, name: `${MARK.meta} draft`, defaultName: 'Draft 1' }],
        },
      }),
    },
    convert: 'nometa',
  },
};
const zipName = (c) => `synthetic--${MARK.object}-${c}.midst.zip`;

module.exports = { MARK, FRAMES, B, CASES, zipName };
