"use client";

import React, { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { copyToClipboard } from "@/lib/warehouse/xellent-export";

export type LabelKind = "RA" | "EXPEDIDOR" | "BULTO";

export type LabelPrintData = {
  kind: LabelKind;
  barcode: string;
  clientDisplay: string;
  title: string;
  shipperName?: string;
  provider?: string;
  ra?: string;
  orderRef?: string;
  /** Bulto actual (1-based) cuando kind === BULTO. */
  packageSeq?: number;
  /** Total de bultos del RA cuando kind === BULTO. */
  packageTotal?: number;
  extraLines?: string[];
};

type LabelPrinterProps = {
  labels: LabelPrintData[];
  onClose: () => void;
};

function kindLabel(kind: LabelKind): string {
  if (kind === "BULTO") return "Etiqueta por bulto";
  if (kind === "RA") return "Código por RA";
  return "Código por expedidor";
}

function BarcodeSvg({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        displayValue: true,
        fontSize: value.length > 22 ? 11 : 14,
        height: 56,
        margin: 4,
        width: value.length > 28 ? 0.9 : value.length > 18 ? 1.2 : 1.6,
      });
    } catch (e) {
      console.warn("[LabelPrinter] JsBarcode", e);
    }
  }, [value]);
  return <svg ref={ref} className="mx-auto max-w-full" />;
}

export function LabelPrinter({ labels, onClose }: LabelPrinterProps) {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const id = "warehouse-label-print-css";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @media print {
        @page { size: 100mm 150mm; margin: 4mm; }
        body * { visibility: hidden !important; }
        .warehouse-label-sheet, .warehouse-label-sheet * { visibility: visible !important; }
        .warehouse-label-sheet { position: absolute; left: 0; top: 0; width: 100%; }
        .warehouse-label { break-after: page; page-break-after: always; }
        .warehouse-print-chrome { display: none !important; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const copyCode = async (code: string) => {
    const ok = await copyToClipboard(code);
    setCopied(ok ? code : null);
    if (ok) window.setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-white dark:bg-slate-950">
      <div className="warehouse-print-chrome flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div>
          <p className="text-sm font-black text-[#16263F] dark:text-slate-100">
            Etiquetas ({labels.length}) — Code 128 · Xellent X-1000VL
          </p>
          <p className="text-[10px] text-slate-500">
            Copiá el código al programa de la impresora o imprimí desde el navegador
            (100×150 mm).
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-xl bg-[#16263F] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white"
          >
            Imprimir
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2 text-[10px] font-black uppercase tracking-widest dark:border-slate-600"
          >
            Cerrar
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 print:p-0">
        <div className="warehouse-label-sheet mx-auto flex max-w-xl flex-col gap-6 print:max-w-none print:gap-0">
          {labels.map((lab, idx) => (
            <article
              key={`${lab.barcode}-${idx}`}
              className="warehouse-label rounded-xl border-2 border-[#16263F] p-4 text-[#16263F] dark:border-slate-300 dark:text-slate-100 print:rounded-none print:border-black"
            >
              <header className="mb-2 border-b border-slate-300 pb-2 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest">
                  Aldepósitos Zona Libre, S.A.
                </p>
                <p className="text-lg font-black">Cliente: {lab.clientDisplay}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {kindLabel(lab.kind)}
                </p>
              </header>
              {lab.kind === "BULTO" ? (
                <div className="space-y-2 text-center">
                  <p className="text-lg font-black">
                    Pedido: {lab.ra ?? "—"}
                  </p>
                  {lab.orderRef ? (
                    <p className="text-sm font-bold">
                      <span className="text-slate-500">MARCA:</span> {lab.orderRef}
                    </p>
                  ) : null}
                  <p className="text-2xl font-black tabular-nums tracking-tight">
                    BULTOS: {lab.packageSeq ?? "—"} DE: {lab.packageTotal ?? "—"}
                  </p>
                  {lab.shipperName ? (
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Expedidor: {lab.shipperName}
                    </p>
                  ) : null}
                  {lab.provider ? (
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Proveedor: {lab.provider}
                    </p>
                  ) : null}
                  {(lab.extraLines ?? []).map((line, i) => (
                    <p key={i} className="text-xs text-slate-500">
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="font-bold text-slate-500">Título</dt>
                  <dd className="font-semibold">{lab.title}</dd>
                  {lab.ra ? (
                    <>
                      <dt className="font-bold text-slate-500">RA / Pedido</dt>
                      <dd className="font-black">{lab.ra}</dd>
                    </>
                  ) : null}
                  {lab.shipperName ? (
                    <>
                      <dt className="font-bold text-slate-500">Expedidor</dt>
                      <dd className="font-semibold">{lab.shipperName}</dd>
                    </>
                  ) : null}
                  {lab.provider ? (
                    <>
                      <dt className="font-bold text-slate-500">Proveedor</dt>
                      <dd>{lab.provider}</dd>
                    </>
                  ) : null}
                  {lab.orderRef ? (
                    <>
                      <dt className="font-bold text-slate-500">Ref. pedido</dt>
                      <dd>{lab.orderRef}</dd>
                    </>
                  ) : null}
                  {(lab.extraLines ?? []).map((line, i) => (
                    <React.Fragment key={i}>
                      <dt className="font-bold text-slate-500">Nota</dt>
                      <dd>{line}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
              <div className="mt-3">
                <BarcodeSvg value={lab.barcode} />
              </div>
              <div className="warehouse-print-chrome mt-3 flex flex-wrap items-center justify-center gap-2">
                <code className="rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-sm font-bold dark:bg-slate-800">
                  {lab.barcode}
                </code>
                <button
                  type="button"
                  onClick={() => void copyCode(lab.barcode)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-[10px] font-black uppercase dark:border-slate-600"
                >
                  {copied === lab.barcode ? "Copiado" : "Copiar para Xellent"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
