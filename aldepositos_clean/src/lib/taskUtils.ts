/**
 * Adapta measureData al cambiar un RA de un módulo a otro.
 * Quick: { id, referencia, bultos, l, w, h, weight? }
 * Detailed: { id, referencia, descripcion, bultos, unidadesPorBulto, pesoPorBulto, l, w, h }
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
    }));
  }

  if (toType === "quick" || toType === "airway") {
    // detailed → quick/airway: mapear pesoPorBulto a weight
    return measureData.map((row) => ({
      id: row.id ?? generateId(),
      referencia: row.referencia ?? "",
      bultos: row.bultos ?? 0,
      l: row.l ?? "",
      w: row.w ?? "",
      h: row.h ?? "",
      weight: row.pesoPorBulto ?? row.weight ?? "",
    }));
  }

  return measureData;
}
