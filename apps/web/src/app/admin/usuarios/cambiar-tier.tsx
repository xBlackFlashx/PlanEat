"use client";

import { useState } from "react";

import type { Tier } from "@/generated/prisma/client";

import { cambiarTier } from "./acciones";

export function CambiarTier({ userId, tierActual }: { userId: string; tierActual: Tier }) {
  const [tier, setTier] = useState<Tier>(tierActual);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function alGuardar() {
    setGuardando(true);
    setError(null);
    try {
      await cambiarTier(userId, tier);
    } catch {
      setError("No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={tier}
        onChange={(e) => setTier(e.target.value as Tier)}
        className="h-9 rounded-[var(--radius)] border border-line-strong bg-surface px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-brand"
      >
        <option value="FREE">FREE</option>
        <option value="PRO">PRO</option>
      </select>
      <button
        type="button"
        onClick={alGuardar}
        disabled={guardando || tier === tierActual}
        className="flex h-9 items-center justify-center rounded-[var(--radius)] bg-brand px-3 text-sm font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60"
      >
        {guardando ? "Guardando…" : "Guardar"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
