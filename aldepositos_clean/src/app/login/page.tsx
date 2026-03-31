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
    <div className="min-h-screen font-sans bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] bg-blue-200/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-slate-300/30 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <LoginForm onSuccess={handleSuccess} />
      </div>
    </div>
  );
}

