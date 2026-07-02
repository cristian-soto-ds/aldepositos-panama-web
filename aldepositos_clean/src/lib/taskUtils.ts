/**
 * Adapta measureData al cambiar un RA de un módulo a otro.
 * Quick/airway: { referencia, bultos } (+ campos vacíos de captura en almacén)
 * Detailed: { referencia, descripcion, bultos, unidadesPorBulto, pesoPorBulto, l, w, h, ... }
 */

type AnyMeasureRow = Record<string, unknown>;

export function adaptMeasureDataForModule(
  measureData: AnyMeasureRow[],
  fromType: string,
  toType: string
): AnyMeasureRow[] {
  if (!measureData || measureData.length === 0) return measureData;
  if (fromType === toType) return measureData;

  const generateId = () => Math.random().toString(36).slice(2, 11);

  if (toType === "detailed") {
    // quick/airway → detailed: añadir descripcion, unidadesPorBulto, pesoPorBulto
    return measureData.map((row) => ({
      id: row.id ?? generateId(),
      referencia: row.referencia ?? "",
      descripcion: row.descripcion ?? "",
      bultos: row.bultos ?? 0,
      unidadesPorBulto: row.unidadesPorBulto ?? "",
      pesoPorBulto: row.pesoPorBulto ?? row.weight ?? "",
      l: row.l ?? "",
      w: row.w ?? "",
      h: row.h ?? "",
      volumenM3: row.volumenM3 ?? "",
      unidad: row.unidad ?? "",
    }));
  }

  if (toType === "quick" || toType === "airway") {
    return measureData.map((row) => {
      const out: AnyMeasureRow = {
        id: row.id ?? generateId(),
        referencia: row.referencia ?? "",
        bultos: row.bultos ?? 0,
      };
      for (const key of [
        "l",
        "w",
        "h",
        "weight",
        "volumenM3",
        "unidad",
        "reempaque",
        "bultoContenedor",
        "referenciasContenedor",
        "referenciaContenedora",
        "reempaqueRefs",
      ] as const) {
        const v = row[key];
        if (v === undefined || v === "" || v === false) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        out[key] = v;
      }
      return out;
    });
  }

  return measureData;
}
