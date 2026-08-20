import type { VistaRecetas } from "@planeat/motor";
import recetasVista from "@planeat/motor/recetas-vista";

const vista: VistaRecetas = recetasVista;

interface PropsPanelFotoAuth {
  /** Id de una receta real del catálogo, no una imagen de stock. */
  recetaId: string;
  frase: string;
}

/**
 * Columna de foto para `/entrar` y `/registro` — el mismo patrón de
 * "formulario + foto" que el resto del sitio ya usa (hero de `/`, hero de
 * `/precios`), aplicado a las dos páginas que hasta ahora eran sólo un
 * formulario sobre fondo plano. Oculto por debajo de `lg`: en móvil el
 * formulario ocupa toda la pantalla, como antes.
 */
export function PanelFotoAuth({ recetaId, frase }: PropsPanelFotoAuth) {
  const receta = vista.recetas[recetaId];
  if (!receta?.imagenUrl) return null;

  return (
    <div className="relative hidden overflow-hidden lg:block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={receta.imagenUrl}
        alt={receta.titulo}
        className="h-full w-full object-cover"
        loading="eager"
        fetchPriority="high"
      />
      {/* Velo de degradado: el texto de abajo necesita 4,5:1 sobre CUALQUIER
          foto, así que se apoya en `--on-brand` (blanco fijo) sobre negro
          real, no sobre un token de superficie que cambia con el tema. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(0deg,rgba(0,0,0,0.75)_0%,rgba(0,0,0,0.15)_45%,transparent_70%)]"
      />
      <p className="absolute inset-x-0 bottom-0 p-8 text-lg font-medium leading-snug text-pretty text-white">
        {frase}
      </p>
    </div>
  );
}
