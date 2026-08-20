# Resumen de sesión: despensa compartida + ficha de receta

Este documento existe porque el historial de esta conversación de Claude Code
vive local en la máquina donde corrió (no se sincroniza vía git) — es el
puente para que una sesión nueva de Claude Code, en otra máquina, pueda
retomar el hilo leyendo esto en vez de la conversación original.

## Pedido original del usuario

Menos ingredientes distintos por semana en el plan de comidas, priorizando
que las recetas compartan más ingredientes entre sí ("una despensa"), y
añadir a la ficha de cada receta una descripción de cómo se prepara.

## Qué se hizo, en orden

1. **Ronda 1-2 (antes de esta conversación, en la misma sesión):** subió
   `W_SOL` (peso del término "solape semanal" del scoring) de 1.2 → 2.0 → 3.2.
2. **Ronda 3 (despensa compartida + pasos de preparación):**
   - Se añadió un término estructural nuevo al scoring — "(h) ingredientes
     nuevos" — que penaliza el conteo ABSOLUTO de ingredientes no
     comprometidos que introduce una receta candidata (antes solo se premiaba
     la *fracción* ya cubierta, lo que trataba igual a una receta de 2
     ingredientes que a una de 10). Valores finales: `W_SOL=2.4`,
     `W_NUEVO=3.0`. Media de ingredientes/semana: 41.64 → 37.61 (-9.7%), tasa
     de "Cuadra" +4.5pp.
   - `panel-receta.tsx`: la ficha de receta ahora muestra cantidad por
     ingrediente y una sección "Preparación" con los pasos reales del
     catálogo (antes ausentes — el propio código tenía un descargo
     documentando el hueco).
   - Implementado con paridad exacta en `services/solver` (Python, fuente de
     verdad) y `packages/motor` (TypeScript, puerto).
3. **`plan-dia.tsx` (esta conversación):** la tarjeta de cada comida en el
   plan del día ahora abre el panel lateral de ficha al hacer click en
   cualquier punto de la fila, no solo en un icono aparte (que se quitó).
4. **Ronda 4 — bajar a 15-25 ingredientes/semana (esta conversación):**
   - Se investigó por qué el suelo estructural era ~37-38: con
     `MAX_USOS_RECETA_SEMANA=2` (máximo de veces que se repite una receta en
     la semana) hacen falta al menos 11 recetas distintas para cubrir 21
     comidas, y con ~4.5 ingredientes/receta eso empuja el suelo ahí aunque
     se comparta mucho.
   - Palanca que lo rompió: subir `MAX_USOS_RECETA_SEMANA` de 2 a 4 (menos
     recetas distintas necesarias) + ajustar `LAMBDA_INGREDIENTES` (etapa de
     composición semanal, de 0.006 a 0.12).
   - Medición final (40 semillas × 3 perfiles): media 19.85 ingredientes,
     mediana 19.0, **94.2% de las semanas cae dentro de [15,25]**. Sorpresa:
     tasa de "Cuadra" subió de 57.3% a 81.1%.
   - Contrapartida: las recetas se repiten hasta 4 veces por semana (antes
     máximo 2) — menos variedad de platillos a cambio de comprar mucho menos.
   - Verificado en el navegador real (`localhost:3999/semana`, sesión Pro):
     plan de 7 días con **18 ingredientes distintos**.

## Estado del repositorio

- Todo el trabajo (el de recetas de esta sesión + el resto del árbol que ya
  estaba pendiente de commitear desde antes: expansión de alérgenos,
  agrupación de compra, Prisma/auth/admin, y un proyecto de video en
  `videos/planeat-rediseno/`) está commiteado en la rama
  `worktree-stateful-crafting-stallman` y pusheado a GitHub.
- Pull Request abierto: **https://github.com/xBlackFlashx/PlanEat/pull/1**
  (contra `main`, sin mergear todavía — mergear es una decisión del usuario,
  no se hizo automáticamente).
- `node_modules/` y `services/solver/.venv/` se subieron también a petición
  explícita del usuario (normalmente van en `.gitignore` porque son pesados
  y se regeneran con `npm install` / creando el venv; si la máquina de
  destino tiene otro SO/arquitectura, los binarios nativos que traen podrían
  no funcionar ahí y habría que reinstalar de todos modos).
- El sitio NO está desplegado en ningún dominio público todavía. GitHub
  Pages no sirve para este proyecto (necesita servidor real: Postgres,
  Auth.js, Stripe) — el propio `SETUP.md` §7 lo documenta y da los pasos
  para desplegar en Vercel cuando el usuario quiera (requiere su cuenta de
  Vercel, no se puede hacer automáticamente).

## Archivos clave si hace falta seguir tocando esto

- `services/solver/app/solver/__init__.py` — constantes de scoring y límites
  (§2.2 fórmula, §5.1/§6.0 composición semanal).
- `services/solver/app/solver/scoring.py` / `packages/motor/src/scoring.ts`
  — fórmula de scoring, deben coincidir cifra a cifra (paridad).
- `services/solver/app/solver/semanal.py` / `packages/motor/src/semanal.ts`
  — composición semanal (`LAMBDA_INGREDIENTES`, `MAX_USOS_RECETA_SEMANA`).
- `services/solver/scripts/medir_*.py` — scripts de medición reutilizables
  para futuras rondas de ajuste (miden ingredientes/semana vs. tasa "Cuadra"
  de forma pareada).
- `apps/web/src/components/plan-dia.tsx` — tarjeta de comida, ahora clicable.
- `apps/web/src/components/panel-receta.tsx` — ficha de receta con pasos.
