"use client";

import React, { ReactNode, useState } from "react";
import { LogOut, Menu, Ship, Truck, Activity, LayoutDashboard, Box, FileText, Plane, X, ClipboardList, PackageSearch } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

type ControlPanelLayoutProps = {
  children: ReactNode;
  currentView: string;
  setCurrentView: (view: string) => void;
};

export function ControlPanelLayout({
  children,
  currentView,
  setCurrentView,
}: ControlPanelLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="h-dvh min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-gray-800 overflow-hidden">
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
        />
      )}

      <aside
        className={`fixed md:relative z-50 w-[86vw] max-w-72 md:w-72 bg-[#16263F] h-full min-h-screen flex flex-col shadow-2xl transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="p-6 md:p-8 flex flex-col items-center border-b border-white/5 relative">
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute top-4 right-4 md:hidden text-gray-400 hover:text-white"
          >
            <X size={20} />
          </button>
          <div className="bg-blue-600 p-3 md:p-4 rounded-3xl text-white shadow-lg mb-3 md:mb-4">
            <Ship className="w-8 h-8 md:w-10 md:h-10" />
          </div>
          <div className="text-center">
            <p className="font-black text-xl md:text-2xl tracking-tighter leading-none text-white">
              ALDEPOSITOS
            </p>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em] mt-1 opacity-80">
              Warehouse OS
            </p>
          </div>
        </div>

        <nav className="flex-1 p-4 md:p-6 space-y-2 md:space-y-4 overflow-y-auto hide-scrollbar">
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-4 mb-2">
            Ingreso de Carga
          </p>
          <NavItem
            icon={<LayoutDashboard size={20} />}
            text="Panel Principal"
            active={currentView === "dashboard"}
            onClick={() => {
              setCurrentView("dashboard");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<Box size={20} />}
            text="Ingreso Rápido"
            active={currentView === "quick-entry"}
            onClick={() => {
              setCurrentView("quick-entry");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<FileText size={20} />}
            text="Ingreso Detallado"
            active={currentView === "detailed-entry"}
            onClick={() => {
              setCurrentView("detailed-entry");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<Plane size={20} />}
            text="Guía Aérea"
            active={currentView === "airway"}
            onClick={() => {
              setCurrentView("airway");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<ClipboardList size={20} />}
            text="Reportes"
            active={currentView === "reports"}
            onClick={() => {
              setCurrentView("reports");
              setSidebarOpen(false);
            }}
          />

          <div className="my-6 border-b border-white/5" />

          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest px-4 mb-2">
            Salida y Trazabilidad
          </p>
          <NavItem
            icon={<Truck size={20} />}
            text="Entrega de Carga"
            active={currentView === "dispatch"}
            onClick={() => {
              setCurrentView("dispatch");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<PackageSearch size={20} />}
            text="Contenedores"
            active={currentView === "container-reports"}
            onClick={() => {
              setCurrentView("container-reports");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<Activity size={20} />}
            text="Monitoreo Live"
            active={currentView === "monitor"}
            onClick={() => {
              setCurrentView("monitor");
              setSidebarOpen(false);
            }}
          />
        </nav>

        <div className="p-4 md:p-6 border-t border-white/5 bg-black/20 text-center">
          <button
            onClick={handleLogout}
            className="w-full py-3 md:py-0 text-red-400 font-black text-xs uppercase tracking-[0.2em] hover:text-white transition-colors flex items-center justify-center gap-2"
          >
            <LogOut size={16} className="md:hidden" /> Cerrar Sesión
          </button>
        </div>
      </aside>

      <div className="flex-1 min-h-0 flex flex-col min-w-0 bg-slate-50 overflow-hidden">
        <header className="md:hidden bg-[#16263F] text-white p-4 flex justify-between items-center shadow-md z-30 shrink-0">
          <div className="flex items-center gap-3">
            <Ship className="text-blue-400 w-6 h-6" />
            <span className="font-black tracking-tighter uppercase text-lg">
              Aldepósitos
            </span>
          </div>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <Menu className="w-6 h-6" />
          </button>
        </header>
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col p-3 sm:p-4 md:p-8 relative">
          {children}
        </main>
      </div>
    </div>
  );
}

type NavItemProps = {
  icon: ReactNode;
  text: string;
  active: boolean;
  onClick: () => void;
};

function NavItem({ icon, text, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 md:gap-4 px-4 md:px-6 py-3 md:py-4 rounded-2xl transition-all duration-300 text-left ${
        active
          ? "bg-blue-600 text-white font-black shadow-xl md:scale-[1.05]"
          : "text-slate-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      {icon}{" "}
      <span className="text-[11px] md:text-sm uppercase tracking-widest font-bold leading-tight break-words">
        {text}
      </span>
    </button>
  );
}

