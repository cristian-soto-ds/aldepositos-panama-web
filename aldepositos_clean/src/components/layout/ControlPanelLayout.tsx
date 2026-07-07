"use client";

import React, { ReactNode, useEffect, useRef, useState } from "react";
import {
  LogOut,
  Menu,
  Truck,
  LayoutDashboard,
  Box,
  FileText,
  X,
  ClipboardList,
  PackageSearch,
  Settings,
  UserRound,
  BookMarked,
  HandHelping,
  MoreHorizontal,
  Route,
  Camera,
  Trophy,
  type LucideIcon,
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

function NavIcon({ Icon }: { Icon: LucideIcon }) {
  return <Icon className="icon-nav" aria-hidden />;
}

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

  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sidebarOpen]);

  return (
    <div
      className={`flex h-dvh min-h-screen flex-col overflow-hidden font-sans text-gray-800 md:flex-row dark:text-slate-200 ${
        preferences?.theme === "dark" ? "bg-slate-900" : "bg-slate-50"
      }`}
    >
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-dvh min-h-screen w-[min(86vw,20rem)] max-w-xs flex-col shadow-2xl transition-transform duration-300 md:relative md:inset-auto md:h-full md:w-60 md:max-w-none md:translate-x-0 lg:w-72 ${
          preferences?.theme === "dark" ? "bg-[#0d1627]" : "bg-[#16263F]"
        } ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="sidebar-brand-header relative shrink-0 border-b border-white/10">
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="touch-target absolute right-3 top-[max(0.75rem,env(safe-area-inset-top,0px))] flex items-center justify-center rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-white md:hidden"
            aria-label="Cerrar menú"
          >
            <X className="icon-md" />
          </button>
          <div className="mx-auto flex w-full flex-col items-center gap-2.5 text-center">
            <BrandLogoMark variant="sidebar" priority />
            <div>
              <p className="text-base font-black leading-none tracking-tight text-white md:text-[1.05rem]">
                ALDEPOSITOS
              </p>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 sm:text-[10px]">
                Zona Libre Panamá
              </p>
            </div>
          </div>
        </div>

        <nav className="hide-scrollbar flex-1 space-y-1.5 overflow-y-auto p-3 sm:space-y-2 sm:p-4 md:space-y-3 md:p-5 lg:p-6">
          <p className="mb-1 px-3 text-[8px] font-bold uppercase tracking-widest text-slate-500 sm:px-4 sm:text-[9px]">
            Ingreso de carga
          </p>
          <NavItem
            icon={<NavIcon Icon={Box} />}
            text="Ingreso Rápido"
            active={currentView === "quick-entry"}
            onClick={() => {
              setCurrentView("quick-entry");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<NavIcon Icon={FileText} />}
            text="Ingreso Detallado"
            active={currentView === "detailed-entry"}
            onClick={() => {
              setCurrentView("detailed-entry");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<NavIcon Icon={Camera} />}
            text="Registro Fotográfico"
            active={currentView === "photo-record"}
            onClick={() => {
              setCurrentView("photo-record");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<NavIcon Icon={HandHelping} />}
            text="Orden de Recolección"
            active={currentView === "collection-orders"}
            onClick={() => {
              setCurrentView("collection-orders");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<NavIcon Icon={ClipboardList} />}
            text="Recepcionista"
            active={currentView === "receptionist"}
            onClick={() => {
              setCurrentView("receptionist");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<NavIcon Icon={Route} />}
            text="Recepción de Camiones"
            active={currentView === "truck-direction"}
            onClick={() => {
              setCurrentView("truck-direction");
              setSidebarOpen(false);
            }}
          />

          <div className="my-3 border-b border-white/5 md:my-4" />

          <p className="mb-1 px-3 text-[8px] font-bold uppercase tracking-widest text-slate-500 sm:px-4 sm:text-[9px]">
            Logística y control
          </p>
          <NavItem
            icon={<NavIcon Icon={PackageSearch} />}
            text="Contenedores"
            active={currentView === "container-reports"}
            onClick={() => {
              setCurrentView("container-reports");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<NavIcon Icon={BookMarked} />}
            text="Catálogo de Referencias"
            active={currentView === "reference-catalog"}
            onClick={() => {
              setCurrentView("reference-catalog");
              setSidebarOpen(false);
            }}
          />

          <div className="my-3 border-b border-white/5 md:my-4" />

          <p className="mb-1 px-3 text-[8px] font-bold uppercase tracking-widest text-slate-500 sm:px-4 sm:text-[9px]">
            Salida
          </p>
          <NavItem
            icon={<NavIcon Icon={Truck} />}
            text="Entrega de Carga"
            active={currentView === "dispatch"}
            onClick={() => {
              setCurrentView("dispatch");
              setSidebarOpen(false);
            }}
          />

          <div className="my-3 border-b border-white/5 md:my-4" />

          <p className="mb-1 px-3 text-[8px] font-bold uppercase tracking-widest text-slate-500 sm:px-4 sm:text-[9px]">
            Administración y rendimiento
          </p>
          <NavItem
            icon={<NavIcon Icon={LayoutDashboard} />}
            text="Panel Principal"
            active={currentView === "dashboard"}
            onClick={() => {
              setCurrentView("dashboard");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<NavIcon Icon={ClipboardList} />}
            text="Reportes"
            active={currentView === "reports"}
            onClick={() => {
              setCurrentView("reports");
              setSidebarOpen(false);
            }}
          />
          <NavItem
            icon={<NavIcon Icon={Trophy} />}
            text="Ranking Inventariadores"
            active={currentView === "inventory-leaderboard"}
            onClick={() => {
              setCurrentView("inventory-leaderboard");
              setSidebarOpen(false);
            }}
          />
          {showOptionsModule && (
            <NavItem
              icon={<NavIcon Icon={Settings} />}
              text="Opciones de Usuario"
              active={currentView === "options"}
              onClick={() => {
                setCurrentView("options");
                setSidebarOpen(false);
              }}
            />
          )}
        </nav>

        <div className="border-t border-white/5 bg-black/20 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-4 md:pb-[max(1rem,env(safe-area-inset-bottom))] lg:p-6 lg:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div
            ref={userMenuRef}
            className="relative flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 p-2.5 sm:gap-3 sm:p-3"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/5 sm:h-10 sm:w-10">
              {avatarSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarSrc} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <UserRound className="icon-sm text-slate-200" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-black text-white sm:text-[12px]">
                {userDisplayName || "Operador"}
              </p>
              {userEmail && (
                <p className="truncate text-[10px] font-semibold text-slate-300/90 sm:text-[11px]">
                  {userEmail}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              className="touch-target flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 sm:p-2"
              aria-label="Opciones de usuario"
              aria-expanded={userMenuOpen}
            >
              <MoreHorizontal className="icon-sm" />
            </button>

            {userMenuOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-[min(14rem,80vw)] overflow-hidden rounded-2xl border border-white/10 bg-[#0d1627] shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    void handleLogout();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-red-300 hover:bg-white/5"
                >
                  <LogOut className="icon-sm" /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
          preferences?.theme === "dark" ? "bg-slate-900" : "bg-slate-50"
        }`}
      >
        <header
          className={`app-shell-header safe-area-top safe-area-x z-30 flex shrink-0 items-center justify-between text-white shadow-md md:hidden ${
            preferences?.theme === "dark" ? "bg-[#0d1627]" : "bg-[#16263F]"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2.5 py-2 sm:gap-3">
            <BrandLogoMark variant="headerCompact" />
            <span className="truncate text-base font-black uppercase tracking-tighter sm:text-lg">
              Aldepósitos
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="touch-target flex items-center justify-center rounded-lg transition-colors hover:bg-white/10"
            aria-label="Abrir menú"
          >
            <Menu className="icon-lg" />
          </button>
        </header>
        <main className="panel-main-content safe-area-bottom relative min-h-0 flex-1 overflow-hidden p-2 sm:p-3 md:p-6 lg:p-8">
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
      type="button"
      onClick={onClick}
      className={`flex w-full min-h-[var(--touch-min)] items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-300 sm:min-h-0 sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-3 md:gap-4 md:px-5 md:py-3.5 lg:px-6 lg:py-4 ${
        active
          ? "bg-blue-600 font-black text-white shadow-xl md:scale-[1.03]"
          : "text-slate-400 hover:bg-white/5 hover:text-white"
      }`}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase leading-tight tracking-wider break-words sm:text-[11px] md:text-xs md:tracking-widest lg:text-sm">
        {text}
      </span>
    </button>
  );
}
