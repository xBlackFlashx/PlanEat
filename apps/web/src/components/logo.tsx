/**
 * Logo de PlanEat — «La semana en el plato».
 *
 * Un plato (círculo de trazo) con siete puntos interiores en arco de 210°:
 * los cinco primeros en `var(--brand)` (días planificados), los dos últimos
 * en currentColor al 25% (días por venir). Todo lo demás hereda currentColor,
 * así que funciona en claro y oscuro sin lógica de tema.
 *
 * Uso: `<LogoPlanEat />` dentro del enlace/etiqueta de cabecera existente
 * (el wordmark hereda la tipografía del contenedor — Geist 600, no Poppins).
 * `conTexto={false}` deja sólo el símbolo (favicon, cabecera Admin).
 */

// 7 puntos sobre radio 6, ángulos de -195° a 15° (paso 35°). Precalculados
// para que el SVG sea estático y legible; los 5 primeros son «planificados».
const PUNTOS: ReadonlyArray<readonly [number, number]> = [
  [6.2, 13.55],
  [6.36, 9.95],
  [8.56, 7.09],
  [12, 6],
  [15.44, 7.09],
  [17.64, 9.95],
  [17.8, 13.55],
];

const PLANIFICADOS = 5;

export function LogoPlanEat({
  tam = 24,
  conTexto = true,
  className,
}: {
  tam?: number;
  conTexto?: boolean;
  className?: string;
}) {
  const svg = (
    <svg
      width={tam}
      height={tam}
      viewBox="0 0 24 24"
      fill="none"
      {...(conTexto
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": "PlanEat" })}
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      {PUNTOS.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r="1.6"
          fill={
            i < PLANIFICADOS
              ? "var(--brand)"
              : "color-mix(in oklab, currentColor 25%, transparent)"
          }
        />
      ))}
    </svg>
  );

  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`.trim()}>
      {svg}
      {conTexto && <span>PlanEat</span>}
    </span>
  );
}
