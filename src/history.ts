export interface ChangeObj {
  front: number;
  inserted: string;
  end: number;
  t: Date;
  pos?: number;
}

export const step = (initial: string, change: ChangeObj) => {
  const endingIndex = initial.length - change.end;
  return (
    initial.slice(0, change.front) +
    change.inserted +
    initial.slice(endingIndex)
  );
};

// The change that turns `str` into `next`. `t` is when it happened: now, for an edit as it is made;
// the frame's own time when an old file's frames are converted into a history (main/util.ts).
export const compareStrings = (
  str: string,
  next: string,
  pos: number,
  t: Date = new Date()
): ChangeObj => {
  let inserted = '';
  let front = 0;
  let end = 0;
  // Nothing changed: a change that keeps the whole text. `front` must be the full length, because
  // step() keeps what lies before `front` and after `end`; front 0 with end 0 would erase the text.
  if (str === next) return { inserted, front: str.length, end, t, pos };
  while (str[front] === next[front] && front < str.length) {
    front += 1;
  }

  // you could definitely do this just by shortening the while loop but okay
  const choppedStr = str.slice(front);
  const choppedNext = next.slice(front);
  while (
    choppedStr[choppedStr.length - end - 1] ===
      choppedNext[choppedNext.length - end - 1] &&
    end < choppedStr.length
  ) {
    end += 1;
  }

  inserted = next.slice(front, next.length - end);
  return { inserted, front, end, t, pos };
};

export const reconstruct = (
  initial: string,
  changes: ChangeObj[],
  index: number
) => {
  if (changes) {
    return changes
      .slice(0, index + 1)
      .reduce((acc, val) => step(acc, val), initial);
  }
  return '';
};

export const reconstructArray = (
  initial: string,
  changes: ChangeObj[],
  index: number
) => {
  if (!changes.length) return [];
  const reconstructed = reconstruct(initial, changes, index);
  const insertPosition = changes[index].front + changes[index].inserted.length;
  const insertRowNum =
    reconstructed.slice(0, insertPosition).split('\n').length - 1;

  return reconstructed.split('\n').map((row, j) => ({
    text: row,
    isInsertRow: j === insertRowNum,
    key: j,
  }));
};

export const reconstructHTML = (
  initial: string,
  changes: ChangeObj[],
  index: number
) => {
  if (!changes.length) return '';
  const reconstructed = reconstruct(initial, changes, index);

  return reconstructed;
};
