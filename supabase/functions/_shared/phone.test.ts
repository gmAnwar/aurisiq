import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizePhone } from "./phone.ts";

Deno.test("10 digits → prepend 52", () => {
  assertEquals(normalizePhone("8712345678"), "528712345678");
});

Deno.test("12 digits starting with 52 → pass-through", () => {
  assertEquals(normalizePhone("528712345678"), "528712345678");
});

Deno.test("+52 with spaces → strips and normalizes", () => {
  assertEquals(normalizePhone("+52 871 234 5678"), "528712345678");
});

Deno.test("10 digits with dashes → strips and prepends 52", () => {
  assertEquals(normalizePhone("871-234-5678"), "528712345678");
});

Deno.test("parens + dashes + 52 prefix → normalizes", () => {
  assertEquals(normalizePhone("(52) 871 234-5678"), "528712345678");
});

Deno.test("13 digits starting with 521 → drops the legacy 1", () => {
  assertEquals(normalizePhone("5218712345678"), "528712345678");
});

Deno.test("11 digits → null (rechazado)", () => {
  assertEquals(normalizePhone("18712345678"), null);
});

Deno.test("13 digits not starting with 521 → null", () => {
  assertEquals(normalizePhone("5318712345678"), null);
});

Deno.test("too short → null", () => {
  assertEquals(normalizePhone("12345"), null);
});

Deno.test("empty string → null", () => {
  assertEquals(normalizePhone(""), null);
});

Deno.test("null → null", () => {
  assertEquals(normalizePhone(null), null);
});

Deno.test("undefined → null", () => {
  assertEquals(normalizePhone(undefined), null);
});
