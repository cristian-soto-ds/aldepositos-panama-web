/**
 * One-shot helper: add Tailwind dark: utilities tied to html.panel-dark.
 * Skips ReferenceCatalogModule and DeleteRaConfirmModal (already hand-tuned).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const files = [
  "src/components/control-panel/ControlPanelHome.tsx",
  "src/components/control-panel/QuickInventoryEntry.tsx",
  "src/components/control-panel/DetailedInventoryEntry.tsx",
  "src/components/control-panel/DispatchEntry.tsx",
  "src/components/control-panel/LiveMonitor.tsx",
  "src/components/control-panel/ContainerReportsModule.tsx",
  "src/components/control-panel/CompletedReportsModule.tsx",
  "src/components/control-panel/ProductivityInsightsPanel.tsx",
  "src/components/control-panel/UserOptionsPanel.tsx",
  "src/components/control-panel/ModulePlaceholder.tsx",
  "src/components/modals/ManualEntryModal.tsx",
  "src/components/control-panel/inventorySummaryUnits.tsx",
  "src/components/control-panel/ReportPdfExportLayout.tsx",
];

function patch(content) {
  let s = content;
  const reps = [
    [/text-\[#16263F\](?! dark:)/g, "text-[#16263F] dark:text-slate-100"],
    [/border-slate-200\/90(?! dark:)/g, "border-slate-200/90 dark:border-slate-600/90"],
    [/border-slate-200(?! dark:)/g, "border-slate-200 dark:border-slate-600"],
    [/border-slate-300(?! dark:)/g, "border-slate-300 dark:border-slate-600"],
    [/border-slate-100(?! dark:)/g, "border-slate-100 dark:border-slate-700"],
    [/divide-slate-100(?! dark:)/g, "divide-slate-100 dark:divide-slate-800"],
    [/shadow-slate-200\/50(?! dark:)/g, "shadow-slate-200/50 dark:shadow-black/30"],
    [/shadow-slate-200\/40(?! dark:)/g, "shadow-slate-200/40 dark:shadow-black/25"],
    [/bg-slate-50\/(\d+)(?! dark:)/g, "bg-slate-50/$1 dark:bg-slate-800/$1"],
    [/\bbg-slate-50\b(?! dark:)(?!\/)/g, "bg-slate-50 dark:bg-slate-800/60"],
    [/\bbg-blue-50\b(?! dark:)(?!\/)/g, "bg-blue-50 dark:bg-blue-950/45"],
    [/(?<![\w-])bg-white\b(?!\/)(?! dark:)/g, "bg-white dark:bg-slate-900"],
    [/(?<!dark:)text-slate-900(?! dark:)/g, "text-slate-900 dark:text-slate-100"],
    [/(?<!dark:)text-slate-500(?! dark:)/g, "text-slate-500 dark:text-slate-400"],
    [/(?<!dark:)text-slate-600(?! dark:)/g, "text-slate-600 dark:text-slate-300"],
    [/(?<!dark:)text-slate-700(?! dark:)/g, "text-slate-700 dark:text-slate-200"],
    [/(?<!dark:)text-slate-400(?! dark:)/g, "text-slate-400 dark:text-slate-500"],
    [/\btext-blue-600\b(?! dark:)/g, "text-blue-600 dark:text-blue-400"],
    [/\btext-blue-700\b(?! dark:)/g, "text-blue-700 dark:text-blue-300"],
    [/hover:bg-slate-50(?! dark:)/g, "hover:bg-slate-50 dark:hover:bg-slate-800/80"],
    [/placeholder:text-slate-400(?! dark:)/g, "placeholder:text-slate-400 dark:placeholder:text-slate-500"],
  ];
  for (const [re, to] of reps) {
    s = s.replace(re, to);
  }
  return s;
}

for (const rel of files) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) {
    console.warn("skip missing", rel);
    continue;
  }
  const before = fs.readFileSync(fp, "utf8");
  const after = patch(before);
  if (after !== before) {
    fs.writeFileSync(fp, after, "utf8");
    console.log("patched", rel);
  } else {
    console.log("unchanged", rel);
  }
}
