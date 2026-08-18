# PlanEat

Planes de comida que cuadran con tus objetivos, tu presupuesto y lo que ya tienes
en casa.

La diferencia con un contador de calorías es la dirección temporal: un tracker es
descriptivo y a posteriori (registras y descubres si fallaste); PlanEat es
prescriptivo y a priori (el plan se construye de forma que los objetivos se
cumplen por diseño).

El día suelto es gratis y sigue generándose en tu navegador, sin cuenta: el
motor corre en un Web Worker y el catálogo (91 recetas) viaja en el bundle. El
plan Pro semanal sí necesita servidor — cuentas, Stripe y el panel de admin no
existen sin uno — y por eso `apps/web` dejó de ser un export estático: se
despliega en Vercel. Ver SETUP.md para levantar la parte con servidor en local.

## Estado

El motor de generación funciona: selecciona recetas, calcula las raciones que
cuadran el día, repara lo que no cuadra y ensambla la semana acortando la lista
de la compra (el término de solape semanal, §2.2d, favorece recetas que
comparten ingredientes con lo que ya lleva la semana). Un día de tres comidas
sale en ~40 ms.

Lo que ya existe: cuentas (Auth.js + Postgres), plan Pro semanal server-side con
lista de la compra agregada, cobro con Stripe (checkout + webhook, en modo
prueba hasta que se configuren las llaves — ver SETUP.md) y un panel de
administración con estadísticas reales.

Lo que **no** hay todavía: exportar la lista de la compra a PDF/imagen, batch
cooking, y un catálogo de tamaño real. Son 91 recetas: suficiente para validar
el algoritmo y el producto, corto para vivir de ello.

## Dos motores, uno de ellos es la referencia

El algoritmo existe dos veces, a propósito:

| | `services/solver` | `packages/motor` |
|---|---|---|
| Lenguaje | Python | TypeScript |
| Dónde corre | Servidor (FastAPI) | Navegador (Web Worker) |
| Porcionado | HiGHS (símplex) | Descenso coordinado sobre la rejilla |
| Aleatoriedad | numpy PCG64 | SplitMix64 + xoshiro256++ |
| Papel | **Referencia** | Producción |

El Python es la fuente de verdad del algoritmo y el que se toca primero cuando
el algoritmo cambia. El TypeScript es el que se despliega, porque ni HiGHS ni
numpy existen en un navegador y sin ellos no hay demo que enseñar.

Que no diverjan no es un acto de fe: `services/solver/scripts/volcar_paridad.py`
vuelca 2.576 casos de funciones puras y 2.171 instancias del porcionador
resueltas con HiGHS, y la batería de TypeScript los compara. Las funciones
portadas literalmente se exigen **bit a bit**; el porcionador se exige por
calidad de la solución, no por igualdad del vértice —son dos heurísticas sobre
la misma rejilla finita, y la del navegador optimiza directamente la magnitud
que se devuelve—. Sobre las 2.171 instancias, p95(E_ts − E_py) = 0.

Lo que **no** se promete, y está escrito en `packages/motor/REPRODUCIBILIDAD.md`:
que un plan generado en Python se reproduzca en el navegador. El RNG es otro por
decisión explícita. La promesa que sí se sostiene es «mismo seed en el navegador,
mismo plan», y es la que hace que un enlace con semilla sea compartible.

Las diferencias deliberadas entre los dos, con el test que fija cada una, están
en `packages/motor/DIVERGENCIAS.md`.

## Estructura

```
apps/web           Next.js 16 · TypeScript · Tailwind 4 · servidor real (Vercel)
packages/shared    Tipos de dominio y lógica nutricional pura
packages/motor     El motor portado. Cero dependencias, corre en el navegador
services/solver    FastAPI · el motor de referencia (Python)
docs/spec.md       Especificación completa del producto
```

## Arranque

