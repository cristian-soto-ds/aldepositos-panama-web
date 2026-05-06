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
    <div className="bg-white rounded-[2rem] shadow-2xl p-8 md:p-12 relative overflow-hidden animate-fade-in border border-white">
      <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-[#16263F]/5 to-transparent pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center text-center mb-10">
        <div className="relative mb-6 flex items-center justify-center">
          <div
            className="absolute left-1/2 top-1/2 h-[8rem] w-[8rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#16263F]/[0.07] blur-2xl pointer-events-none"
            aria-hidden
          />
          <BrandLogoMark variant="loginHero" priority />
        </div>
        <h1 className="text-3xl font-black text-[#16263F] tracking-tighter leading-none mb-2">
          ALDEPOSITOS
        </h1>
        <h2 className="text-[11px] font-bold text-slate-400 tracking-[0.3em] uppercase">
          Panamá
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="relative z-10 space-y-6">
        <div className="space-y-2 text-left">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
            Usuario
          </label>
          <div className="relative group">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-[#16263F] transition-colors" />
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full pl-12 pr-4 py-4 bg-slate-50/50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-[#16263F] focus:border-[#16263F] outline-none transition-all font-medium text-[#16263F]"
              placeholder="Ingresa tu usuario"
            />
          </div>
        </div>

        <div className="space-y-2 text-left">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
            Contraseña
          </label>
          <div className="relative group">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-[#16263F] transition-colors" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-12 pr-12 py-4 bg-slate-50/50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-[#16263F] focus:border-[#16263F] outline-none transition-all font-medium text-[#16263F]"
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
          className="w-full bg-[#16263F] text-white font-bold py-4 rounded-xl shadow-lg shadow-[#16263F]/30 hover:bg-[#0f1b2d] hover:shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 mt-8 disabled:opacity-70 disabled:cursor-not-allowed uppercase tracking-widest text-[11px]"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              Iniciar Sesión <ArrowRight className="w-4 h-4" />
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

