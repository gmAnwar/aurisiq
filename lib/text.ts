/**
 * Strip JSON artifacts that Claude sometimes appends to text fields.
 * Handles: ```json { ... }```, trailing { "key": ... }, and inline json { ... }
 */
export function stripJson(t: string | null | undefined): string {
  if (!t) return "";
  let s = t;
  // Remove fenced code blocks (```...```)
  const tripleIdx = s.indexOf("\u0060\u0060\u0060");
  if (tripleIdx > 0) s = s.slice(0, tripleIdx);
  // Remove trailing JSON objects
  s = s.replace(/\n\s*\{\s*"[\s\S]*$/g, "");
  // Remove inline json patterns
  s = s.replace(/\s*json\s*\{[\s\S]*$/gi, "");
  // Remove leading markdown bold markers
  s = s.replace(/^\*+\s*/, "");
  return s.trim();
}

/**
 * Compute edit percentage between original and edited transcription.
 * Uses longest common subsequence at word level. Returns 0-100.
 */
export function computeEditPercentage(original: string, edited: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const wordsA = normalize(original).split(/\s+/).filter(Boolean);
  const wordsB = normalize(edited).split(/\s+/).filter(Boolean);
  if (wordsA.length === 0) return 0;
  if (wordsA.join(" ") === wordsB.join(" ")) return 0;

  // LCS length via Hunt-Szymanski for large inputs, simple DP for small
  const m = wordsA.length;
  const n = wordsB.length;

  // For transcriptions (200-2000 words), use space-optimized LCS
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (wordsA[i - 1] === wordsB[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  const lcsLen = prev[n];
  const changed = Math.max(m, n) - lcsLen;
  return Math.min(100, Math.round((changed / m) * 100));
}
