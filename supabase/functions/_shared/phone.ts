/**
 * Normaliza un teléfono mexicano a formato E.164 sin '+': "52XXXXXXXXXX" (12 dígitos).
 * Devuelve null si el input no es normalizable.
 *
 * Algoritmo:
 *  1. Strip todos los caracteres no numéricos (espacios, +, -, (, ), puntos, etc.).
 *  2. Por longitud del resultado:
 *     - 10 dígitos → prepend "52" → "52XXXXXXXXXX".
 *     - 12 dígitos empezando con "52" → return as-is.
 *     - 13 dígitos empezando con "521" → drop el '1' en posición 3 (index 2)
 *       → "52" + los 10 dígitos restantes.
 *     - Cualquier otra longitud → null.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return "52" + digits;
  if (digits.length === 12 && digits.startsWith("52")) return digits;
  if (digits.length === 13 && digits.startsWith("521")) return digits.slice(0, 2) + digits.slice(3);
  return null;
}
