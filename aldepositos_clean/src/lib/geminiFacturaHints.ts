/** Hints compartidos para facturas JEANCENTER y tablas con columna Codigo (Zona Libre). */

export const JEANCENTER_CODIGO_HINT = `Facturas JEANCENTER y tablas con columna «Codigo» (Zona Libre, ej. JEANCENTER CORP.):
- Columna «Codigo» → referencia (formato #####-##### con sufijos opcionales: -BLK, -D-BLK, etc.).
- Columna «Bultos» → bultos (cantidad de bultos físicos de esa fila).
- Cada producto es un bloque multilínea: la fila principal tiene Codigo + Descripción + Bultos; debajo van Comp., Peso B., Escala, C.Barras, etc. Esas líneas NO son productos nuevos.
- UNA fila JSON por cada Codigo distinto visible en el fragmento/página.
- No cortes al final de la tabla: incluye los últimos Codigo antes de SUBTOTAL, TOTAL o pie de página.
- «Cantidad» en PZA/piezas → unidadesTotales; convierte docenas si aplica.`;

export const FACTURA_TABULAR_CHUNK_HINT = `Formato FACTURA / packing (puntomoda, JEANCENTER y similares, Zona Libre):
- UNA fila JSON por cada línea de producto con Referencia/SKU/Codigo (ej. B-21496XM, JN-7117M, 10133-67606, 10901-67035).
- Columna «No. Bulto» o «Bultos» → campo bultos (número de bulto físico de esa fila). Si no aparece, usa «1».
- Columna «Peso» o «Peso B.» → pesoPorBulto (kg por bulto).
- «Cantidad» en DOZ/docenas (ej. 4.0000 DOZ) → 48 piezas (×12). EMP en descripción suele ser docenas por empaque.
- descripcion: tipo de prenda sin medidas ni género (ej. SUETER, JEANS CORTO, BLUSA). género en campo genero si dice DAMA/MAMA/etc.
- modelo: MISS CALIFORNIA, marca del bloque o columna Marca. paisOrigen: CHINA si dice ORIGEN: CHINA o Comp.
- NO omitas filas por brevedad. Incluye TODAS las referencias/Codigo visibles en este fragmento/página, incluidas las últimas de la tabla.
- Ignora filas de totales (SUBTOTAL, TOTAL, GASTOS) y filas sin referencia que solo tengan cubicaje/peso resumen.
${JEANCENTER_CODIGO_HINT}`;

export const CHUNK_INCOMPLETE_RETRY_PROMPT =
  "Faltan filas al final de este fragmento. Revisa de nuevo el texto y devuelve TODOS los Codigo/referencias visibles en este fragmento, sin omitir las últimas filas de la tabla antes de SUBTOTAL/TOTAL/pie de página. Prioriza completar \"lines\"; \"reply\" máximo 1 frase.";

export const CHUNK_FIELD_INCOMPLETE_RETRY_PROMPT =
  "Las filas devueltas están incompletas. Para CADA referencia/Codigo visible en este fragmento completá también: bultos, descripcion, unidadesTotales (o unidadesPorBulto), pesoPorBulto y genero/modelo si aparecen. No devuelvas filas con solo referencia vacía en los demás campos cuando el documento los muestra. Prioriza completar \"lines\"; \"reply\" máximo 1 frase.";
