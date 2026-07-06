import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { mkdtemp, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import libre from "libreoffice-convert";

export const runtime = "nodejs";
export const maxDuration = 120;

const execFileAsync = promisify(execFile);
const libreConvertAsync = promisify(libre.convert);

async function convertWithExcelCom(
  xlsxPath: string,
  pdfPath: string,
): Promise<void> {
  const xlsx = xlsxPath.replace(/'/g, "''");
  const pdf = pdfPath.replace(/'/g, "''");
  const script = `
$ErrorActionPreference = 'Stop'
$excel = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.DisplayAlerts = $false
  $excel.Visible = $false
  $wb = $excel.Workbooks.Open('${xlsx}')
  $wb.ExportAsFixedFormat(0, '${pdf}')
  $wb.Close($false)
} finally {
  if ($excel -ne $null) {
    $excel.Quit()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`;
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeout: 110_000, windowsHide: true },
  );
}

async function convertWithLibreOffice(xlsxBuf: Buffer): Promise<Buffer> {
  const pdfBuf = await libreConvertAsync(xlsxBuf, ".pdf", undefined);
  return Buffer.from(pdfBuf);
}

export async function POST(request: NextRequest) {
  let workDir: string | null = null;

  try {
    const xlsxBuf = Buffer.from(await request.arrayBuffer());
    if (xlsxBuf.length === 0) {
      return NextResponse.json({ error: "Archivo Excel vacío." }, { status: 400 });
    }

    workDir = await mkdtemp(join(tmpdir(), "aldepositos-xlsx-"));
    const id = randomUUID();
    const xlsxFile = join(workDir, `${id}.xlsx`);
    const pdfFile = join(workDir, `${id}.pdf`);

    await writeFile(xlsxFile, xlsxBuf);

    let pdfBuf: Buffer | null = null;
    let method = "";

    if (process.platform === "win32") {
      try {
        await convertWithExcelCom(xlsxFile, pdfFile);
        pdfBuf = await readFile(pdfFile);
        method = "excel";
      } catch (excelErr) {
        console.warn("[excel-to-pdf] Excel COM falló, probando LibreOffice:", excelErr);
      }
    }

    if (!pdfBuf) {
      try {
        pdfBuf = await convertWithLibreOffice(xlsxBuf);
        method = "libreoffice";
      } catch (libreErr) {
        console.error("[excel-to-pdf] LibreOffice falló:", libreErr);
        return NextResponse.json(
          {
            error:
              "No se pudo convertir el Excel a PDF. En Windows se requiere Microsoft Excel o LibreOffice instalado.",
          },
          { status: 503 },
        );
      }
    }

    return new NextResponse(new Uint8Array(pdfBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="reporte.pdf"',
        "X-Conversion-Method": method,
      },
    });
  } catch (e) {
    console.error("[excel-to-pdf]", e);
    return NextResponse.json(
      { error: "Error al convertir Excel a PDF." },
      { status: 500 },
    );
  } finally {
    if (workDir) {
      try {
        const { rm } = await import("fs/promises");
        await rm(workDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}
