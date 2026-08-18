import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Cliente Prisma, una sola instancia por proceso.
 *
 * En dev, `next dev` recarga módulos en caliente y cada recarga crearía un
 * pool de conexiones nuevo si no se cacheara en `globalThis` — el problema
 * clásico de "too many connections" que no aparece hasta que llevas un rato
 * editando. En producción (Vercel, una función por invocación) el `global`
 * no sobrevive entre invocaciones, así que ahí simplemente se crea una vez
 * por arranque de la función, que es lo correcto.
 */
const derivadoGlobal = globalThis as unknown as { prisma?: PrismaClient };

function crearCliente(): PrismaClient {
  const adaptador = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter: adaptador });
}

export const prisma: PrismaClient = derivadoGlobal.prisma ?? crearCliente();

if (process.env.NODE_ENV !== "production") derivadoGlobal.prisma = prisma;
