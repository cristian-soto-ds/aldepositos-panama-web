"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  const router = useRouter();

  const handleSuccess = () => {
    router.push("/panel");
  };

  return (
    <div className="safe-area-insets relative flex min-h-dvh min-h-screen items-center justify-center overflow-hidden bg-slate-50 font-sans">
      <div className="pointer-events-none absolute left-[-10%] top-[-10%] h-[min(600px,90vw)] w-[min(600px,90vw)] rounded-full bg-blue-200/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10%] right-[-10%] h-[min(600px,90vw)] w-[min(600px,90vw)] rounded-full bg-slate-300/30 blur-3xl" />

      <div className="relative z-10 w-full max-w-md">
        <LoginForm onSuccess={handleSuccess} />
      </div>
    </div>
  );
}

