/**
 * Lunes de la semana ISO a la que pertenece `fecha`, a medianoche UTC.
 *
 * Es la clave con la que se guarda `PlanSemana`: "la semana del lunes X" es
 * estable independientemente de qué día de esa semana lo pida el usuario, así
 * que volver a `/semana` un miércoles enseña el mismo plan generado el lunes
 * en vez de uno nuevo.
 */
export function lunesDeLaSemana(fecha: Date): Date {
  const utc = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  const diaISO = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay(); // 1=lunes … 7=domingo
  utc.setUTCDate(utc.getUTCDate() - (diaISO - 1));
  return utc;
}
