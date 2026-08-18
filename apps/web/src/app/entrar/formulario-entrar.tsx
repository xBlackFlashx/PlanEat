"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * `signIn` de `next-auth/react` en vez de un `<form action>` a la ruta de
 * Auth.js: con Credentials, `redirect: false` es lo que permite mostrar el
 * error de "correo o contraseña incorrectos" en la propia página en vez de
 * mandar al usuario a una pantalla de error genérica de Auth.js.
 */
export function FormularioEntrar() {
  const router = useRouter();
  const parametros = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function alEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);

    const resultado = await signIn("credentials", { email, password, redirect: false });

    if (resultado?.error) {
      setError("Correo o contraseña incorrectos.");
      setEnviando(false);
      return;
    }

    router.push((parametros.get("volver") as "/") ?? "/");
    router.refresh();
  }

  return (
    <form onSubmit={alEnviar} className="mt-8 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text-2">Correo</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text-2">Contraseña</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="mt-2 flex h-13 min-h-13 items-center justify-center rounded-[var(--radius)] bg-brand px-6 text-[17px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
      >
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