Requisitos: Node ≥ 22.18 (ejecuta TypeScript sin compilar; la batería de tests
depende de ello), Postgres local, Python ≥ 3.11 sólo si vas a tocar el solver de
referencia. La parte con cuentas/Pro/admin necesita variables de entorno —
**ver SETUP.md antes del primer arranque**, ahí está el paso a paso completo
(Postgres, migraciones, siembra del admin, Stripe).

```bash
npm install
npm run dev            # http://localhost:3000
```

Rutas:

- `/` — portada y generador gratis (un día, sin cuenta)
- `/plan` — un día, con el perfil en la query. La semilla también viaja ahí: el
  mismo enlace devuelve el mismo plan
- `/sistema` — referencia viva del sistema de diseño
- `/precios` — comparación Gratis / Pro
- `/entrar`, `/registro` — cuenta (sólo hace falta para Pro)
- `/semana` — plan Pro de 7 días + lista de la compra (requiere cuenta Pro)
- `/admin` — panel de administración (requiere el usuario sembrado como admin)

Para el solver de referencia:

```bash
cd services/solver
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000   # /docs para el contrato
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción + verificación del bundle |
| `npm test` | Batería del motor portado + la de `apps/web` (lista de la compra, etc.) |
| `npm run typecheck` | TypeScript en los tres paquetes |
| `npm run lint` | ESLint |
| `npm run motor:catalogo` | Recompila el catálogo a JSON columnar |
| `npm run solver:test` | Tests del solver de referencia |

Dentro de `apps/web`, además: `npm run db:generar` (regenera el cliente Prisma),
`npm run db:migrar` (`prisma migrate dev`, interactivo — para producción se usa
`prisma migrate deploy`), `npm run db:seed` (siembra el usuario admin desde
`ADMIN_EMAIL`/`ADMIN_PASSWORD`).

El volcado de paridad pesa ~7 MB y está fuera del repositorio. Sin él, los 14
tests que lo consumen **se saltan** en vez de fallar. Para ejecutarlos:

```bash
cd services/solver && source .venv/bin/activate && python scripts/volcar_paridad.py
```

`.github/workflows/ci.yml` lo regenera antes de `npm test`, así que en CI la
paridad sí se comprueba de verdad. CI ya no despliega — Vercel construye y
publica al conectar el repositorio; ver SETUP.md.

## Por qué el bundler es webpack y no Turbopack

`next dev` y `next build` llevan `--webpack` a propósito: **Turbopack no
empaqueta Web Workers** (Next 16.3.1). Ante `new Worker(new URL(...))` copia el
fuente sin transpilar a `_next/static/media/` y el build sale en verde con un
worker muerto que sólo falla en el navegador del usuario.
`apps/web/herramientas/verificar-build.mjs` corre tras cada build para que eso
no vuelva a colarse.

## Decisiones ya tomadas

Documentadas en `docs/decisiones-de-diseno.md` y en la especificación:

- **Sin app nativa en el MVP.** Web responsive instalable. La app cuesta 3-4
  meses y añade comisiones del 15-30 % antes de saber si el producto funciona.
- **Las recetas se producen, no se extraen.** No existe fuente libre y
  comercialmente usable de recetas de calidad, y el scraping tiene riesgo legal
  real en la UE (derecho *sui generis* de bases de datos).
- **Datos nutricionales de fuentes con licencia comercial verificada.** La capa
  queda aislada tras una interfaz para poder cambiar de proveedor sin refactorizar.
- **Modo oscuro desde el día 1.** Se usa en la cocina y de noche; añadirlo
  después cuesta el triple.
- **Si el motor no puede, la interfaz lo dice.** No se genera un plan de mentira
  ni se rellena con datos de ejemplo. Un producto de nutrición que enseña
  números falsos cuando falla pierde lo único que vende.

## Aviso

Los cálculos nutricionales son estimaciones poblacionales, no consejo médico.
Ninguna de las 91 recetas del catálogo está revisada por un dietista, y la
interfaz lo dice en cada ficha. Antes de exponer esto como producto hay que
resolver el descargo de responsabilidad y las implicaciones regulatorias —
`docs/spec.md` §11.
