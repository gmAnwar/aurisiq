import { test } from "node:test";
import { strictEqual } from "node:assert";
import { normalizePhone } from "./phone.js";

test("10 digits → prepend 52", () => {
  strictEqual(normalizePhone("8712345678"), "528712345678");
});

test("12 digits starting with 52 → pass-through", () => {
  strictEqual(normalizePhone("528712345678"), "528712345678");
});

test("+52 with spaces → strips and normalizes", () => {
  strictEqual(normalizePhone("+52 871 234 5678"), "528712345678");
});

test("10 digits with dashes → strips and prepends 52", () => {
  strictEqual(normalizePhone("871-234-5678"), "528712345678");
});

test("parens + dashes + 52 prefix → normalizes", () => {
  strictEqual(normalizePhone("(52) 871 234-5678"), "528712345678");
});

test("13 digits starting with 521 → drops the legacy 1", () => {
  strictEqual(normalizePhone("5218712345678"), "528712345678");
});

test("11 digits → null (rechazado)", () => {
  strictEqual(normalizePhone("18712345678"), null);
});

test("13 digits not starting with 521 → null", () => {
  strictEqual(normalizePhone("5318712345678"), null);
});

test("too short → null", () => {
  strictEqual(normalizePhone("12345"), null);
});

test("empty string → null", () => {
  strictEqual(normalizePhone(""), null);
});

test("null → null", () => {
  strictEqual(normalizePhone(null), null);
});

test("undefined → null", () => {
  strictEqual(normalizePhone(undefined), null);
});
