import { redirect } from "next/navigation";

/** URL directa → panel con vista Control de Carga. */
export default function ControlCargaPage() {
  redirect("/panel?view=control-carga");
}
