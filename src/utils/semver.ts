/**
 * Just enough semver for plugin versions: `1.2.3`, `v1.2.3`, and a
 * prerelease suffix. Anything else is not a version and compares as unknown.
 */

const SEMVER_PATTERN = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/;

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

export function parseSemver(value: string | null | undefined): ParsedSemver | null {
  if (!value) return null;
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] ? Number(match[3]) : 0,
    prerelease: match[4] ?? null,
  };
}

/** Negative when `a` is older than `b`, positive when newer, `null` when either is not a version. */
export function compareSemver(a: string | null | undefined, b: string | null | undefined): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  // A release outranks its own prerelease; two prereleases compare as strings.
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === null) return 1;
  if (right.prerelease === null) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/** `v1.2.3` and `1.2.3` are the same version; keep one spelling for display. */
export function formatVersion(value: string | null | undefined): string | null {
  const parsed = parseSemver(value);
  if (!parsed) return value?.trim() || null;
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease ? `${base}-${parsed.prerelease}` : base;
}
