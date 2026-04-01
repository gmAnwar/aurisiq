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
