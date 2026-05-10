/**
 * Hand-rolled fuzzy match for the cmd-K command palette.
 *
 * Algorithm: case-insensitive subsequence — every char of the query must
 * appear in the candidate in order. Matches return a score in [0, 100]
 * with a small bonus for runs of consecutive matches, so a tighter match
 * ranks above a sparse one even when the matched-char counts are equal.
 *
 * Why hand-rolled over fzy / fuse.js: the command registry is ~31 strings
 * and the only consumer is the palette. A 30-LOC scorer beats a 200-KB
 * dependency for this scale.
 */

export interface FuzzyMatchResult {
  /** The candidate string verbatim (caller-provided value). */
  value: string;
  /** Score in [0, 100]; higher = better. */
  score: number;
}

const CONSECUTIVE_BONUS = 5;
const MAX_BASE_SCORE = 100;

/**
 * Return all candidates ranked best-first. An empty/whitespace-only query
 * passes everything through with score 0 in the original input order
 * (lets the palette show "all verbs" before the user types).
 */
export function fuzzyMatch(query: string, candidates: ReadonlyArray<string>): FuzzyMatchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return candidates.map((value) => ({ value, score: 0 }));
  }
  const matches: FuzzyMatchResult[] = [];
  for (const value of candidates) {
    const score = scoreOne(q, value.toLowerCase());
    if (score > 0) matches.push({ value, score });
  }
  // Stable sort: identical scores keep input order so the registry's
  // alphabetical layout shows through when the query doesn't disambiguate.
  matches.sort((a, b) => b.score - a.score);
  return matches;
}

function scoreOne(query: string, candidate: string): number {
  let qi = 0;
  let matched = 0;
  let consecutive = 0;
  let bonus = 0;
  for (let ci = 0; ci < candidate.length && qi < query.length; ci += 1) {
    if (candidate[ci] === query[qi]) {
      matched += 1;
      qi += 1;
      consecutive += 1;
      if (consecutive > 1) bonus += CONSECUTIVE_BONUS;
    } else {
      consecutive = 0;
    }
  }
  if (qi < query.length) return 0; // not all query chars matched in order
  const base = (matched * MAX_BASE_SCORE) / candidate.length;
  return Math.min(MAX_BASE_SCORE + CONSECUTIVE_BONUS * query.length, base + bonus);
}
