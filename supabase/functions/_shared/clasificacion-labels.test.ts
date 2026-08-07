// Guard del rename de etiquetas (lib/clasificacion-labels.ts). El helper vive
// en lib/ para que Next lo compile; el test corre en la suite Deno (el
// tsconfig de la app no incluye supabase/functions — mismo patrón que
// descal-metrics.test.ts). Verifica contra deriveClasificacion REAL, sin
// listas espejo tautológicas: un valor nuevo en el CHECK/derive sin etiqueta
// rompe la suite antes de salir sin nombre a la UI, y los rangos de la tabla
// de la UI no pueden volver a divergir de los umbrales canónicos.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CLASIFICACION_LABELS,
  CLASIFICACION_RANGES,
  CLASIFICACION_VALUES,
  clasificacionLabel,
} from "../../../lib/clasificacion-labels.ts";
import { deriveClasificacion } from "../analyze/parser.ts";

Deno.test("guard: todo valor del CHECK tiene etiqueta no vacía y el mapa no tiene claves extra", () => {
  for (const v of CLASIFICACION_VALUES) {
    assert(CLASIFICACION_LABELS[v] && CLASIFICACION_LABELS[v].trim().length > 0, `valor '${v}' sin etiqueta`);
  }
  assertEquals(Object.keys(CLASIFICACION_LABELS).sort(), [...CLASIFICACION_VALUES].sort());
});

Deno.test("guard: todo output posible de deriveClasificacion (0-100) tiene etiqueta", () => {
  for (let s = 0; s <= 100; s++) {
    const v = deriveClasificacion(s);
    assert((CLASIFICACION_LABELS as Record<string, string>)[v], `score ${s} → '${v}' sin etiqueta`);
  }
});

Deno.test("guard: CLASIFICACION_RANGES coincide EXACTO con deriveClasificacion (85/65/45), sin huecos ni traslapes", () => {
  for (const r of CLASIFICACION_RANGES) {
    assertEquals(deriveClasificacion(r.min), r.value, `min ${r.min} debe ser ${r.value}`);
    assertEquals(deriveClasificacion(r.max), r.value, `max ${r.max} debe ser ${r.value}`);
    if (r.min > 0) {
      assert(deriveClasificacion(r.min - 1) !== r.value, `frontera inferior de ${r.value} en ${r.min}`);
    }
  }
  for (let s = 0; s <= 100; s++) {
    const bandas = CLASIFICACION_RANGES.filter((r) => s >= r.min && s <= r.max).length;
    assertEquals(bandas, 1, `score ${s} cae en ${bandas} bandas`);
  }
});

Deno.test("clasificacionLabel: mapa nuevo, null seguro, valor desconocido pasa crudo", () => {
  assertEquals(clasificacionLabel("excelente"), "Excelente");
  assertEquals(clasificacionLabel("buena"), "Buena");
  assertEquals(clasificacionLabel("regular"), "En camino");
  assertEquals(clasificacionLabel("deficiente"), "A reforzar");
  assertEquals(clasificacionLabel(null), null);
  assertEquals(clasificacionLabel(undefined), null);
  assertEquals(clasificacionLabel("valor_nuevo"), "valor_nuevo");
});
