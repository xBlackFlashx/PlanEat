import { prisma } from "@/lib/prisma";
import { tierEfectivo } from "@/lib/suscripcion";

import { CambiarTier } from "./cambiar-tier";

export const metadata = {
  title: "Usuarios",
};

export default async function PaginaUsuarios() {
  const usuarios = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { suscripcion: true },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>

      <div className="rounded-[var(--radius-lg)] bg-surface p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                  Correo
                </th>
                <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                  Nombre
                </th>
                <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                  Admin
                </th>
                <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                  Tier efectivo
                </th>
                <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                  Alta
                </th>
                <th className="border-b border-line px-3 py-2 text-left font-medium text-text-2">
                  Cambiar tier
                </th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td className="border-b border-line px-3 py-2">{u.email}</td>
                  <td className="border-b border-line px-3 py-2">{u.nombre ?? "—"}</td>
                  <td className="border-b border-line px-3 py-2">{u.esAdmin ? "sí" : "no"}</td>
                  <td className="border-b border-line px-3 py-2">{tierEfectivo(u.suscripcion)}</td>
                  <td className="border-b border-line px-3 py-2">
                    {u.createdAt.toLocaleDateString("es-MX")}
                  </td>
                  <td className="border-b border-line px-3 py-2">
                    <CambiarTier
                      userId={u.id}
                      tierActual={u.suscripcion?.tier ?? "FREE"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
