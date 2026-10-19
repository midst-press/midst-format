// One line that says which build is running, for the About of the editor and of the website.
// The website holds a byte-identical copy of this file, so it must stay free of imports.
//
//     Version v0.3.0-beta.1, commit a1b2c3d, committed 2026-10-13 20:30 UTC
//     Untagged build, commit a1b2c3d, committed 2026-10-13 20:30 UTC
//     Development build

export interface BuildIdentity {
  // The release tag exactly as written, with its leading v and any pre-release part.
  tag?: string;
  // The short commit id, ending in "-dirty" if the tree had uncommitted changes.
  commit?: string;
  // When that commit was made, as an ISO 8601 string in any time zone.
  committedAt?: string;
}

const TAG = /^v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;

// A tag is a pre-release if its major version is 0 or it has a suffix (-dev.1, -beta.2, -rc.1).
// Anything that is not vMAJOR.MINOR.PATCH with an optional suffix also counts as one, so that an
// unrecognised tag is never taken for a full release.
export const isPreRelease = (tag: string): boolean => {
  const parts = TAG.exec(tag);
  return !parts || parts[1] === '0' || parts[4] !== undefined;
};

const two = (n: number) => String(n).padStart(2, '0');

// "2026-10-13 20:30 UTC", or undefined when the string is not a date.
export const utcMinute = (iso: string): string | undefined => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  const day = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(
    at.getUTCDate()
  )}`;
  return `${day} ${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC`;
};

// A part that is missing, empty or only spaces is left out, never guessed. A date that cannot be
// read is shown as it was given, so a wrong input is seen. With no part at all it is a
// development build.
export const buildLabel = (identity: BuildIdentity): string => {
  const tag = (identity.tag ?? '').trim();
  const commit = (identity.commit ?? '').trim();
  const committedAt = (identity.committedAt ?? '').trim();
  if (!tag && !commit && !committedAt) return 'Development build';
  const parts = [tag ? `Version ${tag}` : 'Untagged build'];
  if (commit) parts.push(`commit ${commit}`);
  if (committedAt)
    parts.push(`committed ${utcMinute(committedAt) ?? committedAt}`);
  return parts.join(', ');
};
