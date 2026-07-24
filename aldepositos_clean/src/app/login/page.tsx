"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const handleSuccess = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.push("/panel");
        return;
      }
      const res = await fetch("/api/me/role", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = (await res.json()) as { rol?: string };
        if (json.rol === "proveedor") {
          router.push("/proveedor");
          return;
        }
      }
    } catch {
      // fallback panel
    }
    router.push("/panel");
  };

  return (
    <div className="safe-area-insets relative flex min-h-dvh min-h-screen items-center justify-center overflow-hidden bg-[var(--panel-bg)] font-sans">
      <div className="pointer-events-none absolute left-[-10%] top-[-10%] h-[min(600px,90vw)] w-[min(600px,90vw)] rounded-full bg-blue-200/20 blur-3xl dark:bg-blue-500/10" />
      <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] h-[min(600px,90vw)] w-[min(600px,90vw)] rounded-full bg-slate-300/30 blur-3xl dark:bg-slate-700/25" />

      <div className="relative z-10 w-full max-w-md">
        <LoginForm onSuccess={() => void handleSuccess()} />
      </div>
    </div>
  );
}
