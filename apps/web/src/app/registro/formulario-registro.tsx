"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function FormularioRegistro() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function alEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);

    const respuesta = await fetch("/api/registro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, nombre }),
    });

    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => null)) as { error?: string } | null;
      setError(cuerpo?.error ?? "No se pudo crear la cuenta.");
      setEnviando(false);
      return;
    }

    // Entra automáticamente: pedir dos veces las mismas credenciales sería
    // fricción que el propio registro ya validó.
    await signIn("credentials", { email, password, redirect: false });
    router.push("/precios");
    router.refresh();
  }

  return (
    <form onSubmit={alEnviar} className="mt-8 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-text-2">Nombre (opcional)</span>
        <input
          type="text"
          autoComplete="name"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
        />
      </label>
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
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-12 rounded-[var(--radius)] border border-line-strong bg-surface px-3.5 text-[15px] outline-none focus-visible:outline-2 focus-visible:outline-brand"
        />
        <span className="text-xs text-text-2">Al menos 8 caracteres.</span>
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
        {enviando ? "Creando…" : "Crear cuenta"}
      </button>
    </form>
  );
}
