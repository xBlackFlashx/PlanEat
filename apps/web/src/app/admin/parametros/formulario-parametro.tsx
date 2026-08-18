"use client";

import { useState } from "react";

import { guardarParametro } from "./acciones";

const CAMPO =
  "h-10 rounded-[var(--radius)] border border-line-strong bg-surface px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-brand";

export function FormularioParametro() {
  const [clave, setClave] = useState("");
  const [valor, setValor] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function alEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await guardarParametro(clave, valor, descripcion);
      setClave("");
      setValor("");
      setDescripcion("");
    } catch {
      setError("No se pudo guardar el parámetro.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-1.5">
        <span className="text-sm font-medium text-text-2">Clave</span>
        <input
          type="text"
          required
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          className={CAMPO}
        />
      </label>
      <label className="flex flex-1 flex-col gap-1.5">
        <span className="text-sm font-medium text-text-2">Valor</span>
        <input
          type="text"
          required
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className={CAMPO}
        />
      </label>
      <label className="flex flex-[2] flex-col gap-1.5">
        <span className="text-sm font-medium text-text-2">Descripción</span>
        <input
          type="text"
          required
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          className={CAMPO}
        />
      </label>
      <button
        type="submit"
        disabled={guardando}
        className="flex h-10 items-center justify-center rounded-[var(--radius)] bg-brand px-5 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
      >
        {guardando ? "Guardando…" : "Guardar"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </form>
  );
}
