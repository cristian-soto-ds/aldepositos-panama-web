import ExcelJS from "exceljs";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object" && "text" in v && typeof v.text === "string") {
    return v.text.trim();
  }
  if (typeof v === "object" && "result" in v) {
    return String(v.result ?? "").trim();
  }
  return String(v).trim();
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

const HEADER_MAP: Record<string, keyof ReceptionTruck | "bultos"> = {
  placa: "plate",
  plate: "plate",
  vehiculo: "plate",
  proveedor: "provider",
  provider: "provider",
  cliente: "client",
  client: "client",
  mainclient: "client",
  ra: "ra",
  orden: "ra",
  bultos: "bultos",
  expectedbultos: "bultos",
  conductor: "driverName",
  driver: "driverName",
  notas: "notes",
  notes: "notes",
};

function generateId() {
  return `trk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function rowToTruck(
  row: Record<string, string>,
  sortOrder: number,
): ReceptionTruck | null {
  const plate = (row.plate ?? "").trim();
  const ra = (row.ra ?? "").trim();
  if (!plate && !ra) return null;

  const now = new Date().toISOString();
  return {
    id: generateId(),
    plate: plate || "SIN-PLACA",
    provider: (row.provider ?? "—").trim() || "—",
    client: (row.client ?? "—").trim() || "—",
    ra: ra || "—",
    expectedBultos: Math.max(0, parseInt(row.bultos ?? "0", 10) || 0),
    driverName: row.driverName?.trim() || undefined,
    notes: row.notes?.trim() || undefined,
    status: RECEPTION_STATUS.EN_FILA,
    sortOrder,
    source: "import",
    createdAt: now,
    updatedAt: now,
  };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export async function parseReceptionOrdersFile(file: File): Promise<{
  trucks: ReceptionTruck[];
  error?: string;
}> {
  const name = file.name.toLowerCase();

  try {
    if (name.endsWith(".csv")) {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        return { trucks: [], error: "El CSV está vacío o no tiene filas de datos." };
      }
      const headers = parseCsvLine(lines[0]!).map(normalizeHeader);
      const trucks: ReceptionTruck[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]!);
        const mapped: Record<string, string> = {};
        headers.forEach((h, idx) => {
          const field = HEADER_MAP[h];
          if (field && field !== "bultos") mapped[field] = cols[idx] ?? "";
          if (field === "bultos") mapped.bultos = cols[idx] ?? "0";
        });
        const truck = rowToTruck(mapped, i);
        if (truck) trucks.push(truck);
      }
      return { trucks };
    }

    const wb = new ExcelJS.Workbook();
    const buf = await file.arrayBuffer();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) return { trucks: [], error: "El Excel no tiene hojas." };

    const headerRow = ws.getRow(1);
    const colMap: Record<number, string> = {};
    headerRow.eachCell((cell, col) => {
      const key = normalizeHeader(cellText(cell));
      const field = HEADER_MAP[key];
      if (field) colMap[col] = field;
    });

    const trucks: ReceptionTruck[] = [];
    let sort = 1;
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const mapped: Record<string, string> = {};
      row.eachCell((cell, col) => {
        const field = colMap[col];
        if (!field) return;
        mapped[field] = cellText(cell);
      });
      const truck = rowToTruck(mapped, sort++);
      if (truck) trucks.push(truck);
    });

    return { trucks };
  } catch (e) {
    console.error(e);
    return {
      trucks: [],
      error: "No se pudo leer el archivo. Usa Excel (.xlsx) o CSV.",
    };
  }
}
