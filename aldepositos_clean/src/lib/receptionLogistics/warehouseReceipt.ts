import type { ReceptionTruck } from "@/lib/receptionLogistics/types";
import {
  RECEPTION_COPY,
  RECEPTION_STATUS_LABELS,
} from "@/lib/receptionLogistics/config";

/**
 * Abre una ventana de impresión con el Recibo de Almacén.
 * Personaliza el HTML/CSS de esta función para cambiar el diseño del recibo.
 */
export function printWarehouseReceipt(truck: ReceptionTruck): void {
  if (!truck.warehouseReceiptNumber) return;

  const w = window.open("", "_blank", "width=800,height=900");
  if (!w) {
    alert("Permite ventanas emergentes para imprimir el recibo.");
    return;
  }

  const now = new Date().toLocaleString("es-PA");
  const statusLabel = RECEPTION_STATUS_LABELS[truck.status] ?? truck.status;

  w.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${RECEPTION_COPY.receiptTitle} — ${truck.warehouseReceiptNumber}</title>
  <style>
  body { font-family: Arial, sans-serif; margin: 32px; color: #16263F; }
  .brand { font-size: 22px; font-weight: 800; color: #16263F; }
  .tag { font-size: 11px; color: #64748b; margin-top: 4px; }
  h1 { font-size: 18px; margin: 24px 0 8px; border-bottom: 2px solid #16263F; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  td { padding: 8px 4px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
  td.label { width: 38%; font-weight: 700; color: #475569; }
  .footer { margin-top: 32px; font-size: 11px; color: #94a3b8; text-align: center; }
  @media print { body { margin: 16px; } }
  </style>
</head>
<body>
  <div class="brand">${RECEPTION_COPY.companyName}</div>
  <div class="tag">${RECEPTION_COPY.companyTagline}</div>
  <h1>${RECEPTION_COPY.receiptTitle}</h1>
  <table>
    <tr><td class="label">Nº Recibo</td><td><strong>${truck.warehouseReceiptNumber}</strong></td></tr>
    <tr><td class="label">Fecha / hora</td><td>${now}</td></tr>
    <tr><td class="label">Placa</td><td>${truck.plate}</td></tr>
    <tr><td class="label">RA</td><td>${truck.ra}</td></tr>
    <tr><td class="label">Cliente</td><td>${truck.client}</td></tr>
    <tr><td class="label">Proveedor</td><td>${truck.provider}</td></tr>
    <tr><td class="label">Bultos esperados</td><td>${truck.expectedBultos}</td></tr>
    <tr><td class="label">Ubicación</td><td>${statusLabel}</td></tr>
    ${truck.driverName ? `<tr><td class="label">Conductor</td><td>${truck.driverName}</td></tr>` : ""}
    ${truck.notes ? `<tr><td class="label">Notas</td><td>${truck.notes}</td></tr>` : ""}
  </table>
  <p class="footer">Documento generado automáticamente — ${RECEPTION_COPY.companyName}</p>
  <script>window.onload = function(){ window.print(); };</script>
</body>
</html>`);
  w.document.close();
}
