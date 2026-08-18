import { prisma } from "@/lib/prisma";
import { tierEfectivo } from "@/lib/suscripcion";

export const metadata = {
  title: "Resumen",
};

/**
 * Formatea un entero en es-MX, sin decimales de por medio. Se usa para todo
 * lo que es un conteo (usuarios, generaciones, pesos) para que no aparezca
 * como "1200" sino "1,200".
 */
const formatoEntero = new Intl.NumberFormat("es-MX");
const formatoMoneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  maximumFractionDigits: 0,
});

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[var(--radius-lg)] bg-surface p-6">{children}</div>;
}

function TarjetaStat({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <Panel>
      <p className="cifra-heroe">{valor}</p>
      <p className="mt-1 text-sm text-text-2">{etiqueta}</p>
    </Panel>
  );
}

export default async function PaginaAdmin() {
  const [
    totalGeneraciones,
    generacionesOk,
    porTier,
    tiempoMedio,
    dietasMasPedidas,
    totalUsuarios,
    suscripcionesProCandidatas,
  ] = await Promise.all([
    prisma.generacionPlan.count(),
    prisma.generacionPlan.count({ where: { ok: true } }),
    prisma.generacionPlan.groupBy({ by: ["tier"], _count: true }),
    prisma.generacionPlan.aggregate({ where: { ok: true }, _avg: { msTranscurridos: true } }),
    prisma.generacionPlan.groupBy({
      by: ["dieta"],
      _count: true,
      orderBy: { _count: { dieta: "desc" } },
      take: 5,
    }),
    prisma.user.count(),
    // Se filtra en JS con `tierEfectivo` (no sólo `tier: PRO` en el where) para
    // que este conteo sea EXACTAMENTE el mismo criterio que usa el resto de la
    // app para decidir quién es Pro de verdad — incluyendo el corte por
    // `finPeriodoActual` vencido que un `where` de Prisma no replica sin
    // duplicar esa lógica aquí.
    prisma.suscripcion.findMany({
      where: { tier: "PRO", estado: { in: ["activa", "en_gracia"] } },
    }),
  ]);

  const proActivos = suscripcionesProCandidatas.filter((s) => tierEfectivo(s) === "PRO").length;
  const precioPro = Number(process.env.NEXT_PUBLIC_PRECIO_PRO_MXN ?? 0);
  const ingresoEstimado = proActivos * precioPro;

  const tasaExito = totalGeneraciones > 0 ? generacionesOk / totalGeneraciones : null;
  const msMedios = tiempoMedio._avg.msTranscurridos;

  if (totalGeneraciones === 0) {
    return (
      <div className="flex flex-col gap-8">
        <h1 className="text-2xl font-semibold tracking-tight">Resumen</h1>
        <Panel>
          <p className="text-[15px] text-text-2">Aún no hay generaciones registradas.</p>
        </Panel>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <TarjetaStat etiqueta="Usuarios totales" valor={formatoEntero.format(totalUsuarios)} />
          <TarjetaStat etiqueta="Pro activos" valor={formatoEntero.format(proActivos)} />
          <TarjetaStat
            etiqueta="Ingreso mensual estimado"
            valor={formatoMoneda.format(ingresoEstimado)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">Resumen</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <TarjetaStat etiqueta="Generaciones totales" valor={formatoEntero.format(totalGeneraciones)} />
        <TarjetaStat
          etiqueta="Tasa de éxito"
          valor={tasaExito === null ? "—" : `${(tasaExito * 100).toFixed(1)}%`}
        />
        <TarjetaStat
          etiqueta="Tiempo medio (planes exitosos)"
          valor={msMedios === null ? "—" : `${formatoEntero.format(Math.round(msMedios))} ms`}
        />
        <TarjetaStat etiqueta="Usuarios totales" valor={formatoEntero.format(totalUsuarios)} />
        <TarjetaStat etiqueta="Pro activos" valor={formatoEntero.format(proActivos)} />
        <TarjetaStat
          etiqueta="Ingreso mensual estimado"
          valor={formatoMoneda.format(ingresoEstimado)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel>
          <h2 className="text-base font-semibold">Generaciones por tier</h2>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr>
                <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                  Tier
                </th>
                <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                  Generaciones
                </th>
              </tr>
            </thead>
            <tbody>
              {porTier.map((fila) => (
                <tr key={fila.tier}>
                  <td className="border-b border-line px-3 py-2">{fila.tier}</td>
                  <td className="border-b border-line px-3 py-2">
                    {formatoEntero.format(fila._count)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold">Dietas más pedidas</h2>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr>
                <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                  Dieta
                </th>
                <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                  Generaciones
                </th>
              </tr>
            </thead>
            <tbody>
              {dietasMasPedidas.map((fila) => (
                <tr key={fila.dieta}>
                  <td className="border-b border-line px-3 py-2">{fila.dieta}</td>
                  <td className="border-b border-line px-3 py-2">
                    {formatoEntero.format(fila._count)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <p className="text-xs text-text-2">
        El ingreso mensual estimado es {formatoMoneda.format(precioPro)} × Pro activos: una
        estimación a partir del precio de lista, no una cifra sincronizada con lo que Stripe
        factura realmente (prorrateos, descuentos y cambios de plan no se reflejan aquí).
      </p>
    </div>
  );
}
