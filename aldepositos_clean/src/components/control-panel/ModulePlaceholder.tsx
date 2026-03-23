"use client";

import React, { ReactNode } from "react";

type ModulePlaceholderProps = {
  moduleTitle: ReactNode;
  icon: ReactNode;
  subtitle: string;
  description: string;
};

export function ModulePlaceholder({
  moduleTitle,
  icon,
  subtitle,
  description,
}: ModulePlaceholderProps) {
  return (
    <div className="max-w-4xl mx-auto space-y-4 md:space-y-6 animate-fade pb-20">
      <h2 className="text-xl md:text-3xl font-black text-[#16263F] flex items-center gap-2 md:gap-3 px-2 md:px-0">
        {moduleTitle}
      </h2>
      <div className="bg-white p-8 md:p-16 rounded-[2rem] border border-slate-200 shadow-sm text-center flex flex-col items-center justify-center">
        <div className="flex items-center justify-center w-16 h-16 mb-4">
          {icon}
        </div>
        <h3 className="text-xl font-black text-[#16263F] uppercase tracking-widest mb-2">
          {subtitle}
        </h3>
        <p className="text-slate-500 font-medium max-w-md">{description}</p>
      </div>
    </div>
  );
}
