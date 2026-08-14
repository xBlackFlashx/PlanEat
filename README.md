# PlanEat

Planes de comida que cuadran con tus objetivos, tu presupuesto y lo que ya tienes
en casa.

La diferencia con un contador de calorías es la dirección temporal: un tracker es
descriptivo y a posteriori (registras y descubres si fallaste); PlanEat es
prescriptivo y a priori (el plan se construye de forma que los objetivos se
cumplen por diseño).

## Estado

**Esqueleto.** El proyecto arranca y compila; el motor de generación todavía no
está implementado — es la fase 1 del roadmap.

Ya funciona:

- Cálculo de objetivos nutricionales (Mifflin-St Jeor → macros con holgura)
- Sistema de diseño con tokens, tema claro/oscuro y primitivas de dominio
- Contrato HTTP del solver, estable y documentado

## Estructura

```
apps/web           Next.js 16 · TypeScript · Tailwind 4
packages/shared    Tipos de dominio y lógica nutricional pura
services/solver    FastAPI · el motor de generación (Python)
docs/spec.md       Especificación completa del producto
```

El solver vive aparte a propósito. Las razones están en `docs/spec.md` §8.2; la
corta es que el ecosistema de optimización numérica de Python no tiene
equivalente en JavaScript, y que un servicio CPU-bound y una API I/O-bound no
deben escalar juntos.

## Arranque

Requisitos: Node ≥ 20, Python ≥ 3.11 (sólo para el solver).

```bash
npm install
npm run dev            # http://localhost:3000
```

Rutas útiles:

- `/` — portada
- `/sistema` — referencia viva del sistema de diseño

Para el solver:

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
| `npm run build` | Build de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript en todos los paquetes |
| `npm run solver:test` | Tests del solver |

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

## Aviso

Los cálculos nutricionales son estimaciones poblacionales, no consejo médico.
Antes de exponerlos en producto hay que resolver el descargo de responsabilidad
y las implicaciones regulatorias — `docs/spec.md` §11.
