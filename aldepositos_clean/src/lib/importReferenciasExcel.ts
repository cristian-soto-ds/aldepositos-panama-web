import ExcelJS from "exceljs";

export type ReferenciaImportRow = {
  referencia: string;
  /** Si el Excel trae columna de cantidad reconocida */
  bultos?: number;
};

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null && "text" in v) {
    return String((v as { text: string }).text ?? "").trim();
  }
  if (typeof v === "object" && v !== null && "result" in v) {
    return String((v as { result: unknown }).result ?? "").trim();
  }
  return String(v).trim();
}

/** Encabezados típicos de la columna de código / referencia */
function isReferenceHeader(header: string): boolean {
  const h = norm(header);
  if (!h || h === "#") return false;
  if (h.includes("referencia")) return true;
  if (h.includes("codigo")) return true;
  if (h === "código" || h.includes("código")) return true;
  if (h === "ref" || h.startsWith("ref.") || h.includes(" ref")) return true;
  if (h.includes("sku") || h.includes("style")) return true;
  if (h.includes("estilo")) return true;
  if (h.includes("articulo") || h.includes("artículo")) return true;
  if (h.includes("item") && !h.includes("items tot")) return true;
  if (h.includes("producto") && !h.includes("proveedor")) return true;
  if (h.includes("modelo")) return true;
  if (h.includes("clave") && !h.includes("clave sat")) return true;
  return false;
}

function isBultosHeader(header: string): boolean {
  const h = norm(header);
  if (!h) return false;
  if (h.includes("bulto")) return true;
  if (h.includes("cantidad")) return true;
  if (h.includes("cajas") || h.includes("und") || h === "qty")
    return true;
  if (h.includes("piezas") && !h.includes("por")) return true;
  return false;
}

function scoreDataRowAsHeader(values: string[]): number {
  return values.reduce((acc, raw) => {
    const t = norm(raw);
    if (!t) return acc;
    if (isReferenceHeader(t) || isBultosHeader(t)) return acc + 2;
    if (t.length > 2 && /^[a-záéíóúñ\s]+$/i.test(t)) return acc + 1;
    return acc;
  }, 0);
}

/**
 * Lee la primera hoja: localiza columna REFERENCIA / CÓDIGO / etc. por encabezado
 * o usa columna A. Opcionalmente lee bultos si hay otra columna reconocida.
 */
export async function parseReferenciasFromExcel(
  file: File,
): Promise<{
  rows: ReferenciaImportRow[];
  sourceColumnLabel: string;
  error?: string;
}> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) {
    return { rows: [], sourceColumnLabel: "", error: "El archivo no tiene hojas." };
  }

  const readRowVals = (rowNum: number, maxCol: number): string[] => {
    const row = ws.getRow(rowNum);
    const out: string[] = [];
    for (let c = 1; c <= maxCol; c++) {
      out.push(cellText(row.getCell(c)));
    }
    return out;
  };

  const maxScanCol = Math.min(40, ws.columnCount || 40);
  const maxRow = Math.min(ws.rowCount || 0, 5000);
  if (maxRow < 1) {
    return { rows: [], sourceColumnLabel: "", error: "La hoja está vacía." };
  }

  let headerRowIndex = 1;
  let colRef = -1;
  let colBultos = -1;
  let headerLabel = "columna A";

  // Probar filas 1–5 como posible encabezado
  for (let r = 1; r <= Math.min(5, maxRow); r++) {
    const vals = readRowVals(r, maxScanCol);
    let refIdx = -1;
    let bulIdx = -1;
    vals.forEach((cell, i) => {
      if (refIdx < 0 && isReferenceHeader(cell)) refIdx = i;
      if (bulIdx < 0 && isBultosHeader(cell)) bulIdx = i;
    });
    const looksHeader = scoreDataRowAsHeader(vals) >= 2 || refIdx >= 0;
    if (looksHeader && refIdx >= 0) {
      headerRowIndex = r;
      colRef = refIdx;
      colBultos = bulIdx;
      headerLabel = vals[colRef] ? String(vals[colRef]).trim() : "Referencia";
      break;
    }
  }

  if (colRef < 0) {
    // Sin encabezado reconocido: solo columna A = referencia (evita confundir B con bultos)
    headerRowIndex = 0;
    colRef = 0;
    colBultos = -1;
    headerLabel = "columna A";
  }

  const dataStart = headerRowIndex > 0 ? headerRowIndex + 1 : 1;
  const rows: ReferenciaImportRow[] = [];
  const seen = new Set<string>();

  for (let r = dataStart; r <= maxRow; r++) {
    const vals = readRowVals(r, maxScanCol);
    const refRaw = (vals[colRef] ?? "").trim();
    if (!refRaw) continue;

    const key = refRaw.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let bultos: number | undefined;
    if (colBultos >= 0 && colBultos !== colRef) {
      const rawB = vals[colBultos] ?? "";
      const n = parseFloat(String(rawB).replace(",", "."));
      if (!Number.isNaN(n) && n > 0) bultos = n;
    }

    const entry: ReferenciaImportRow = { referencia: refRaw };
    if (bultos !== undefined) entry.bultos = bultos;
    rows.push(entry);
  }

  if (rows.length === 0) {
    return {
      rows: [],
      sourceColumnLabel: headerLabel,
      error:
        "No se encontraron referencias. Use una columna titulada Código, Referencia, SKU, etc., o deje los códigos en la columna A.",
    };
  }

  return { rows, sourceColumnLabel: headerLabel };
}
