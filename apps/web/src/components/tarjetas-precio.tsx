"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

import { IconoCuadra } from "@/components/iconos";

type Tier = "FREE" | "PRO";

interface PropsTarjetasPrecio {
  /** `null` = sin sesión. Se calcula en el servidor, nunca se fía del cliente. */
  tierActual: Tier | null;
}

const BULLETS_FREE = [
  "Un día de comidas, cuando quieras",
  "Sin cuenta, sin tarjeta",
  "Motor de generación completo — mismas recetas, mismo catálogo",
];

const BULLETS_PRO = [
  "Plan completo de 7 días de comidas",
  "Lista de la compra de la semana, ya sumada por ingrediente",
  "El sistema prioriza recetas que comparten ingredientes entre sí, para comprar menos variedad",
  "Cancelas cuando quieras",
];

const PRECIO_PRO = process.env.NEXT_PUBLIC_PRECIO_PRO_MXN ?? "99";

const BOTON_PRIMARIO =
  "flex h-13 min-h-13 w-full items-center justify-center rounded-[var(--radius)] bg-brand px-6 text-[17px] font-semibold text-on-brand hover:bg-brand-hover disabled:opacity-60";

const BOTON_SECUNDARIO =
  "flex h-13 min-h-13 w-full items-center justify-center rounded-[var(--radius)] border border-line-strong px-5 text-[17px] font-semibold text-text hover:bg-surface-2";

function ListaBullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 space-y-3">
      {items.map((texto) => (
        <li key={texto} className="flex items-start gap-2.5">
          <IconoCuadra tam={18} className="mt-0.5 shrink-0 text-brand" />
          <span className="text-[15px] leading-relaxed text-text-2">
            {texto}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TarjetasPrecio({ tierActual }: PropsTarjetasPrecio) {
  const { status } = useSession();
  const autenticado = status === "authenticated";
  const [cargando, setCargando] = useState(false);
  const [errorCheckout, setErrorCheckout] = useState<string | null>(null);

  async function pasarAPro() {
    setCargando(true);
    setErrorCheckout(null);
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const datos = (await res.json()) as { url?: string; error?: string };
      if (res.ok && datos.url) {
        window.location.href = datos.url;
        return;
      }
      if (res.status === 501 && datos.error) {
        setErrorCheckout(
          "El cobro con tarjeta aún no está activo en este entorno.",
        );
      } else {
        setErrorCheckout("No se pudo iniciar el pago.");
      }
    } catch {
      setErrorCheckout("No se pudo iniciar el pago.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {/* FREE */}
      <div className="flex flex-col rounded-[var(--radius-lg)] bg-surface p-6 sm:p-8">
        <h2 className="t-2">Gratis</h2>
        <p className="cifra-heroe mt-3 text-text">$0 MXN</p>
        <p className="mt-1 text-sm text-text-2">para siempre</p>

        <ListaBullets items={BULLETS_FREE} />

        <div className="mt-8">
          <Link href="/" className={BOTON_SECUNDARIO}>
            Generar mi día
          </Link>
        </div>
      </div>

      {/* PRO */}
      <div className="relative flex flex-col rounded-[var(--radius-lg)] border-t-2 border-t-brand bg-surface p-6 shadow-[var(--shadow-pop)] sm:p-8">
        <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-on-brand">
          Recomendado
        </span>
        <h2 className="t-2">Pro</h2>
        <p className="cifra-heroe mt-3 text-text">${PRECIO_PRO} MXN</p>
        <p className="mt-1 text-sm text-text-2">al mes</p>

        <ListaBullets items={BULLETS_PRO} />

        <div className="mt-8">
          {!autenticado ? (
            <Link href="/registro" className={BOTON_PRIMARIO}>
              Crear cuenta y pasar a Pro
            </Link>
          ) : tierActual === "PRO" ? (
            <span
              aria-disabled="true"
              className="flex h-13 min-h-13 w-full items-center justify-center rounded-[var(--radius)] bg-brand px-6 text-[17px] font-semibold text-on-brand opacity-60"
            >
              Ya eres Pro
            </span>
          ) : (
            <button
              type="button"
              onClick={pasarAPro}
              disabled={cargando}
              className={BOTON_PRIMARIO}
            >
              {cargando ? "Redirigiendo…" : "Pasar a Pro"}
            </button>
          )}
          {errorCheckout ? (
            <p className="mt-3 text-sm text-text-2">{errorCheckout}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
