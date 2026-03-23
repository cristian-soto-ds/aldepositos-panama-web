"use client";

import React, { useEffect, useState } from "react";
import { Edit3, X } from "lucide-react";
import type { ControlPanelHome } from "@/components/control-panel/ControlPanelHome";

type Task = Parameters<typeof ControlPanelHome>[0]["tasks"][number];

type ManualEntryModalProps = {
  onClose: () => void;
  onSave: (task: Task) => void;
  initialData: Task | null;
  defaultModule: "quick" | "detailed" | "airway";
};

const generateId = () => Math.random().toString(36).substr(2, 9);

export function ManualEntryModal({
  onClose,
  onSave,
  initialData,
  defaultModule,
}: ManualEntryModalProps) {
  const [formData, setFormData] = useState({
    ra: "",
    mainClient: "",
    provider: "",
    subClient: "",
    brand: "",
    expectedBultos: "",
    expectedCbm: "",
    expectedWeight: "",
    notes: "",
    module: defaultModule,
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        ra: initialData.ra || "",
        mainClient: initialData.mainClient || "",
        provider: initialData.provider || "",
        subClient: initialData.subClient || "",
        brand: initialData.brand || "",
        expectedBultos:
          initialData.expectedBultos !== undefined
            ? String(initialData.expectedBultos)
            : "",
        expectedCbm:
          initialData.expectedCbm !== undefined
            ? String(initialData.expectedCbm)
            : "",
        expectedWeight:
          initialData.expectedWeight !== undefined
            ? String(initialData.expectedWeight)
            : "",
        notes: initialData.notes || "",
        module: (initialData.type as ManualEntryModalProps["defaultModule"]) ||
          defaultModule,
      });
    }
  }, [initialData, defaultModule]);

  const handleChange: React.ChangeEventHandler<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  > = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();

    const taskData: Task = {
      id: initialData ? initialData.id : generateId(),
      ra: formData.ra.toString().trim(),
      mainClient: formData.mainClient.trim() || "Sin Cliente",
      provider: formData.provider.trim() || "N/A",
      subClient: formData.subClient.trim() || "N/A",
      brand: formData.brand.trim() || "N/A",
      expectedBultos: parseFloat(formData.expectedBultos) || 0,
      originalExpectedBultos: initialData
        ? initialData.originalExpectedBultos
        : parseFloat(formData.expectedBultos) || 0,
      expectedCbm: parseFloat(formData.expectedCbm) || 0,
      expectedWeight: parseFloat(formData.expectedWeight) || 0,
      notes: formData.notes.trim() || "",
      type: formData.module as Task["type"],
      currentBultos: initialData ? initialData.currentBultos : 0,
      status: initialData ? initialData.status : "pending",
      measureData: initialData ? initialData.measureData : [],
      weightMode: initialData ? initialData.weightMode : "no_weight",
      manualTotalWeight: initialData ? initialData.manualTotalWeight : 0,
    };

    onSave(taskData);
  };

  const isEditing = !!initialData;

  return (
    <div className="fixed inset-0 bg-[#16263F]/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade">
      <div className="bg-white w-full max-w-2xl rounded-3xl md:rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
        <div className="bg-[#16263F] p-5 md:p-6 text-white shrink-0 flex justify-between items-center">
          <h3 className="text-lg md:text-xl font-black tracking-tight flex items-center gap-2 md:gap-3">
            <Edit3 className="text-blue-400 w-5 h-5" />{" "}
            {isEditing ? "Editar RA" : "Crear RA Manual"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-5 md:p-8 space-y-4 overflow-y-auto flex-1"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Número de RA *
              </label>
              <input
                required
                name="ra"
                value={formData.ra}
                onChange={handleChange}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none font-bold text-[#16263F]"
                placeholder="Ej: 54069"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Cliente / Consignatario *
              </label>
              <input
                required
                name="mainClient"
                value={formData.mainClient}
                onChange={handleChange}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none font-bold text-[#16263F]"
                placeholder="Ej: LOGI TRADING"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Proveedor
              </label>
              <input
                name="provider"
                value={formData.provider}
                onChange={handleChange}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm text-[#16263F]"
                placeholder="Nombre del proveedor"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Marca / Tracking
              </label>
              <input
                name="brand"
                value={formData.brand}
                onChange={handleChange}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm text-[#16263F]"
                placeholder="Marca o # de seguimiento"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Expedidor
              </label>
              <input
                name="subClient"
                value={formData.subClient}
                onChange={handleChange}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm text-[#16263F]"
                placeholder="Ej: EFRAIN ROJAS"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Módulo de Destino *
              </label>
              <select
                name="module"
                value={formData.module}
                onChange={handleChange}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none font-bold text-[#16263F] cursor-pointer"
              >
                <option value="quick">Ingreso Rápido</option>
                <option value="detailed">Ingreso Detallado</option>
                <option value="airway">Guía Aérea</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-2">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Bultos *
              </label>
              <input
                required
                type="number"
                name="expectedBultos"
                value={formData.expectedBultos}
                onChange={handleChange}
                className="no-spinners w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 outline-none font-black text-blue-600"
                placeholder="0"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Volumen (m³)
              </label>
              <input
                type="number"
                step="0.01"
                name="expectedCbm"
                value={formData.expectedCbm}
                onChange={handleChange}
                className="no-spinners w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 outline-none text-sm"
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Peso (kg)
              </label>
              <input
                type="number"
                step="0.01"
                name="expectedWeight"
                value={formData.expectedWeight}
                onChange={handleChange}
                className="no-spinners w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 outline-none text-sm"
                placeholder="0.0"
              />
            </div>
          </div>

          <div className="space-y-1 pt-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              Notas Adicionales
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-blue-500 outline-none text-sm"
              placeholder="Observaciones de la carga..."
              rows={2}
            />
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-white border border-slate-200 text-slate-500 font-bold rounded-xl hover:bg-slate-50 transition-colors uppercase text-xs tracking-widest"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-3 bg-[#16263F] text-white font-bold rounded-xl shadow-lg hover:bg-blue-900 transition-colors uppercase text-xs tracking-widest"
            >
              Guardar RA
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

