/** @jest-environment node */
import { convertMidstFile } from '../convert';

// Synthetic documents only: invented words, never a poem.

const oldFile = (meta: Record<string, unknown>) =>
  JSON.stringify({
    editorTimelineFrames: [
      { content: '<p>a</p>', lineNumber: '0', timestamp: 1605903809127 },
      { content: '<p>ab</p>', lineNumber: '0', timestamp: 1605903809227 },
      { content: '<p>abc</p>', lineNumber: '0', timestamp: 1605903809327 },
    ],
    meta,
  });

const B_META = {
  editorFontFamily: 'Garamond',
  editorFontSize: 24,
  editorDraftMarkers: [
    { timelineIndex: 1, name: 'zq first', defaultName: 'Draft 1' },
  ],
  editorHighestEverDraftNumber: 1,
  editorTitle: 'zq title',
  editorAuthor: 'zq author',
};

describe('format C meta (midst-format docs/META.md)', () => {
  it('the converter copies every B presentation field, and never the author (#181)', () => {
    const c = JSON.parse(convertMidstFile(oldFile(B_META)));
    expect(c.meta).toEqual({
      fontFamily: 'Garamond',
      fontSize: 24,
      draftMarkers: [{ index: 1, name: 'zq first', defaultName: 'Draft 1' }],
      highestDraftNumber: 1,
      title: 'zq title',
    });
    expect(JSON.stringify(c)).not.toContain('zq author');
    // A marker index is a history index, so there must be one change per B frame.
    expect(c.history).toHaveLength(3);
  });

  it('leaves out a field B does not have', () => {
    const { editorAuthor, ...noAuthor } = B_META;
    const c = JSON.parse(convertMidstFile(oldFile(noAuthor)));
    expect(c.meta).not.toHaveProperty('author');
  });
});
