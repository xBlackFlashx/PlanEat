import type { Suscripcion } from "@/generated/prisma/client";

/**
 * El tier que de verdad cuenta para dar o negar acceso.
 *
 * No es `suscripcion.tier` a secas: Stripe puede tardar hasta que el webhook
 * marca `estado: cancelada` tras un impago, y mientras tanto el campo `tier`
 * seguiría en PRO. Un usuario es Pro sólo si además el periodo pagado no ha
 * vencido — es la misma comprobación que hace el propio Stripe Billing
 * Portal, replicada aquí porque la puerta de `/semana` y del checkout la
 * necesitan sin ida y vuelta a la API de Stripe en cada request.
 */
export function tierEfectivo(suscripcion: Suscripcion | null | undefined): "FREE" | "PRO" {
  if (!suscripcion) return "FREE";
  if (suscripcion.tier !== "PRO") return "FREE";
  if (suscripcion.estado !== "activa" && suscripcion.estado !== "en_gracia") return "FREE";
  if (suscripcion.finPeriodoActual && suscripcion.finPeriodoActual.getTime() < Date.now()) {
    return "FREE";
  }
  return "PRO";
}
