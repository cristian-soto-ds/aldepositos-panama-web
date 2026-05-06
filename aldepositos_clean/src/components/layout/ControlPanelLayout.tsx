"use client";

import React, { ReactNode, useEffect, useRef, useState } from "react";
import {
  LogOut,
  Menu,
  Truck,
  Activity,
  LayoutDashboard,
  Box,
  FileText,
  Plane,
  X,
  ClipboardList,
  PackageSearch,
  BarChart3,
  Settings,
  UserRound,
  BookMarked,
  HandHelping,
  MoreHorizontal,
} from "lucide-react";
import { BrandLogoMark } from "@/components/brand/BrandLogoMark";
import { supabase } from "@/lib/supabase";
import { clearWorkPresence, getSharedWorkPresenceTabId } from "@/lib/panelPresence";
import { useRouter } from "next/navigation";
import type { UserPreferences } from "@/lib/userPreferences";

type ControlPanelLayoutProps = {
  children: ReactNode;
  currentView: string;
  setCurrentView: (view: string) => void;
  userDisplayName?: string | null;
  userEmail?: string | null;
  /** Imagen de perfil (URL pública o data URL local). */
  userAvatarSrc?: string | null;
  preferences?: UserPreferences;
  showOptionsModule?: boolean;
};

export function ControlPanelLayout({
  children,
  currentView,
  setCurrentView,
  userDisplayName,
  userEmail = null,
  userAvatarSrc = null,
  preferences,
  showOptionsModule = false,
}: ControlPanelLayoutProps) {
  const avatarSrc =
    (userAvatarSrc && userAvatarSrc.trim()) ||
    preferences?.avatarDataUrl ||
    null;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const router = useRouter();
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    void clearWorkPresence(getSharedWorkPresenceTabId());
    router.push("/login");
  };

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDown = (ev: MouseEvent | TouchEvent) => {
      const el = userMenuRef.current;
      if (!el) return;
      if (ev.target instanceof Node && el.contains(ev.target)) return;
      setUserMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("touchstart", onDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
    };
  }, [userMenuOpen]);

  return (
    <div className={`h-dvh min-h-screen flex flex-col md:flex-row font-sans text-gray-800 dark:text-slate-200 overflow-hidden ${
      preferences?.theme === "dark" ? "bg-slate-900" : "bg-slate-50"
    }`}>
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
        />
      )}

      <aside
        className={`fixed md:relative z-50 w-[86vw] max-w-72 md:w-72 ${
          preferences?.theme === "dark" ? "bg-[#0d1627]" : "bg-[#16263F]"
        } h-full min-h-screen flex flex-col shadow-2xl transition-transform duration-300 ${
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
          <BrandLogoMark variant="sidebar" priority />
          <div className="text-center">
            <p className="font-black text-xl md:text-2xl tracking-tighter leading-none text-white">
              ALDEPOSITOS
            </p>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em] mt-1 opacity-80">
              Zona Libre Panamá
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
            icon={<HandHelping size={20} />}
            text="Orden de recolección"
            active={currentView === "collection-orders"}
            onClick={() => {
              setCurrentView("collection-orders");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<BookMarked size={20} />}
            text="Catálogo de referencias"
            active={currentView === "reference-catalog"}
            onClick={() => {
              setCurrentView("reference-catalog");
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
          <NavItem
            icon={<BarChart3 size={20} />}
            text="Productividad"
            active={currentView === "productivity"}
            onClick={() => {
              setCurrentView("productivity");
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
          {showOptionsModule && (
            <NavItem
              icon={<Settings size={20} />}
              text="Opciones de usuario"
              active={currentView === "options"}
              onClick={() => {
                setCurrentView("options");
                setSidebarOpen(false);
              }}
            />
          )}
        </nav>

        <div className="p-4 md:p-6 border-t border-white/5 bg-black/20">
          <div
            ref={userMenuRef}
            className="relative flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3"
          >
            <div className="w-9 h-9 rounded-full overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center shrink-0">
              {avatarSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarSrc} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <UserRound size={16} className="text-slate-200" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-black text-white truncate">
                {userDisplayName || "Operador"}
              </p>
              {userEmail && (
                <p className="text-[11px] font-semibold text-slate-300/90 truncate">
                  {userEmail}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-2 text-slate-200 hover:bg-white/10"
              aria-label="Opciones de usuario"
              aria-expanded={userMenuOpen}
            >
              <MoreHorizontal size={18} />
            </button>

            {userMenuOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#0d1627] shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    void handleLogout();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-red-300 hover:bg-white/5"
                >
                  <LogOut size={16} /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className={`flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden ${
        preferences?.theme === "dark" ? "bg-slate-900" : "bg-slate-50"
      }`}>
        <header className={`md:hidden text-white p-4 flex justify-between items-center shadow-md z-30 shrink-0 ${
          preferences?.theme === "dark" ? "bg-[#0d1627]" : "bg-[#16263F]"
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogoMark variant="headerCompact" />
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

