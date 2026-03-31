import { supabase } from "@/lib/supabase";

type RpcEmailRow = {
  email?: string | null;
};

function pickEmailFromRpc(data: unknown): string | null {
  if (typeof data === "string" && data.trim().length > 0) {
    return data.trim();
  }

  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as RpcEmailRow | null;
    const email = first?.email;
    if (typeof email === "string" && email.trim().length > 0) {
      return email.trim();
    }
  }

  if (data && typeof data === "object") {
    const maybeRow = data as RpcEmailRow;
    if (typeof maybeRow.email === "string" && maybeRow.email.trim().length > 0) {
      return maybeRow.email.trim();
    }
  }

  return null;
}

export async function signInWithUsername(username: string, password: string) {
  const cleanUsername = username.trim().toLowerCase();

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    "get_login_email_by_username",
    { p_username: cleanUsername },
  );

  if (rpcError) {
    throw new Error("Usuario no encontrado.");
  }

  const email = pickEmailFromRpc(rpcData);
  if (!email) {
    throw new Error("Usuario no encontrado.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error("Usuario o contraseña incorrectos.");
  }

  return data;
}

