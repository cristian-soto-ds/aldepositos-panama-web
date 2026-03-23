"use client";

import React from "react";
import { LogOut } from "lucide-react";

type WelcomeCardProps = {
  email: string;
  onLogout: () => void;
};

export function WelcomeCard({ email, onLogout }: WelcomeCardProps) {
  return (
    <div className="bg-white p-10 md:p-12 rounded-[2rem] shadow-2xl text-center animate-fade-in border border-white relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-[#16263F]/5 to-transparent pointer-events-none" />

      <div className="relative z-10 w-24 h-24 bg-blue-50 border-4 border-blue-100 rounded-[1.5rem] flex items-center justify-center mx-auto mb-8 shadow-inner shadow-blue-500/10">
        <span className="text-4xl font-black text-blue-600 uppercase">
          {email.charAt(0)}
        </span>
      </div>

      <h2 className="relative z-10 text-3xl font-black text-[#16263F] tracking-tight mb-2">
        ¡Hola de nuevo!
      </h2>
      <p className="relative z-10 text-slate-500 font-medium text-sm mb-8">
        Has iniciado sesión exitosamente con:
        <br />
        <span className="font-bold text-[#16263F] bg-slate-50 px-4 py-2 rounded-xl inline-block mt-3 border border-slate-200">
          {email}
        </span>
      </p>

      <button
        onClick={onLogout}
        className="relative z-10 w-full bg-white border-2 border-slate-200 text-slate-500 font-bold py-4 rounded-xl hover:bg-slate-50 hover:border-slate-400 hover:text-[#16263F] transition-all flex items-center justify-center gap-2 active:scale-[0.98] uppercase tracking-widest text-[11px]"
      >
        <LogOut className="w-4 h-4" /> Cerrar Sesión
      </button>
    </div>
  );
}

