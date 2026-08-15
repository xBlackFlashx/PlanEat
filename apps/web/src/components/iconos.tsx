/**
 * Iconos del flujo del generador.
 *
 * Una sola familia: trazo de 1,75 px, extremos redondeados, caja de 24, dibujo
 * a `currentColor`. Sin emoji: dependen de la fuente del sistema, no se pueden
 * teñir con un token y se ven distintos en cada plataforma.
 *
 * Todos son decorativos por defecto (`aria-hidden`): el significado lo lleva
 * siempre la palabra que va al lado. Ningún estado de este producto se comunica
 * sólo con un icono, ni sólo con un color.
 */

interface PropsIcono {
  /** Tamaño en píxeles. Los tamaños vivos son 16, 20 y 24. */
  tam?: number;
  className?: string;
}

function Svg({
  tam = 20,
  className,
  children,
}: PropsIcono & { children: React.ReactNode }) {
  return (
    <svg
      width={tam}
      height={tam}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Veredicto "Cuadra". Círculo con check. */
export function IconoCuadra(props: PropsIcono) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </Svg>
  );
}

/** Veredicto "Casi". Círculo medio relleno: distingue en escala de grises. */
export function IconoCasi(props: PropsIcono) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Veredicto "No cuadra". Círculo con línea horizontal. */
export function IconoNoCuadra(props: PropsIcono) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </Svg>
  );
}

export function IconoReloj(props: PropsIcono) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

export function IconoCerrar(props: PropsIcono) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

/** Acciones de un item, colapsadas en táctil. */
export function IconoMas(props: PropsIcono) {
  return (
    <Svg {...props}>
      <circle cx="5.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconoCambiar(props: PropsIcono) {
  return (
    <Svg {...props}>
      <path d="M3 8h13l-3.5-3.5M21 16H8l3.5 3.5" />
    </Svg>
  );
}

export function IconoFicha(props: PropsIcono) {
  return (
    <Svg {...props}>
      <path d="M5 4h14v16H5z" />
      <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
    </Svg>
  );
}

export function IconoAviso(props: PropsIcono) {
  return (
    <Svg {...props}>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.75" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconoFlecha(props: PropsIcono) {
  return (
    <Svg {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}
