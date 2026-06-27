"use client";

import React, { useState } from "react";
import { User, Lock, ArrowRight, Loader2 } from "lucide-react";
import { BrandLogoMark } from "@/components/brand/BrandLogoMark";
import { signInWithUsername } from "@/lib/auth/sign-in-with-username";

type LoginFormProps = {
  onSuccess: () => void;
};

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await signInWithUsername(username, password);
      onSuccess();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Usuario o contraseña incorrectos.";
      setError(message);
      setIsLoading(false);
      return;
    }
    setIsLoading(false);
  };

  return (
    <div className="relative animate-fade-in overflow-hidden rounded-2xl border border-white bg-white p-6 shadow-2xl sm:rounded-[2rem] sm:p-8 md:p-12">
      <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-[#16263F]/5 to-transparent pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center text-center mb-10">
        <div className="relative mb-6 flex items-center justify-center">
          <div
            className="absolute left-1/2 top-1/2 h-[8rem] w-[8rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#16263F]/[0.07] blur-2xl pointer-events-none"
            aria-hidden
          />
          <BrandLogoMark variant="loginHero" priority />
        </div>
        <h1 className="text-fluid-title mb-2 font-black leading-none tracking-tighter text-[#16263F]">
          ALDEPOSITOS
        </h1>
        <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400 sm:text-[11px] sm:tracking-[0.3em]">
          Panamá
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="relative z-10 space-y-6">
        <div className="space-y-2 text-left">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
            Usuario
          </label>
          <div className="relative group">
            <User className="icon-md absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#16263F]" />
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-3.5 pl-11 pr-4 text-base font-medium text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:bg-white focus:ring-2 focus:ring-[#16263F] sm:py-4 sm:pl-12"
              placeholder="Ingresa tu usuario"
            />
          </div>
        </div>

        <div className="space-y-2 text-left">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
            Contraseña
          </label>
          <div className="relative group">
            <Lock className="icon-md absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#16263F]" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-3.5 pl-11 pr-12 text-base font-medium text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:bg-white focus:ring-2 focus:ring-[#16263F] sm:py-4 sm:pl-12"
              placeholder="••••••••"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 text-center" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isLoading || !username || !password}
          className="mt-8 flex w-full touch-target items-center justify-center gap-2 rounded-xl bg-[#16263F] py-3.5 text-[11px] font-bold uppercase tracking-widest text-white shadow-lg shadow-[#16263F]/30 transition-all hover:bg-[#0f1b2d] hover:shadow-xl active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 sm:py-4"
        >
          {isLoading ? (
            <Loader2 className="icon-md animate-spin" />
          ) : (
            <>
              Iniciar Sesión <ArrowRight className="icon-sm" />
            </>
          )}
        </button>
      </form>

      <div className="mt-8 text-center relative z-10 border-t border-slate-100 pt-6">
        <p className="text-slate-400 text-[9px] font-bold tracking-[0.2em] uppercase">
          AldePositos Zona Libre Panamá
        </p>
      </div>
    </div>
  );
}

