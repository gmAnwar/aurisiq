// F47: helper de métricas qualified (lib/descal-metrics.ts). El helper vive en
// lib/ para que Next lo compile; el test corre en la suite Deno (el tsconfig
// de la app no incluye supabase/functions, así que Deno.test no lo rompe).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { descalState, qualifiedStats } from "../../../lib/descal-metrics.ts";

Deno.test("F47 descalState: [] = qualified, códigos = disqualified, null/undefined = unknown", () => {
  assertEquals(descalState([]), "qualified");
  assertEquals(descalState(["obra_negra"]), "disqualified");
  assertEquals(descalState(null), "unknown");
  assertEquals(descalState(undefined), "unknown");
});

Deno.test("F47 qualifiedStats: NULL fuera del denominador, sin inventar dato en ninguna dirección", () => {
  const rows = [
    { categoria_descalificacion: [] },
    { categoria_descalificacion: ["sin_escrituras"] },
    { categoria_descalificacion: null },
    { categoria_descalificacion: [] },
  ];
  const s = qualifiedStats(rows);
  assertEquals(s.qualified, 2);
  assertEquals(s.disqualified, 1);
  assertEquals(s.unknown, 1);
  assertEquals(s.denominator, 3);
});

Deno.test("F47 qualifiedStats: lista vacía → todo en cero", () => {
  assertEquals(qualifiedStats([]), { qualified: 0, disqualified: 0, unknown: 0, denominator: 0 });
});
