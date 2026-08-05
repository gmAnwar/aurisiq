// F42d: fixture VERBATIM del incidente 5-ago-2026 (analysis
// b52f7f7c-12c9-4ef8-a07f-54b58d038cfb, org immobili). Fuente:
// analysis_parser_debug.raw_output_capture id cb87e899-4821-41f9-a97d-caf0e7abc4b6
// — ventana de 8000 chars anclada en el último 'ESTADO', por eso arranca a media
// palabra y no incluye SCORE GENERAL. El modelo escapó los underscores como
// markdown (cerrado\_parcial, PROSPECTO\_NOMBRE:) — la causa raíz que F42d
// des-escapa. NO editar a mano: generado desde la DB (gen-fixture.cjs).
// Contiene datos reales del prospecto — repo privado, no extraer a logs/Slack.
export const INCIDENT_F42D_RAW = `scrituras ✓, propiedad habitada ✓, descripción física (2 recámaras, baño, cocina, sala, piso firme, sin acabados) ✓, servicios a nombre del propietario ✓, medidor de luz ✓, motivo de venta ✓. Lo que no se exploró: adeudos de servicios — preguntó si están a su nombre pero no si tiene adeudos pendientes (el propietario mencionó "problemillas con la luz" y esto no se siguió). NSS y NC no se solicitaron, lo cual es relevante aunque la propiedad esté libre, pues puede haber créditos secundarios. Tampoco se exploró si el predial está al corriente. El tema de la obra negra se manejó informativamente, pero no se calificó con claridad si la propiedad es captable en ese estado — se dejó abierto de forma ambigua.

**Expectativa y Precio (18/30):** Miguel preguntó directamente "¿tiene una cantidad en mente que usted diga yo quiero recibir esto?" — pregunta válida aunque directa. El propietario respondió que no sabe cuánto puede valer. Se dejó abierto a propuestas, lo cual es correcto. Sin embargo, Miguel no exploró expectativa de forma indirecta ("¿ha visto precios de casas similares en su zona?"), no mencionó comparables ni dio ningún rango referencial, ni exploró cuánto necesitaría recibir mínimo para comprar otra propiedad — dato clave dado el motivo de venta declarado. La gestión del tema de obra negra y su impacto en el precio no se abordó.

**Avance a Visita (8/15):** Se propuso visita y el propietario aceptó el sábado. Sin embargo, la llamada se cortó abruptamente antes de confirmar hora concreta — el propietario dijo "a qué hora le parece" y la transcripción termina sin respuesta ni confirmación. No hay fecha específica ni hora acordada formalmente, lo que deja el cierre incompleto.

**Lectura del Propietario (5/10):** Miguel identificó que el propietario tiene urgencia moderada por conflictos vecinales y deseo de cambiar de zona. Adaptó el tono de forma cordial. Sin embargo, no profundizó en la situación de los "problemillas con la luz" que el propietario mencionó — señal de posible adeudo que quedó sin explorar. Tampoco calibró el nivel de disposición real ante la condición de obra negra de la propiedad.

---

OBJECIONES DETECTADAS

**Objeción 1:**
Objeción: "Yo pensé que hacían todo ese rollo" (refiriéndose a que esperaba que la inmobiliaria se encargara de terminar la construcción)
Respuesta de la captadora: Explicó que sí pueden rehabilitar propiedades vandalizadas o en mal estado, pero luego matizó que sí hay que invertir.
Evaluación: No funcionó del todo — generó confusión. Primero dijo que sí pueden rehabilitar, luego retrocedió diciendo "como si hay que invertir, la verdad", lo que dejó al prospecto sin claridad sobre si la inmobiliaria absorbe ese costo o no.
Respuesta recomendada: "Don Epifanio, nosotros podemos hacer una visita para valuar exactamente qué inversión requiere la propiedad y qué opciones hay: si se vende al contado en su estado actual, o si hay un esquema donde se invierte para maximizar el precio. Mis compañeros van a ser muy específicos sobre eso cuando la visiten — ¿le parece?"

**Objeción 2:**
Objeción: (Implícita) El propietario mencionó "unos problemillas con la luz" sin que se le preguntara directamente — señal de posible adeudo o servicio irregular.
Respuesta de la captadora: No se siguió. Miguel continuó sin preguntar qué tipo de problema es.
Evaluación: No funcionó — se omitió completamente.
Respuesta recomendada: "Oiga, don Epifanio, me comentó que tiene un problemilla con la luz — ¿es tema de adeudo o es algo del servicio como que está provisional? Eso nos ayuda a orientarlo mejor en la visita."

---

SIGUIENTE PASO CON ESTE PROSPECTO

Estado del prospecto: pendiente
Razonamiento: El propietario mostró disposición real para vender y aceptó recibir visita el sábado, pero la llamada se cortó sin confirmar hora exacta. El cierre quedó incompleto y hay detalles críticos sin resolver (condición de la propiedad, adeudo de luz).
Acción concreta: Contactar a Epifanio por WhatsApp en las próximas 2 horas para confirmar hora del sábado y resolver la duda sobre los "problemillas con la luz" antes de la visita.
Mensaje sugerido:
"Buenas tardes, don Epifanio, le escribe Miguel de El Móvil Internacional. Quedamos en la visita del sábado — ¿le viene bien a las 10 o a las 12? Así le confirmo a mis compañeros. 🙌"

---

ESTADO DEL LEAD

Calidad del prospecto: descalificado
Razonamiento de calidad: La propiedad está en obra negra — sin acabados, sin cableado eléctrico formal, sin piso terminado, sin enyesado. La inmobiliaria declaró que trabaja mayormente con créditos Infonavit y que este tipo de propiedad no es elegible en ese estado. Aunque se mencionó la posibilidad de venta al contado o rehabilitación, no se calificó concretamente si existe un comprador potencial ni si la inversión requerida es viable para la inmobiliaria.

Resultado de esta conversación: cerrado\\_parcial
Razonamiento de resultado: El propietario aceptó recibir visita y eligió el sábado, pero no se confirmó hora — el cierre quedó a medias por el corte abrupto de la llamada. Hay interés real pero sin agenda formal cerrada.

---

PATRÓN DE ERROR PRINCIPAL

La captadora no siguió la señal más importante de la llamada: el propietario mencionó "problemillas con la luz" y esto nunca se exploró. En una propiedad con cableado provisional y sin acabados, ese dato puede ser un adeudo con CFE o una toma irregular — ambos escenarios con impacto directo en la captación. Además, el manejo del tema de obra negra quedó ambiguo: se dijo que "sí pueden rehabilitar" y luego "como si hay que invertir", sin dejar claro al prospecto qué implicaciones tiene para la venta. Esa ambigüedad puede generar expectativas incorrectas antes de la visita.

---

MOMENTO CRÍTICO

Cuando el propietario mencionó "unos problemillas con la luz", Miguel no preguntó nada al respecto y continuó con otro tema. Ese fue el momento decisivo de la llamada porque en una propiedad con instalación eléctrica provisional y sin acabados, un adeudo o irregularidad con CFE puede ser una causa de descalificación o una variable que afecta directamente el esquema de venta. Al no explorar ese punto, la visita del sábado puede llegar sin información crítica que los captadores necesitarán para hacer una evaluación seria.

---

PROSPECTO\\_NOMBRE: Epifanio Moreno
PROSPECTO\\_ZONA: Colonia Ampliación 5 de Mayo, Timoteo Encerrado 455 Oriente
TIPO\\_PROPIEDAD: Casa
MOTIVO\\_VENTA: Conflictos con vecinos, desea cambiar de zona y adquirir otra propiedad
PROSPECTO\\_TELEFONO: No detectado

CHECKLIST: [{"field":"Nombre completo","state":"asked_no_answer"},{"field":"Dirección de la propiedad","state":"covered"},{"field":"Libre de gravamen","state":"covered"},{"field":"Pagos puntuales","state":"not_covered"},{"field":"Adeudos en tiempo consecutivo","state":"not_covered"},{"field":"Crédito individual o conyugal","state":"not_covered"},{"field":"NSS","state":"not_covered"},{"field":"NC","state":"not_covered"},{"field":"Estado civil","state":"covered"},{"field":"Papelería/escrituras","state":"covered"},{"field":"Dirección INE","state":"covered"},{"field":"Descripción del domicilio","state":"covered"},{"field":"Casa habitada o desocupada","state":"covered"},{"field":"Motivo de venta","state":"covered"},{"field":"Servicios a nombre de quién","state":"covered"},{"field":"Adeudos de servicios","state":"not_covered"},{"field":"Financiamiento de adeudos","state":"not_covered"},{"field":"Expectativa del cliente","state":"covered"},{"field":"Disponibilidad para visita","state":"covered"},{"field":"Precio estimado de venta","state":"not_covered"},{"field":"Precio estimado de captación","state":"not_covered"},{"field":"Fecha y hora propuesta","state":"asked_no_answer"},{"field":"Lectura de disposición","state":"covered"},{"field":"Lectura de resistencia","state":"covered"},{"field":"Lectura de urgencia","state":"covered"},{"field":"Promesa de venta","state":"asked_no_answer"}]

ETAPA\\_DETECTADA: Llamada 1 de Captacion

DESCALIFICACION: ["obra_negra"]`;
