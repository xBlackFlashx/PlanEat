import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Generaciones",
};

const TOPE = 100;

export default async function PaginaGeneraciones() {
  const generaciones = await prisma.generacionPlan.findMany({
    orderBy: { createdAt: "desc" },
    take: TOPE,
    include: { user: { select: { email: true } } },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Generaciones</h1>

      {generaciones.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] bg-surface p-6">
          <p className="text-[15px] text-text-2">Aún no hay generaciones registradas.</p>
        </div>
      ) : (
        <div className="rounded-[var(--radius-lg)] bg-surface p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                    Fecha
                  </th>
                  <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                    Usuario
                  </th>
                  <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                    Tier
                  </th>
                  <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                    Días
                  </th>
                  <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                    Dieta
                  </th>
                  <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                    Resultado
                  </th>
                  <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                    ms
                  </th>
                </tr>
              </thead>
              <tbody>
                {generaciones.map((g) => (
                  <tr key={g.id}>
                    <td className="border-b border-line px-3 py-2">
                      {g.createdAt.toLocaleDateString("es-MX", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      {g.user?.email ?? "anónimo"}
                    </td>
                    <td className="border-b border-line px-3 py-2">{g.tier}</td>
                    <td className="border-b border-line px-3 py-2">{g.dias}</td>
                    <td className="border-b border-line px-3 py-2">{g.dieta}</td>
                    <td className="border-b border-line px-3 py-2">
                      {g.ok ? (
                        "OK"
                      ) : (
                        <span className="text-danger">
                          {g.restriccionCulpable ?? "fallo sin restricción identificada"}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-line px-3 py-2">{g.msTranscurridos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-text-2">
            Últimas {TOPE}. Sin paginación todavía — con más volumen esta lista deja de ser
            representativa del histórico completo.
          </p>
        </div>
      )}
    </div>
  );
}
