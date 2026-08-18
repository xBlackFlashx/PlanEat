import { MS_LIMITE_GENERACION, VERSION_GENERADOR } from "@planeat/motor";

import { CATALOGO } from "@/lib/catalogo-servidor";
import { prisma } from "@/lib/prisma";

import { FormularioParametro } from "./formulario-parametro";

export const metadata = {
  title: "Parámetros",
};

export default async function PaginaParametros() {
  const parametros = await prisma.parametro.findMany({ orderBy: { clave: "asc" } });

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">Parámetros</h1>

      <section className="rounded-[var(--radius-lg)] bg-surface p-6">
        <h2 className="text-base font-semibold">Parámetros del motor (sólo lectura)</h2>
        <p className="mt-1 text-sm text-text-2">
          No son editables desde aquí. Cambian recompilando el catálogo (
          <code>npm run motor:catalogo</code>) o el motor mismo — una edición silenciosa de estas
          constantes desde un formulario se saltaría la batería de paridad Python↔TypeScript que
          hoy garantiza que ambos motores produzcan el mismo plan con el mismo seed.
        </p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr>
              <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                Constante
              </th>
              <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-b border-line px-3 py-2">VERSION_GENERADOR</td>
              <td className="border-b border-line px-3 py-2">{VERSION_GENERADOR}</td>
            </tr>
            <tr>
              <td className="border-b border-line px-3 py-2">MS_LIMITE_GENERACION</td>
              <td className="border-b border-line px-3 py-2">{MS_LIMITE_GENERACION}</td>
            </tr>
            <tr>
              <td className="border-b border-line px-3 py-2">Recetas en catálogo (CATALOGO.n)</td>
              <td className="border-b border-line px-3 py-2">{CATALOGO.n}</td>
            </tr>
            <tr>
              <td className="border-b border-line px-3 py-2">Versión del catálogo</td>
              <td className="border-b border-line px-3 py-2">{CATALOGO.version}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="rounded-[var(--radius-lg)] bg-surface p-6">
        <h2 className="text-base font-semibold">Parámetros de producto (editables)</h2>
        <p className="mt-1 text-sm text-text-2">
          Clave-valor de producto (textos, topes de exhibición) — no configuración del solver.
        </p>

        {parametros.length === 0 ? (
          <p className="mt-4 text-sm text-text-2">Todavía no hay parámetros de producto definidos.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                    Clave
                  </th>
                  <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                    Valor
                  </th>
                  <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                    Descripción
                  </th>
                </tr>
              </thead>
              <tbody>
                {parametros.map((p) => (
                  <tr key={p.clave}>
                    <td className="border-b border-line px-3 py-2">{p.clave}</td>
                    <td className="border-b border-line px-3 py-2">{p.valor}</td>
                    <td className="border-b border-line px-3 py-2">{p.descripcion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6">
          <FormularioParametro />
        </div>
      </section>
    </div>
  );
}
