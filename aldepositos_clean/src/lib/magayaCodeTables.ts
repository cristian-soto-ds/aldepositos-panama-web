/**
 * Tablas de referencia para Alde.IA → CSV Magaya.
 * Amplía este archivo cuando confirmen códigos nuevos en facturas/packing lists;
 * el modelo las usa como conocimiento estable (no sustituye leer el documento).
 */
export const MAGAYA_KNOWN_CODE_TABLES = `
### Tablas de códigos (aplica cuando el documento coincida)

**País de origen (columna H «Pais de Org.»)** — nombre completo en español, mayúsculas razonables:
- CH, CN, CHN → CHINA
- US, USA → ESTADOS UNIDOS
- PA → PANAMÁ
- MX → MÉXICO
- CO → COLOMBIA
- ES → ESPAÑA
- IN, IND → INDIA
- BD → BANGLADESH
- VN → VIETNAM

**MARCAS / modelo (columna C «MODELO»)** — si el documento dice «MARCAS= 23» o equivalente y la tabla indica 23 → el valor a poner en MODELO es CONCEPTS (no el número crudo).
- 23 → CONCEPTS
(Añade más filas aquí cuando el almacén confirme: «MARCAS= X → TEXTO».)

**Materiales / composición (columna R)** — si el documento dice MATERIALES=, COMPOSICIÓN= o códigos similares:
- 015VI → 100% VIDRIO
- 100% ALGODÓN, 100% POLIÉSTER, etc. si vienen explícitos en texto
(Añade códigos de proveedor → texto legible cuando los validen.)

**Género (columna M)** — una de: dama, caballero, niño, niña, bebe; vacío si no aplica. Nunca repitas esto en descripcion.

**Forro (columna L)** — salvo indicación explícita distinta en el documento, siempre «N/A».

**Talla (columna K)** — si hay lista 12, 13, 14, …, 18 → «12-18» (mínima-máxima). Una sola talla → solo ese número.
`.trim();
