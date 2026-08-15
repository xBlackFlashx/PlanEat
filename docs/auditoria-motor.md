# Anexo: auditoría del motor Python

Informes completos de los siete auditores. Es material de referencia para el
port: contiene el detalle línea a línea que la especificación resume.

---

# constantes-motor

He leído completos `app/solver/__init__.py` (201 líneas) y `app/solver/motor.py` (323), más las secciones 1, 2 y 6 de `DISENO.md`. Aviso de encuadre: **la etapa A no está en `motor.py`**. `motor.py` es solo el orquestador (validar → macros incompatibles → 3 puertas de pool → A/B/C/D → umbral de honestidad → serializar). La etapa A real vive en `scoring.py` (`score_slot`, `muestrear`, `seleccionar_dia`, `sigma_sugerido`, `contexto_de`, `cuotas_de`, `orden_de_slots`) y se invoca desde `reparacion.generar_candidato_dia`. He leído también esos dos ficheros y `semanal.py` para poder documentar el árbol de RNG completo, que era el punto crítico pedido.
El módulo `__init__.py` es puro `constantes.py` más dos funciones: `rng_de` (árbol de SeedSequence/PCG64) y `temperatura` (mapa geométrico variedad→τ). No importa a ningún submódulo, así que en TS es un `constantes.ts` sin ciclos.
El orden de las cuatro tuplas de vocabulario NO es cosmético: es el orden de columnas de todas las matrices del catálogo (`nutr`, `conocido`, `m_dieta`, `m_alergeno`, `m_slot`) y, en el caso de `SLOTS`, además es el último componente de la ruta del RNG. Cambiar `SLOTS` cambia los planes generados con el mismo seed.
El consumo de aleatoriedad es sorprendentemente pequeño y muy fácil de portar: **un único sorteo categórico por nodo del árbol** en la etapa A/C (`rng.choice(n, p)`), y un único flujo secuencial en la etapa D con `integers` y `random`. La interfaz que el RNG de TS debe ofrecer son tres métodos.
Lo que numpy hace y en TS hay que escribir a mano: broadcasting sobre (P,), máscaras booleanas, matvec (P,3)·(3,), `arccos`/`clip`/`where` anidados, `bitwise_count` (popcount) sobre uint64, `argpartition` para el umbral del top-K, orden estable por clave compuesta `(-score, str(id))`, `std` poblacional (ddof=0) y aritmética float32.
Lo que NO puedo afirmar sin verificar contra el código fuente de numpy: la secuencia exacta de bits de `SeedSequence`, `PCG64` y de los algoritmos de `Generator.integers`/`Generator.choice`. Lo señalo explícitamente en riesgos: la equivalencia bit a bit con Python no la doy por conseguible sin ese trabajo, y probablemente no merece la pena.

## Vocabulario: las cuatro tuplas y por qué el orden es contrato, no estilo

Las cuatro tuplas de `__init__.py` definen el orden de columnas de todas las matrices del catálogo. El comentario de cabecera es explícito: «el orden de estas tuplas ES el orden de las columnas de todas las máscaras del catálogo. Cambiarlo invalida cualquier catálogo cacheado».

**`NUTRIENTES` (6)** — `("kcal", "proteina", "carbohidrato", "grasa", "fibra", "sodio")`.
Índices exportados como constantes sueltas: `IDX_KCAL, IDX_PROT, IDX_CARB, IDX_GRASA, IDX_FIBRA, IDX_SODIO = range(6)` (0..5), más el diccionario `IDX_NUTRIENTE`.
Es el orden de columnas de `cat.nutr (N,6) float32` y `cat.conocido (N,6) bool`, del vector `residuo`/`objetivo_vec` de 6 posiciones, de `activos (6,) bool`, de `res.totales (6,)` y del orden de iteración de `PESOS_LP`.
Dependencia estructural no evidente: `vector_macro()` hace `residuo[1:4]` para extraer (P, C, G). Ese *slice* solo es correcto porque proteína/carbohidrato/grasa son exactamente las posiciones 1,2,3 y son contiguas. En TS conviene mantener el mismo layout y **no** sustituirlo por un objeto con claves: hay aritmética vectorial sobre las 6 posiciones a la vez (`residuo -= sigma * nutr[j]`).
Otra dependencia: `IDX_..., = range(6)` codifica el 6 a mano; en TS hay que derivarlo de `NUTRIENTES.length` o dejar un assert.

**`DIETAS` (6)** — `("omnivora", "vegetariana", "vegana", "pescetariana", "baja_en_carbohidratos", "mediterranea")`. Orden de columnas de `cat.m_dieta (N,6) bool`. Coincide exactamente con el `Literal TipoDieta` de `app/schemas.py:15-22` y debe coincidir con `packages/shared/src/types.ts`.

**`ALERGENOS` (14)** — `("gluten", "crustaceos", "huevos", "pescado", "cacahuetes", "soja", "lacteos", "frutos_de_cascara", "apio", "mostaza", "sesamo", "sulfitos", "altramuces", "moluscos")`. Orden de columnas de `cat.m_alergeno (N,14) bool`. Son los 14 alérgenos del anexo II del Reglamento UE 1169/2011 en su orden oficial. Coincide con `Alergeno` en `schemas.py:24-39`.
Además del layout, el orden importa para el determinismo del diagnóstico: la ablación *leave-one-out* de §6.1 desempata «por el orden fijo de `mascaras`» (DISENO.md:1036), y ese diccionario se construye recorriendo `ALERGENOS`. Reordenar la tupla cambia qué restricción se declara culpable en un empate.

**`SLOTS` (5)** — `("desayuno", "almuerzo", "comida", "merienda", "cena")`. Orden **cronológico**, no de importancia. `IDX_SLOT = {desayuno:0, almuerzo:1, comida:2, merienda:3, cena:4}`.
Este es el orden con más consecuencias, por tres usos distintos:
1. Columnas de `cat.m_slot (N,5) bool`.
2. Desempate del orden de recorrido de la etapa A: `orden_de_slots` ordena por `(-PESO_SLOT[s], IDX_SLOT[s])`. Con `almuerzo` y `merienda` empatados a 0,10, el desempate por índice pone almuerzo (1) antes que merienda (3).
3. **Último componente de la ruta del árbol de RNG**: `rng_de(seed, RUTA_A, dia, k_cand, intento, IDX_SLOT[slot])`. Cambiar el orden de `SLOTS` cambia el nodo del árbol de cada slot y por tanto **cambia el plan generado con el mismo seed**. Es la razón más fuerte para congelar esta tupla.
4. Orden de presentación: `_dia_a_contrato` reordena las comidas del candidato con `sorted(..., key=lambda p: IDX_SLOT[cand.slots[p]])` (motor.py:169), porque `CandidatoDia.slots` va en orden de *selección* (cuota descendente), no cronológico.

Para el port: definir las cuatro como `as const` en TS y derivar los `IDX_*` con un `Object.fromEntries(...)` o, mejor, con constantes numéricas literales para que el compilador las inline. Añadir un test que compare las cuatro tuplas con las del catálogo serializado (el catálogo lleva `version = sha256(fichero)[:16]`, DISENO.md:74).

Referencias: `services/solver/app/solver/__init__.py:16-61`, `services/solver/app/solver/__init__.py:29-30`, `services/solver/app/solver/scoring.py:294`, `services/solver/app/solver/scoring.py:224`, `services/solver/app/solver/reparacion.py:161`, `services/solver/app/solver/reparacion.py:221`, `services/solver/app/solver/motor.py:169`, `services/solver/DISENO.md:82-120`, `services/solver/DISENO.md:1036`, `services/solver/app/schemas.py:15-39`

## Constantes de `__init__.py`: valores, uso y cuáles no se pueden tocar

Todas viven en `__init__.py` a propósito (hace de `constantes.py`) y cada una cita su sección de DISENO.md. La cabecera del fichero impone una regla operativa que hay que replicar en TS: **si cambias una constante, cambia `VERSION_GENERADOR`**, porque si no un plan guardado deja de ser reproducible y el bug es indepurable.

**Etapa A — selección**
- `PESO_SLOT = {desayuno:0.22, almuerzo:0.10, comida:0.35, merienda:0.10, cena:0.28}`. Suman 1,00. Convención de producto (patrón mediterráneo, comida como ingesta principal), **no** un dato nutricional. Se renormalizan al subconjunto pedido en `cuotas_de`.
- `W_FIT=4.0, W_ESC=2.0, W_DESP=1.5, W_SOL=1.2, W_AFIN=0.0`; `W_COST=1.5, W_REP=2.0`.
  Ojo: DISENO.md §2.2 escribe la fórmula con `0,8·φ_afin` y da rango `S ∈ [-3,5 ; 9,5]`, pero el código fija `W_AFIN = 0.0` porque afinidad no existe en el contrato (`food_preference` es v1, §2.2g). El rango real de S es **[-3,5 ; 8,7]**. Portar el 0.0, no el 0.8.
- `DECAIMIENTO_REPETICION = 0.85` (por día; ~3 % residual a 21 días, la ventana de la spec).
- `FRACCION_MINIMA_PRECIOS = 0.80`. Si menos del 80 % del pool tiene precio conocido, el término de coste se apaga entero (peso 0) y se anota en la traza.
- `TOP_K = 25`, `TAU_MIN = 0.12`, `TAU_MAX = 1.5`, `VARIEDAD_POR_DEFECTO = 45`.

**Etapa B — porcionado** (fuera de mi ámbito, pero necesarias para el módulo de constantes)
- `PESOS_LP` = dict nutriente → (peso del exceso, peso del defecto): kcal (3,0 / 3,0), proteína (1,0 / **2,5**, asimetría deliberada: pasarse no daña, quedarse corto sí), carbohidrato (1,0/1,0), grasa (1,0/1,0), fibra (0,0/0,5), sodio (0,3/0,0). El orden de las claves debe seguir `NUTRIENTES`.
- `EPS_REG = 1e-3` (rompe la degeneración del LP), `UMBRAL_ERROR_OK = 0.04`, `UMBRAL_ERROR_ACEPTABLE = 0.12`, `PASO_RACION = 0.05`, `ESCALA_MIN_POR_DEFECTO = 0.6`, `ESCALA_MAX_POR_DEFECTO = 1.8`, `INF_HIGHS = 1.0e30`, `LIMITE_TIEMPO_LP_S = 0.05`.

**Etapa C — reparación**: `MAX_INTENTOS_REPARACION = 3`, `FACTOR_TEMPERATURA_REINTENTO = 0.25`.

**Etapa D — semanal**: `K_CANDIDATOS_DIA = 6`, `LAMBDA_INGREDIENTES = 0.006`, `MU_PRESUPUESTO = 0.30`, `NU_REPETICION = 0.05`, `MAX_USOS_RECETA_SEMANA = 2` (restricción **dura**, no penalización), `SA_T0 = 0.05`, `SA_ALFA = 0.994`, `SA_ITERACIONES = 400`.

**Diagnóstico**: `MIN_POOL = 40`, `MIN_CANDIDATOS_SLOT_DIA = 3`, `MIN_CANDIDATOS_SLOT_SEMANA = 8`, `FRACCION_POOL_ATRIBUIBLE = 0.5`, `TTL_CACHE_POOL_S = 3600`, `TAM_CACHE_POOL = 256`, `N_SUGERENCIAS = 3`, `KCAL_MINIMAS = {hombre:1500, mujer:1200}`, `KCAL_MINIMAS_ABSOLUTO = 1200`, `FRACCION_MINIMA_FIBRA = 0.80`.

**Reproducibilidad**: `RUTA_A, RUTA_D, RUTA_DESEMPATE = 0, 1, 2`; `VERSION_GENERADOR = "1.0.0"`.

Detalle a no copiar: `__all__ = [n for n in dir() if n.isupper() or n.startswith(("IDX_", "PESO"))]` — truco de introspección sin equivalente ni necesidad en TS (basta `export const`).
Otro detalle: la anotación de retorno de `rng_de` es `np.random.Generator` con `np` importado **dentro** de la función; funciona por `from __future__ import annotations` y lleva `# noqa: F821`. En TS desaparece.

Las tres puertas de §6.0 se implementan en `motor.py:249-262`, y el umbral por slot lo calcula `_min_candidatos_slot(n_dias)`: si `n_dias <= 1` devuelve 3; si no, `holgura = 8 - ceil(7/2) = 4` y devuelve `min(8, ceil(n_dias/2) + 4)` (n_dias=3 → 6; n_dias=7 → 8). Puerta 1: algún slot con `< min_slot` candidatos. Puerta 2: `|P| < 40 AND |P| < 0,5·N`. Puerta 3: `|P| < 40` pero `|P| >= 0,5·N` → **se genera igual** y se marca `traza.catalogo_estrecho`. Esta puerta 3 es la que hace utilizable el catálogo semilla de 36 recetas; sin ella el servicio rechazaría el 100 % de las peticiones.

Referencias: `services/solver/app/solver/__init__.py:63-171`, `services/solver/app/solver/__init__.py:173`, `services/solver/app/solver/motor.py:129-144`, `services/solver/app/solver/motor.py:249-262`, `services/solver/DISENO.md:220-236`, `services/solver/DISENO.md:968-1011`

## Etapa A (selección): algoritmo paso a paso y estructuras de datos

La etapa A **no está en motor.py**. `motor.py` solo construye el contexto (`contexto_de(cat, pool, restr, n_dias, temperatura(VARIEDAD_POR_DEFECTO))`, línea 265) y llama a `generar_candidatos`. La cadena real es:
`motor.generar` → `semanal.generar_candidatos` (bucle días × K) → `reparacion.generar_candidato_dia` (A+B+C de un día) → `scoring.seleccionar_dia` (etapa A pura) → por cada slot `scoring.score_slot` + `scoring.muestrear`.

**Estructuras de datos**

`Pool` (`scoring.py:49-77`) — *struct of arrays* con P filas (copia contigua de las filas del catálogo que pasan los filtros duros; se materializa una vez por petición, no se indexa el catálogo en cada slot):
`idx (P,) int32` · `mapa_fila (N,) int32` (fila del catálogo → posición en pool, o −1) · `ids (P,) str` · `nutr (P,6) float32` · `conocido (P,6) bool` · `v_macro (P,3) float32` (norma L2 = 1) · `tiene_macro (P,) bool` · `escala_min/escala_max (P,) float32` · `m_slot (P,5) bool` · `minutos (P,) int16` · `bits (P,W) uint64` · `n_ingr (P,) int16` · `coste_cents (P,) int32` · `coste_conocido (P,) bool`. Propiedad `p = idx.shape[0]`.

`Contexto` (`scoring.py:188-208`) — lo que no cambia dentro de un día:
`cuota: dict[slot,float]` · `topes: dict[slot,int]` · `bits_despensa (W,) uint64` · `bits_semana (W,) uint64` (acumulador de la etapa D, ceros el primer día) · `pen_rep (P,) float32` · `peso_coste: float` · `umbral_coste: float` · `tau: float` · `coste_desactivado_por: str|None` · `veto_semana (P,) bool|None` · `veto_slot: dict[slot,int]` (fila de ayer en ese slot).
Ojo: `Contexto` es **mutable** y `generar_candidatos` lo muta entre días (`ctx.veto_semana`, `ctx.bits_semana`, `ctx.veto_slot`). No es un objeto congelado.

**Paso 0 — pool** (`construir_pool`, `scoring.py:145-180`). Nivel 1 cacheado por `(version, dieta, alergenos_ordenados, tope_global)`: `m = m_dieta[:,idx_dieta]`, luego `m &= ~m_alergeno[:,a]` por cada alérgeno excluido, luego `m &= minutos <= tope_global` donde `tope_global = max(topes[s] for s in restr.slots)` (cota **laxa**: el tope de minutos es POR SLOT y se aplica dentro de `score_slot`, no aquí; confundirlo es el bug clásico de «filtrar el pool entero por el límite del desayuno y quedarse sin cenas»). Nivel 2 sin cachear: `bitwise_count(ingr_bits[idx] & bits_excluidos).sum(axis=1) == 0`. `SIN_LIMITE_MINUTOS = 32767`.

**Paso 1 — cuotas** (`cuotas_de`, `scoring.py:211-214`): `cuota[s] = PESO_SLOT[s] / sum(PESO_SLOT[t] for t in slots)`. Nota: la suma recorre la lista `slots` sin deduplicar, mientras que `orden_de_slots` sí hace `set(slots)`; con slots duplicados en la petición las cuotas quedarían infladas.

**Paso 2 — orden de recorrido** (`orden_de_slots`, `scoring.py:217-224`): `sorted(set(slots), key=lambda s: (-PESO_SLOT[s], IDX_SLOT[s]))`. Con los 5 slots: **comida (0,35) → cena (0,28) → desayuno (0,22) → almuerzo (0,10) → merienda (0,10)**. Los slots grandes eligen primero porque consumen la mayor parte del presupuesto nutricional. Como el orden se deriva aquí, el orden en que la petición liste los slots no afecta al plan.

**Paso 3 — bucle de slots** (`seleccionar_dia`, `scoring.py:453-485`):
```
residuo = objetivo_vec.copy()          # float64, 6 posiciones
excl    = zeros(P, bool); excl[vetadas] = True
para slot en orden_de_slots(slots):
    s = score_slot(pool, ctx, slot, residuo, excl)     # (P,) float32, -inf en lo inadmisible
    j = muestrear(s, pool.ids, tau, rng_por_slot(slot))
    si j es None: return None                          # slot sin candidatos -> día imposible
    elegidas[slot] = j
    excl[j] = True                                     # sin repetir receta dentro del día
    residuo -= sigma_sugerido(pool, j, residuo, cuota[slot]) * nutr[j]
```
`objetivo_vec` lo produce `vector_objetivo` (`reparacion.py:66-83`): `[kcal, (protMin+protMax)/2, (carbMin+carbMax)/2, (grasaMin+grasaMax)/2, fibraMinG||0, sodioMaxMg||0]`. La etapa A solo necesita la *dirección*; el cuadre contra los extremos de banda lo hace el LP.

**`sigma_sugerido`** (`scoring.py:439-450`): `eta = max(residuo[KCAL],0)*cuota/kcal_r`; devuelve `clip(eta, escala_min[j], escala_max[j])`; si `kcal_r <= 0` devuelve 1,0. Se usa dos veces: para restar la ración *real* del residuo (restar 1,0 dejaría un residuo inflado y los slots siguientes se elegirían contra un objetivo falso) y como σ_ref del desempate del LP.

**Paso 4 — `score_slot` término a término** (`scoring.py:306-386`). Devuelve `(P,) float32` con `-inf` donde no es admisible.

*Admisibilidad*: `admisible = m_slot[:,IDX_SLOT[slot]] & ~excluidas`, luego `&= minutos <= topes[slot]`.
Después, vetos duros de variedad **que ceden**: `estricto = admisible.copy()`; `estricto &= ~veto_semana` (si existe); `estricto[veto_ayer] = False` (si existe); **`if estricto.any(): admisible = estricto`**. Es decir, los vetos solo se aplican si dejan algo que elegir. Es la única restricción del servicio que cede, y cede porque no es de seguridad: una repetición de más es mejor que un fallo.

*(a) `fit` — encaje composicional, distancia angular*:
`v_res = vector_macro(residuo)`: `macros = max(residuo[1:4], 0)`; `kcal = [4,4,9]*macros`; si `sum <= 0` → vector nulo; si no `frac = kcal/sum`, `v = frac/‖frac‖₂` (float32).
Si `v_res` es no nulo: `cos = v_macro @ v_res` (matvec (P,3)·(3,)); `fit = 1 - (2/π)·arccos(clip(cos,-1,1))`; `fit = where(tiene_macro, fit, 0.5)`.
Si `v_res` es nulo (día ya cubierto): `fit = 0.5` para todo el pool.
Por qué angular y no coseno crudo: ambos vectores viven en el octante no negativo y sus componentes suman ~1 antes de normalizar, así que el coseno se comprime contra 1 (mediana medida 0,946, desv. 0,064) y casi no discrimina; la transformación angular multiplica la dispersión por 1,66 (mediana 0,789, desv. 0,106) y hace que el orden del top-k deje de depender del ruido de float32.

*(b) `esc` — encaje de escala, cociente no resta*:
`kcal_r = max(nutr[:,KCAL], 1e-6)`; `eta = max(residuo[KCAL],0)*cuota[slot] / kcal_r`;
`esc = where(eta < escala_min, eta/max(escala_min,1e-6), where(eta > escala_max, escala_max/max(eta,1e-6), 1.0))`.
Cae siempre en (0,1] y penaliza igual «necesito la mitad» que «necesito el doble». La fórmula de la spec (`1-|clamp-needed|`) se descarta a propósito: mezcla unidades y castiga a las recetas ligeras.

*(c) `desp` — despensa*: `popcount(bits & bits_despensa).sum(axis=1) / max(n_ingr,1)`. Es cobertura, no cuenta absoluta. La ponderación por urgencia de caducidad de la spec **no es computable** con el contrato actual (`despensaAlimentoIds` no trae `expiresOn`) y se deja como gancho documentado.

*(d) `sol` — solape semanal*: `popcount(bits & bits_semana).sum(axis=1) / max(n_ingr,1)`. **Cobertura, no Jaccard**: Jaccard divide por la unión, que crece con los días ya planificados, y hacia el viernes el término se apaga solo.

*(e) `cost`*: si `peso_coste > 0`: `b = max(umbral_coste, 1e-6)`; `cost = clip((coste_cents - b)/b, 0, 1)`. Si no, ceros. `umbral_coste = presupuestoSemanalCents / (n_dias · |slots| · max(1,comensales))` calculado en `contexto_de`. Se desactiva (`peso_coste = 0`) si no hay presupuesto (`sin_presupuesto`) o si `mean(coste_conocido) < 0.80` (`precios_incompletos`); el motivo se anota en `traza.terminos_desactivados` como `"coste:<motivo>"`.

*(f) `pen_rep`* — precalculado una vez por petición en `penalizacion_repeticion` (`scoring.py:227-251`): recorre `recetasRecientes` (por contrato ordenada de más reciente a más antigua), salta ids ya vistos (solo cuenta la primera aparición), mapea id → fila de catálogo → posición de pool vía `mapa_fila`, y asigna `pen[j] = 0.85 ** (pos // n_slots)`. Fuera de la lista, 0.

*(g) `afin`* — ceros, peso 0.

*Suma*: `s = 4·fit + 2·esc + 1.5·desp + 1.2·sol + 0·afin − peso_coste·cost − 2·pen_rep`, y `return where(admisible, s.astype(float32), -inf)`.

**Paso 5 — de dónde salen los K candidatos por día** (`semanal.generar_candidatos`, `semanal.py:57-105`): los días se producen **en orden** (acoplamiento consciente: el término de solape necesita `bits_semana`). Por cada día `d`: `ctx.veto_semana = usos >= 2`; bucle `k in range(2*K)` = 0..11, parando al llegar a `K=6` candidatos aceptados; `generar_candidato_dia(pool, ctx, objetivo, slots, seed, d, k)`; si devuelve `None` se rompe el bucle; si `cand.claves` (= `frozenset(filas)`) ya está visto se cuenta como duplicado y se sigue. Al cerrar el día se toma `mejor = min(candidatos, key=error)`, y con él se actualiza `ctx.bits_semana |= mejor.bits`, `ctx.veto_slot = dict(zip(mejor.slots, mejor.filas))` y `usos[fila] += 1`.

**Paso 6 — reparación (etapa C) reutiliza la etapa A** (`reparacion.generar_candidato_dia`, líneas 138-241): tras el LP inicial, si `error > UMBRAL_ERROR_OK (0,04)`, hasta 3 intentos. En cada intento se calcula `culpabilidad`, se toma el primer `argsort(-kappa, kind="stable")` cuya fila no esté ya vetada, se recalcula el residuo del slot culpable con los σ *reales* del LP, se construye `excl` (todas las demás filas del día + las vetadas), se sube la temperatura a `tau_k = ctx.tau * (1 + 0.25·k)` y se vuelve a llamar a `muestrear(score_slot(...), ids, tau_k, rng_de(seed, RUTA_A, dia, k_cand, k, IDX_SLOT[slot_culpable]))`. Se guarda siempre el mejor candidato visto, así que un intento peor nunca empeora el resultado.

**Nota sobre la variedad**: `motor.py:265` pasa siempre `temperatura(VARIEDAD_POR_DEFECTO)` = τ ≈ 0,374. El contrato (`schemas.py:57-72`) **no tiene campo `variedad`**, así que el control de §2.4 existe en el código pero no está cableado al API. En el port a TS es un punto natural para exponerlo, pero hacerlo cambia los planes.

Referencias: `services/solver/app/solver/motor.py:265-277`, `services/solver/app/solver/scoring.py:49-77`, `services/solver/app/solver/scoring.py:145-180`, `services/solver/app/solver/scoring.py:188-208`, `services/solver/app/solver/scoring.py:211-224`, `services/solver/app/solver/scoring.py:227-279`, `services/solver/app/solver/scoring.py:287-386`, `services/solver/app/solver/scoring.py:439-485`, `services/solver/app/solver/reparacion.py:66-83`, `services/solver/app/solver/reparacion.py:138-241`, `services/solver/app/solver/semanal.py:57-105`, `services/solver/DISENO.md:200-367`

## Qué hace numpy aquí y cómo se escribe a mano en TypeScript

Inventario exhaustivo de operaciones numpy en la etapa A y su traducción. La regla de rendimiento del módulo (`scoring.py:7-9`) es: «si un bucle `for` de Python itera sobre recetas, es un bug»; los únicos bucles legítimos son sobre slots (≤5), días (≤7), candidatos (≤6) e intentos (≤3). En TS los bucles sobre P son inevitables, pero deben ser bucles planos sobre `Float32Array`/`Uint8Array`, nunca `.map()`/`.filter()` sobre arrays de objetos.

| numpy | Qué hace | Equivalente TS |
|---|---|---|
| `m_slot[:, i]` | columna de una matriz (N,5) bool | guardar `m_slot` como `Uint8Array` de N*5 y leer `m_slot[r*5+i]`, o 5 `Uint8Array(N)` separados (mejor localidad y evita el *stride*) |
| `a & b`, `a &= b`, `~a` | AND/NOT booleano vectorizado | bucle sobre `Uint8Array`; o empaquetar las máscaras de slot en bits si P es grande |
| `v_macro @ v_res` | matvec (P,3)·(3,) | bucle `for i: cos[i] = m[3i]*x0 + m[3i+1]*x1 + m[3i+2]*x2`. Con `v_macro` como `Float32Array` plano de 3P |
| `np.clip(x,-1,1)`, `np.arccos` | elementwise | `Math.min/Math.max`, `Math.acos` |
| `np.where(c, a, b)` (anidado) | selección elementwise | ternarios dentro del mismo bucle; fusionar los `where` anidados de `esc` en un solo `if/else if/else` |
| `np.bitwise_count(bits & X).sum(axis=1)` | popcount de la intersección de bitsets, por fila | **JS no tiene uint64 nativo eficiente**. Recomendación: reempaquetar los bitsets a `Uint32Array` con `W32 = ceil(M/32)` y usar el popcount clásico de 32 bits (`v=v-((v>>>1)&0x55555555); v=(v&0x33333333)+((v>>>2)&0x33333333); v=(v+(v>>>4))&0x0f0f0f0f; return (v*0x01010101)>>>24`). Evitar `BigInt`: es órdenes de magnitud más lento |
| `np.flatnonzero(np.isfinite(s))` | índices de los scores válidos | bucle acumulando en un `Int32Array` con contador |
| `np.argpartition(-s, k-1)[k-1]` | k-ésimo mayor en O(P) | *quickselect* propio, o simplemente `Array.prototype.sort` sobre los índices válidos (P ≤ ~1500: coste despreciable frente a la claridad). **Importante**: el código solo usa argpartition para obtener el *valor umbral*, que es único sea cual sea la permutación; el conjunto del top-K se decide después por comparación explícita |
| `sorted(..., key=lambda i: (-score[i], str(ids[i])))` | orden estable por clave compuesta | `idx.sort((a,b) => (s[b]-s[a]) \|\| (ids[a] < ids[b] ? -1 : ids[a] > ids[b] ? 1 : 0))`. `Array.sort` es estable desde ES2019, pero aquí la clave ya es total, así que da igual |
| `s.mean()`, `s.std()` | media y **desviación típica poblacional (ddof=0)** | calcular a mano: `mean = Σs/n`, `std = sqrt(Σ(s-mean)²/n)`. **No usar ddof=1** — cambiaría todas las probabilidades |
| `np.exp`, resta del máximo | softmax estable | `Math.exp` tras `logits -= max(logits)` |
| `np.argsort(-kappa, kind="stable")` | orden estable descendente (etapa C) | `sort` estable sobre índices, comparando solo por `-kappa` para preservar el orden de selección en los empates |
| `np.bitwise_or.reduce(bits[filas], axis=0)` | unión de bitsets de un día | bucle OR sobre `Uint32Array` |
| `np.zeros/full/empty` con dtype | arrays tipados | `Float32Array`, `Float64Array`, `Int32Array`, `Int16Array`, `Uint8Array` |
| `nutr[filas]`, `cat.nutr[idx]` (*fancy indexing*) | copia de filas seleccionadas | copia manual con `subarray`/`set`; hay que hacerla una sola vez al construir el pool, como en Python |
| `.astype(np.float64)` / `float32` | cambio de precisión | ver riesgo dedicado abajo |

**Broadcasting concreto que hay que replicar**
- `(a * sigmas[:, None]).sum(axis=0)` en `totales_de` (`scoring.py:488-493`): matriz (R,6) por columna de σ (R,1), sumada por filas → vector (6,). En TS: doble bucle R×6.
- `residuo -= sigma * nutr[j]`: escalar por vector de 6.
- `np.maximum(pool.n_ingr.astype(float32), 1.0)`: escalar contra vector.

**Optimización que el port debería hacer y Python no hace**
En `score_slot`, cuatro de los siete términos **no dependen ni del slot ni del residuo**: `desp` (depende solo de `bits_despensa`), `cost` (solo de `coste_cents` y `umbral_coste`), `afin` (ceros) y `pen_rep` (ya precalculado). Y `sol` depende solo del día (cambia cuando cambia `bits_semana`). En Python se recalculan en cada llamada porque numpy los hace en microsegundos; en JS eso son popcounts sobre P×W en cada uno de los ~420-500 `score_slot` de una semana. Precalcular `desp` y `cost` una vez por petición y `sol` una vez por día reduce el trabajo de popcount en un factor ~60 sin cambiar ni un bit del resultado. Es la optimización más rentable del port de este módulo.

**Estimación de coste**: DISENO §2.3 mide ~150 µs por `score_slot` con P = 1.500 en numpy. Con 7 días × hasta 12 candidatos × 5 slots + reparaciones son unas 420-500 llamadas. En JS con bucles planos y los precálculos anteriores, es razonable esperar el mismo orden de magnitud o 2-5× peor, es decir decenas de ms. Sin los precálculos, con `BigInt` para los bitsets, o con arrays de objetos, se puede ir a segundos.

Referencias: `services/solver/app/solver/scoring.py:7-9`, `services/solver/app/solver/scoring.py:306-386`, `services/solver/app/solver/scoring.py:389-436`, `services/solver/app/solver/scoring.py:488-493`, `services/solver/app/solver/reparacion.py:186-196`, `services/solver/DISENO.md:156-171`, `services/solver/DISENO.md:342-367`

## El árbol de RNG: rutas, puntos de consumo exactos, cantidad y distribución

Esta es la parte crítica del port. La regla de DISENO §2.6 es: **nunca un único `Generator` compartido y consumido en orden**. Con un generador secuencial, cualquier cambio en el número de llamadas (un slot más, un reintento más, ejecución en paralelo) desplaza todo el flujo y el plan cambia. En su lugar, la ruta identifica el nodo y el flujo de un nodo no depende de cuántos números consuman los demás.

```python
def rng_de(seed: int, *ruta: int) -> np.random.Generator:
    import numpy as np
    return np.random.Generator(np.random.PCG64(
        np.random.SeedSequence(entropy=int(seed), spawn_key=tuple(ruta))))
```

**Rutas reservadas**: `RUTA_A, RUTA_D, RUTA_DESEMPATE = 0, 1, 2`.

**Inventario COMPLETO de los puntos de consumo** (he buscado `rng_de` y `np.random` en todo el servicio; no hay más):

**1. Etapa A — selección inicial de cada slot.** `reparacion.py:161`
Ruta: `(0, dia, k_cand, 0, IDX_SLOT[slot])` — cinco componentes. `dia ∈ [0, D)`, `k_cand ∈ [0, 12)` (el bucle es `range(2*K_CANDIDATOS_DIA)`), el 4º componente es el número de intento y vale 0 aquí, el 5º es el índice canónico del slot.
Se crea **un generador nuevo por slot** (la lambda `rng_por_slot` se evalúa dentro del bucle de `seleccionar_dia`).
Consumo por nodo: **exactamente 1 sorteo**, y solo si hay más de un candidato. En `muestrear`: si `validos.size == 0` devuelve `None` sin tocar el RNG; si tras el top-K queda `cand.size == 1` hace `return int(cand[0])` **sin tocar el RNG**; en cualquier otro caso hace exactamente un `rng.choice(cand.size, p=p)`.
Distribución: **categórica (discreta ponderada) sobre `n = cand.size ≤ 25`, con vector de probabilidades `p` explícito, un solo valor, sin reemplazo (irrelevante con size=1)**. numpy la implementa como CDF acumulada + un uniforme float64 en [0,1) + `searchsorted(side='right')`; es decir, en la práctica **consume un único doble uniforme**.

**2. Etapa C — reselección del slot culpable.** `reparacion.py:221`
Ruta: `(0, dia, k_cand, k, IDX_SLOT[slot_culpable])` con `k ∈ {1, 2, 3}` (`MAX_INTENTOS_REPARACION = 3`).
Mismo consumo: exactamente 1 sorteo categórico (o 0 si hay un único candidato). La temperatura es distinta (`tau_k = ctx.tau * (1 + 0.25·k)`) pero el consumo de aleatoriedad no cambia.
No hay colisión de rutas con el punto 1 porque el 4º componente vale 0 allí y ≥1 aquí; y dentro de un mismo `(dia, k_cand)` cada intento tiene su propio `k`.

**3. Etapa D — recocido simulado.** `semanal.py:262-291`
Ruta: `(1,)` — **un único generador para todo el recocido**, consumido secuencialmente. Es la excepción deliberada: el bucle es estrictamente secuencial y no se paraleliza.
Solo se crea si `d_total > 1 AND algún día tiene más de un candidato`; si no, no se consume nada.
Por cada una de las `SA_ITERACIONES = 400` iteraciones, y **en este orden exacto, con cortocircuito**:
  a) `d = int(rng.integers(d_total))` — **siempre**. Entero uniforme en [0, d_total).
  b) si `len(por_dia[d]) > 1`: `k_nuevo = int(rng.integers(len(por_dia[d])))` — entero uniforme en [0, len).
  c) si `k_nuevo != k_viejo` y `not _viola_dura(propuesta)`: se evalúa `delta < 0 or rng.random() < np.exp(-delta / max(t, 1e-9))`. Por **cortocircuito de `or`**, si `delta < 0` **NO se llama a `rng.random()`**. Solo se consume un doble uniforme [0,1) cuando `delta >= 0`.
  d) `t *= SA_ALFA` — fuera de todos los condicionales, se ejecuta siempre.
Total: entre 400 y ~1.200 draws, dependiendo del camino. **El cortocircuito y el orden hay que replicarlos literalmente**: cualquier cambio (evaluar siempre `random()`, reordenar las condiciones, mover el `t *= alfa`) desincroniza el flujo y produce otro plan.

**4. `RUTA_DESEMPATE = 2`: definida pero NUNCA usada.** He buscado en todo `services/`: no aparece en ningún `rng_de`. Los desempates reales del código son deterministas por id (`str(ids[i])`), no aleatorios. En TS se puede portar la constante como reserva documentada, pero no hay que implementar nada.

**5. El seed cuando falta.** `motor.py:216`: `seed = solicitud.seed if solicitud.seed is not None else secrets.randbits(63)`. En navegador: `crypto.getRandomValues`. Cuidado: 63 bits **exceden `Number.MAX_SAFE_INTEGER` (2^53−1)**; ver riesgos.

**Interfaz mínima que el RNG de TS debe ofrecer** — son solo tres métodos, más la fábrica:
```ts
interface Rng {
  random(): number;                       // doble uniforme en [0, 1)
  integers(n: number): number;            // entero uniforme en [0, n)
  choice(n: number, p: Float64Array): number; // categórica, 1 valor, pesos normalizados
}
function rngDe(seed: bigint, ...ruta: number[]): Rng;
```
`choice` puede implementarse trivialmente sobre `random()` con CDF + búsqueda binaria, igual que numpy. `integers(n)` en numpy usa rechazo enmascarado/Lemire sobre palabras de 64 bits; la implementación exacta hay que verificarla si se busca equivalencia bit a bit (ver riesgos).

**Propiedad que hay que preservar** (es la razón de ser del árbol, no un detalle): nodos distintos → flujos independientes; el flujo de un nodo no depende de cuántos números consuman los demás. Esa propiedad se consigue con cualquier derivación determinista y bien mezclada de `(seed, ruta) → estado inicial`; no requiere reproducir SeedSequence. Una implementación honesta: `estado = SHA-256(seed_le64 ‖ ruta_le32...)` truncado a 128 bits, alimentando un PCG64-XSL-RR o un xoshiro256++ propio. Documentar que rompe la compatibilidad de seeds con la versión Python y subir `VERSION_GENERADOR`.

Referencias: `services/solver/app/solver/__init__.py:167-192`, `services/solver/app/solver/reparacion.py:156-164`, `services/solver/app/solver/reparacion.py:216-224`, `services/solver/app/solver/semanal.py:261-291`, `services/solver/app/solver/scoring.py:389-436`, `services/solver/app/solver/motor.py:216`, `services/solver/DISENO.md:425-469`, `services/solver/DISENO.md:936-947`

## `temperatura()` y el muestreo softmax/top-K, algoritmo exacto

**`temperatura(variedad)`** (`__init__.py:195-201`):
```python
return TAU_MIN * (TAU_MAX / TAU_MIN) ** (variedad / 100.0)
```
es decir `τ(v) = 0,12 · 12,5^(v/100)`, con `v ∈ [0,100]`. Geométrico, no lineal, porque la percepción de «más variado» es multiplicativa: subir de 10 a 20 se nota tanto como subir de 40 a 80.
Valores: `τ(0) = 0,12` (prácticamente argmax), `τ(45) = 0,3740` (por defecto, DISENO redondea a 0,37), `τ(100) = 1,5` (casi uniforme sobre el top-25).
En TS: `TAU_MIN * Math.pow(TAU_MAX / TAU_MIN, variedad / 100)`. Sin trampa numérica. Nota: la función **no clampa** `variedad` a [0,100]; si en TS se expone al usuario conviene clampar en la frontera.

**`muestrear(scores, ids, tau, rng)`** (`scoring.py:389-436`). Devuelve un índice de pool o `None`. Algoritmo exacto, paso a paso:

1. `validos = flatnonzero(isfinite(scores))`. Los inadmisibles llevan `-inf`, así que `isfinite` los descarta. Si `validos.size == 0` → `None` (y el día se declara imposible aguas arriba).

2. **Top-K solo si `validos.size > TOP_K (25)`.** Con pool pequeño (el catálogo semilla, 36 recetas, tiene entre 8 y 22 candidatos por slot) esta rama **no se ejecuta** y compiten todos los válidos.
   El código NO usa `argpartition` para elegir el conjunto, y el comentario explica por qué: `argpartition` es O(P) pero no define qué empatados deja dentro del corte, así que con scores repetidos el CONJUNTO del top-k depende de la implementación y cambia entre versiones de NumPy; ordenar después no lo arregla porque lo que varía es qué entra. Se usa solo para obtener el **valor umbral**, que sí es único sea cual sea la permutación:
   ```python
   s_val    = scores[validos]
   umbral   = float(s_val[np.argpartition(-s_val, TOP_K-1)[TOP_K-1]])  # el 25º mayor
   mejores  = validos[s_val >  umbral]      # estrictamente mejores: como mucho 24
   empatados= validos[s_val == umbral]
   huecos   = TOP_K - mejores.size
   if empatados.size > huecos:
       empatados = primeros `huecos` de sorted(empatados, key=lambda i: str(ids[i]))
   validos = concatenate([mejores, empatados])
   ```
   El desempate para *entrar* en el top-K es por **id ascendente** (orden de cadena), no por score.

3. **Orden explícito, obligatorio**: `orden = sorted(validos, key=lambda i: (-float(scores[i]), str(ids[i])))`. Score descendente, id ascendente. Sin este desempate por id, el mismo seed produce planes distintos entre versiones de NumPy: es «el fallo de reproducibilidad más fácil de introducir». Nótese que el orden importa aunque la distribución sea invariante a permutaciones, porque `rng.choice` devuelve una posición dentro de `cand` y esa posición se mapea al índice de pool.

4. **Atajo**: `if cand.size == 1: return int(cand[0])` — **sin consumir aleatoriedad**. Punto crítico para replicar el árbol de RNG.

5. **Estandarización (z-scores) en float64**: `s = scores[cand].astype(float64)`; `z = (s - s.mean()) / max(s.std(), 1e-3)`. `np.std` es **poblacional, ddof = 0**. El clamp a 1e-3 evita división por cero cuando todos los scores del top-K son iguales.
   Por qué estandarizar: sin ello la dispersión de S cambia con el residuo y con el tamaño del pool, así que la misma τ significa «casi determinista» en un slot y «casi uniforme» en otro. Estandarizando, **τ tiene un significado estable** y es exponible como control de variedad.

6. **Softmax estable**: `logits = z / max(tau, 1e-6)`; `logits -= logits.max()`; `p = exp(logits)`; `p /= p.sum()`.

7. `return int(cand[rng.choice(cand.size, p=p)])`.

En TS, todo esto es directo salvo dos puntos: la comparación de cadenas de `str(ids[i])` (Python ordena por *code point*, JS por unidad de código UTF-16 — idéntico para ids ASCII, distinto solo con caracteres fuera del BMP) y la `std` poblacional.

Decisiones descartadas que conviene no «mejorar» en el port: muestreo por rangos (Boltzmann sobre la posición) se descarta porque tira la magnitud de la diferencia de score; argmax puro se descarta porque el re-roll dejaría de funcionar (spec §6.2).

**Muestreo que NO existe**: `mejor_alternativa` (`reparacion.py:270-287`), usada por `reparar_duras` de la etapa D, elige el **argmax determinista** con desempate por id (`min(validos, key=lambda i: (-s[i], str(ids[i])))`), sin tocar el RNG. La reparación de restricciones duras no debe introducir aleatoriedad nueva: se está corrigiendo un plan concreto y hace falta la mejor sustitución, no una sorteada.

Referencias: `services/solver/app/solver/__init__.py:195-201`, `services/solver/app/solver/scoring.py:389-436`, `services/solver/app/solver/reparacion.py:270-287`, `services/solver/DISENO.md:369-407`

## Discrepancias DISENO/código y cosas que NO puedo afirmar sin verificar

**Discrepancias detectadas entre DISENO.md y el código** (el código manda; documentarlas en el port para no «arreglar» de más):
1. §2.2 escribe la fórmula del score con `0,8·φ_afin` y rango `S ∈ [-3,5 ; 9,5]`, pero `__init__.py:78` fija `W_AFIN = 0.0` y §2.2g lo explica («peso efectivo 0 en MVP»). El rango real es `[-3,5 ; 8,7]`.
2. §2.6 dice que la ruta de la etapa A es `(0, dia, k, intento, slot)` y también, en el docstring de `rng_de`, «(dia, candidato_k, intento, slot)». El código usa 5 componentes incluyendo el prefijo `RUTA_A`. Consistente, pero la prosa es ambigua.
3. §5.4 dice que un candidato duplicado «se regenera con `rng_de(seed, RUTA_A, d, k+K, 0, ·)`». La implementación simplemente itera `k in range(2*K)` (0..11), lo que produce exactamente esas rutas. Equivalente.
4. `RUTA_DESEMPATE = 2` está reservada y **no se usa en ninguna parte** del servicio.
5. `MIN_CANDIDATOS_SLOT_SEMANA = 8` se documenta como «ceil(7/2) + 4», y en `_min_candidatos_slot` la holgura se recalcula como `8 - ceil(7/2) = 4`. Es decir, el 8 y el 4 son redundantes entre sí: cambiar uno sin el otro rompe la derivación.
6. El control de variedad de §2.4 **no está en el contrato**: `SolicitudGeneracion` (schemas.py:69-72) solo tiene `objetivos`, `restricciones` y `seed`. `motor.py:265` fija `temperatura(VARIEDAD_POR_DEFECTO)`.
7. `RespuestaOk` no devuelve el seed; DISENO §2.6 lo resuelve con la cabecera HTTP `X-PlanEat-Seed`. En un despliegue estático sin backend **no hay cabeceras**: el port tiene que devolver el seed en el propio objeto de respuesta o persistirlo en el cliente, o el plan deja de ser reproducible. Es un cambio de contrato que hay que decidir explícitamente.

**Lo que NO sé y no voy a inventar** (requiere leer el código fuente de numpy, no está en este repositorio):
- La secuencia de bits exacta de `np.random.SeedSequence` con `entropy` + `spawn_key`: el tamaño del pool de entropía, las constantes de mezcla y cómo se concatena `spawn_key` a la entropía. No lo afirmo de memoria.
- El algoritmo exacto de `Generator.integers(n)` para `n` arbitrario: numpy usa muestreo por rechazo sobre palabras, pero no puedo afirmar sin verificar si en esta versión es rechazo enmascarado o el método de Lemire, ni cuántas palabras de 32/64 bits consume por llamada en el peor caso. Esto solo importa si se busca equivalencia bit a bit.
- El detalle de implementación de `Generator.choice(n, p=p)` con `size=None`: entiendo que construye la CDF y hace `searchsorted` sobre un único doble uniforme, pero es una afirmación que hay que verificar contra la fuente antes de darla por buena.
- La variante concreta de PCG64 que usa `np.random.PCG64` (XSL-RR vs DXSM) y sus constantes de multiplicador/incremento.

**Conclusión operativa**: la equivalencia bit a bit de los planes entre Python y TypeScript es alcanzable pero exige reimplementar SeedSequence + PCG64 + `integers`/`choice` de numpy **y además** replicar la aritmética float32 del score. Mi recomendación es no perseguirla: implementar un árbol de RNG propio, documentado y testeado (determinismo intra-TS, independencia entre nodos), subir `VERSION_GENERADOR` a algo como `"2.0.0-ts"` y regenerar los *golden tests* contra la implementación TS. Lo que sí hay que preservar literalmente es la **estructura**: qué nodos existen, cuántos sorteos consume cada uno, en qué orden, y los atajos que consumen cero (`cand.size == 1`, el cortocircuito de `delta < 0`).

**Fuera del ámbito de esta tarea pero confirmado de paso**: `porciones.py` (LP con HiGHS) y su bloqueo siguen intactos; `motor.py` no toca HiGHS directamente, lo alcanza vía `reparacion._porcionar` → `porciones.resolver_porciones`. La frontera del port es limpia: `resolver_porciones(a, lo, hi, sigma_ref, bandas) -> res(sigma, totales, error, emergencia)` es el único punto donde entra el LP.

Referencias: `services/solver/app/solver/__init__.py:78`, `services/solver/app/solver/__init__.py:169`, `services/solver/app/solver/motor.py:265`, `services/solver/app/schemas.py:69-72`, `services/solver/app/solver/reparacion.py:112-116`, `services/solver/DISENO.md:226-236`, `services/solver/DISENO.md:445-458`, `services/solver/DISENO.md:940-947`

## Riesgos

- **[alta]** Buscar equivalencia bit a bit con numpy (SeedSequence + PCG64 + integers/choice) para que los seeds antiguos den los mismos planes. Es un pozo: son cuatro algoritmos que hay que reimplementar sin errores y que ni siquiera están documentados en este repo.
  - Mitigación: Decidir explícitamente NO buscar compatibilidad de seeds. Implementar un árbol propio (por ejemplo SHA-256 sobre (seed, ruta) -> estado de 128 bits, alimentando xoshiro256++ o PCG64 propio), subir VERSION_GENERADOR, y testear las dos propiedades que sí importan: mismo seed + misma entrada -> mismo plan; nodos distintos -> flujos independientes. Regenerar los golden tests contra la implementación TS.
- **[alta]** Divergencia float32/float64. El score se calcula y se devuelve en float32 (`s.astype(np.float32)`), sobre arrays float32 (`nutr`, `v_macro`, `escala_min/max`), y solo `muestrear` promociona a float64. JS solo tiene float64, así que scores casi empatados pueden ordenarse al revés, cambiar el conjunto del top-K y por tanto la receta elegida.
  - Mitigación: Usar Float32Array para nutr/v_macro/escala y Math.fround en los puntos donde Python hace .astype(np.float32) (fit, esc, desp, sol, cost, y la suma final). Aun así, el matvec de 3 términos acumula en float32 en numpy y en float64 en JS salvo que se froundee cada producto parcial. Alternativa pragmática: aceptar la divergencia, promover todo a float64 de forma consistente, y validar por métricas agregadas (error nutricional por día, ingredientes únicos, repeticiones) en vez de por igualdad exacta de recetas.
- **[alta]** El seed de 63 bits (`secrets.randbits(63)`) no cabe en un Number de JS (2^53-1). Un round-trip por JSON o por Number pierde precisión silenciosamente y el plan deja de ser reproducible: exactamente el bug que toda la disciplina de semillas intenta evitar.
  - Mitigación: Usar BigInt internamente y serializar el seed como string decimal, o limitar la generación a 53 bits (`crypto.getRandomValues` de 32+21 bits) y documentarlo. Añadir un test de round-trip seed -> JSON -> seed -> mismo plan.
- **[alta]** Replicar mal el consumo de aleatoriedad en los atajos: `muestrear` devuelve sin tocar el RNG cuando queda un único candidato, y el recocido no llama a `rng.random()` cuando `delta < 0` (cortocircuito del `or`). Cualquiera de los dos, si se implementa 'limpiamente' llamando siempre al RNG, desincroniza el flujo de la etapa D y produce otro plan.
  - Mitigación: Portar `muestrear` y el bucle de recocido línea a línea, con un comentario que marque los dos puntos como load-bearing. Añadir un test que cuente los draws consumidos por el generador de RUTA_D en un caso fijo y lo compare con un número esperado.
- **[alta]** Rendimiento en el navegador. `score_slot` se ejecuta ~420-500 veces por semana y cada llamada hace dos popcounts sobre P x W bitsets y un matvec sobre P filas. Con BigInt para los uint64, o con arrays de objetos en vez de typed arrays, esto pasa de decenas de ms a segundos y bloquea el hilo principal.
  - Mitigación: Reempaquetar los bitsets a Uint32Array (W32 = ceil(M/32)) con popcount de 32 bits; struct-of-arrays con typed arrays en todo el pool; y precalcular fuera del bucle los términos invariantes (desp y cost una vez por peticion, sol una vez por dia, pen_rep ya lo esta). Ejecutar el motor en un Web Worker para no congelar la UI.
- **[alta]** Reordenar cualquiera de las cuatro tuplas de vocabulario al 'limpiar' el código. En NUTRIENTES rompe el slice residuo[1:4] y todas las matrices; en SLOTS rompe además el árbol de RNG (IDX_SLOT es el último componente de la ruta) y el desempate de orden_de_slots; en ALERGENOS rompe el desempate determinista de la ablación del diagnóstico.
  - Mitigación: Declararlas `as const` en un único módulo, derivar los IDX_* de ellas, y añadir un test que compare hashes de las cuatro tuplas contra valores congelados. Documentar en el propio fichero, como hace Python, que cambiar el orden invalida cualquier catálogo cacheado y obliga a subir VERSION_GENERADOR.
- **[media]** Usar la desviación típica muestral (ddof=1) en vez de la poblacional (ddof=0) al estandarizar los z-scores del top-K. Es el error por defecto de casi toda librería estadística de JS y cambia todas las probabilidades del softmax sin dar ningún síntoma visible.
  - Mitigación: Calcular media y desviación a mano en el propio bucle, con el divisor n (no n-1), y mantener el clamp `max(std, 1e-3)`. Test unitario de `muestrear` con scores fijos y probabilidades esperadas calculadas a mano.
- **[baja]** Desempate por id: Python ordena cadenas por code point, JS por unidad de código UTF-16. Si algún recetaId lleva caracteres fuera del BMP, el orden difiere y con él el conjunto del top-K y el mapeo posición->receta.
  - Mitigación: Los ids del catálogo semilla son ASCII, así que hoy no muerde. Añadir una validación al cargar el catálogo que rechace ids no ASCII, o comparar con un colador explícito por code point.
- **[media]** El contrato no devuelve el seed (DISENO lo resuelve con la cabecera HTTP X-PlanEat-Seed). En un despliegue estático de GitHub Pages no hay backend ni cabeceras, así que un plan generado sin seed explícito queda irreproducible y no se puede depurar.
  - Mitigación: Que el cliente genere SIEMPRE el seed y lo envíe (es la recomendación de DISENO para la fase 1), y añadir `seed` y `versionGenerador` a RespuestaOk. Persistir ambos junto al plan en localStorage/IndexedDB.
- **[media]** `Contexto` es mutable y `generar_candidatos` lo muta entre días (veto_semana, bits_semana, veto_slot). Un port que lo trate como inmutable, o que reordene los días, rompe el acoplamiento consciente entre el término de solape y los días ya cerrados.
  - Mitigación: Portar el Contexto como objeto mutable explícito y documentar que los días se producen estrictamente en orden. Test: dos días con el mismo objetivo deben producir bits_semana creciente y veto_slot igual al mejor candidato provisional del día anterior.
- **[baja]** La caché de pool de nivel 1 usa `threading.Lock` y `time.monotonic`, con TTL de 3600 s y política de vaciado total al llegar a 256 entradas. En el navegador no hay hilos compartidos ni recarga de catálogo en caliente, y una caché mal portada puede devolver un pool obsoleto tras cambiar de catálogo.
  - Mitigación: Simplificar: un Map sin cerrojo, clave con la versión del catálogo incluida (ya lo está), y `invalidarCachePool()` invocado al cargar cualquier catálogo. El TTL puede eliminarse si el catálogo es estático en el bundle.

---

# porcionado-lp

porciones.py (377 L) implementa la Etapa B: interval goal programming con banda muerta, resuelto con HiGHS y luego cuantizado a la rejilla de 0,05.
El LP es diminuto y siempre factible por construccion: 2R+2N columnas y N+2R filas con R=3..5 recetas/dia y N=6 nutrientes SIEMPRE (los nutrientes inactivos no se eliminan, se anulan con peso 0 y banda abierta). Para R=5: 22 columnas, 16 filas, 62 no nulos. Se invoca <=24 veces por dia y <=168 por semana.
El punto decisivo para el port: sigma se devuelve SIEMPRE cuantizado a la rejilla, luego el resultado real de Python es LP-continuo + redondeo, que NO es optimo sobre la rejilla. La brecha de redondeo acota en ~0,025*sum|a_n,i| por nutriente, es decir dE del orden de 0,009 en kcal (peso 3,0 sobre W=8,3) justo cuando el optimo del LP cae sobre el borde de banda, que es el caso tipico. Python solo repara ese caso para kcal y moviendo UNA sola coordenada.
Conclusion: Python y cualquier port TS son ambos heuristicas sobre la misma rejilla finita; lo comparable es E, no el vertice.
Recomendacion: (b') descenso coordinado sobre la rejilla, minimizando la MISMA funcion objetivo del LP (W*E + eps*||sigma-sigma_ref||_1), con vecindad de pares compensatorios y multi-arranque determinista. Cuesta ~150 LOC, 0 dependencias, 0 KB de bundle, es deterministico sin RNG y se espera E_ts <= E_py en la mayoria de instancias. Se deja detras de una interfaz para poder sustituirlo por (c) highs-js/glpk WASM si la medicion offline muestra brecha inaceptable. (a) simplex a mano es la peor relacion coste/riesgo: LP masivamente degenerado + simplex artesanal.
Detectadas dos trampas de paridad numerica reales: np.round es banker's rounding (Math.round no lo es) y _cuantizar y _rejilla generan rejillas DISTINTAS cuando escalaMin no es multiplo de 0,05.

## Formulacion exacta del LP (variables, objetivo, restricciones, cotas)

Sea R el conjunto de recetas ya elegidas para el dia (|R| = 3..5), N = 6 nutrientes en orden FIJO (kcal, proteina, carbohidrato, grasa, fibra, sodio), a[n,i] el nutriente n por racion base de la receta i, sigma_ref[i] el factor sugerido por la Etapa A (ya clipado a [l_i, u_i]).

**Variables** (2R + 2N en total):
- sigma_i, i in R : factor de racion. Cotas l_i <= sigma_i <= u_i (escalaMin/escalaMax de la receta; por defecto 0,6 y 1,8).
- u_n^+ >= 0, n in N : exceso sobre U_n. Cota superior +inf, salvo si w_n^+ == 0, en cuyo caso la cota superior se FIJA A 0 (la columna no se elimina).
- u_n^- >= 0, n in N : defecto bajo L_n. Idem con w_n^-.
- t_i >= 0, i in R : linealizacion de |sigma_i - sigma_ref_i|. Cota superior +inf.

**Objetivo** (minimizar):

  J(sigma,u,t) = SUM_n [ (w_n^+ · u_n^+ + w_n^- · u_n^-) / e_n ] + eps · SUM_i t_i,  con eps = EPS_REG = 1e-3

**Restricciones**:
1. Una sola fila por nutriente (banda muerta exacta, no aproximada):
     L_n <= SUM_i a[n,i]·sigma_i - u_n^+ + u_n^- <= U_n,  para todo n in N
   Con costes positivos sobre u^±, el optimo da u_n^+ = max(0, A_n - U_n), u_n^- = max(0, L_n - A_n) y u^+=u^-=0 dentro de la banda. Son 6 filas, no 12.
2. Linealizacion L1 del regularizador, dos filas por receta:
     t_i - sigma_i >= -sigma_ref_i
     t_i + sigma_i >=  sigma_ref_i
   (juntas: t_i >= |sigma_i - sigma_ref_i|; el optimo aprieta a igualdad porque el coste de t es positivo).
3. Cotas de caja ya listadas arriba.

**Bandas [L_n, U_n] y pesos** (bandas_de, lineas 54-106):
| n | L_n | U_n | w^+ | w^- |
|---|---|---|---|---|
| kcal | kcal·(1-tol) | kcal·(1+tol) | 3,0 | 3,0 |
| proteina | proteinaG.min | proteinaG.max | 1,0 | 2,5 |
| carbohidrato | carbohidratoG.min | carbohidratoG.max | 1,0 | 1,0 |
| grasa | grasaG.min | grasaG.max | 1,0 | 1,0 |
| fibra | fibraMinG or 0.0 | +INF | 0,0 | 0,5 |
| sodio | -INF | sodioMaxMg | 0,3 | 0,0 |

Ajustes posteriores, en este orden exacto:
- si objetivo.sodioMaxMg is None -> w^+[sodio] = 0
- si not objetivo.fibraMinG (falsy: None o 0) -> w^-[fibra] = 0
- si activos (bool[6]) no es None -> para todo n inactivo: w^+ = w^- = 0, L_n = -INF, U_n = +INF

OJO: L[fibra] SIEMPRE es finito (0.0 si no hay fibraMinG) salvo que fibra sea inactivo. Eso importa porque `desviaciones` mira la finitud de la cota, no el peso.

**Normalizador e_n** (calculado DESPUES de aplicar `activos`, lineas 96-105):
- si L_n y U_n finitos: e_n = max((L_n+U_n)/2, 1.0)   -> para kcal da exactamente el objetivo T
- si solo L_n finito: e_n = max(L_n, 1.0)
- si solo U_n finito: e_n = max(U_n, 1.0)
- si ninguno: e_n = 1.0

**INF** es el centinela INF_HIGHS = 1.0e30, NO Infinity. Todas las comparaciones son `hi < 1e30` / `lo > -1e30`. Portarlo con Infinity funcionaria para las comparaciones pero cambia la aritmetica de e_n; recomiendo mantener 1e30 literal.

**peso_total** (propiedad de Bandas) = SUM_n max(w_n^+, w_n^-). Con los 6 nutrientes activos y sodio+fibra declarados: 3,0+2,5+1,0+1,0+0,5+0,3 = **8,3**.

**Garantia de diseno**: el LP es SIEMPRE factible (u^± sin cota superior salvo los lados suprimidos, y la caja de sigma es no vacia). La insatisfacibilidad se manifiesta como E alto, nunca como excepcion.

Referencias: `services/solver/app/solver/porciones.py:39-106`, `services/solver/app/solver/porciones.py:157-230`, `services/solver/DISENO.md:501-573`, `services/solver/app/solver/__init__.py:96-112`

## Disposicion exacta de la matriz (CSC) — necesaria si se porta a un solver externo

n_col = 2·R + 2·N ; n_fil = N + 2·R. **N es SIEMPRE 6**: el codigo usa `N_NUTR = len(NUTRIENTES)` y nunca elimina columnas/filas de nutrientes inactivos. (La tabla de DISENO.md §3.4 dice "N nutrientes activos", lo cual induce a error respecto del codigo real.)

**Columnas, en orden**:
| Rango | Variable | Coste | Cota inf | Cota sup |
|---|---|---|---|---|
| [0, R) | sigma_i | 0 | l_i | u_i |
| [R, R+2N) par | u_n^+ | w_n^+/e_n | 0 | INF, o **0** si w_n^+ == 0 |
| [R, R+2N) impar | u_n^- | w_n^-/e_n | 0 | INF, o **0** si w_n^- == 0 |
| [R+2N, 2R+2N) | t_i | eps=1e-3 | 0 | INF |

Es decir el bloque u va intercalado: u_0^+, u_0^-, u_1^+, u_1^-, ...

**Filas, en orden**:
| Fila | Contenido | row_lower | row_upper |
|---|---|---|---|
| n in [0,N) | SUM_i a[n,i]·sigma_i - u_n^+ + u_n^- | L_n | U_n |
| N+2i | t_i - sigma_i | -sigma_ref_i | INF |
| N+2i+1 | t_i + sigma_i | +sigma_ref_i | INF |

**No nulos por columna**:
- columna sigma_i: filas 0..N-1 con valor a[n,i]; fila N+2i con -1.0; fila N+2i+1 con +1.0  (N+2 entradas)
- columna u_n^+: fila n con -1.0  (1 entrada)
- columna u_n^-: fila n con +1.0  (1 entrada)
- columna t_i: filas N+2i y N+2i+1 con +1.0 cada una  (2 entradas)
Total nnz = N·(R+2) + 4R = 10R + 12 con N=6.

Detalles de implementacion que el port debe conocer:
- `col_hi[R:R+2N:2][w_mas==0] = 0.0` opera sobre una VISTA (slicing basico con paso 2 en numpy) asi que la escritura se propaga. En TS es un bucle trivial.
- `fil_lo = concatenate([bandas.lo, np.empty(2R)])` y luego se sobreescriben TODOS los 2R elementos con los dos slices con paso 2; no hay memoria sin inicializar en el resultado.
- dtypes obligatorios en highspy: start_/index_ int32, value_ float64.

Referencias: `services/solver/app/solver/porciones.py:177-230`, `services/solver/DISENO.md:621-643`

## Tamano tipico del LP y numero de invocaciones

R = numero de recetas del dia = numero de slots pedidos. SLOTS posibles: desayuno, almuerzo, comida, merienda, cena -> **R en 1..5, tipico 3..5**. N = 6 fijo.

| R | columnas (2R+12) | filas (6+2R) | no nulos (10R+12) |
|---|---|---|---|
| 3 | 18 | 12 | 42 |
| 4 | 20 | 14 | 52 |
| 5 | 22 | 16 | 62 |

Es un LP de juguete: cabe entero en L1. Medido en Python: **64 us** construir+resolver.

**Frecuencia de invocacion** (peor caso, de DISENO.md §7.1): 7 dias x 6 candidatos (K_CANDIDATOS_DIA) x 4 pasadas (1 inicial + MAX_INTENTOS_REPARACION=3) = **168 LP por semana**, **24 por dia**. Presupuesto Python: 11 ms/semana de LP. Objetivo global de la tarea: <2 s para un dia, ~170x de margen.

**Tamano del espacio discreto real** (rejilla de 0,05 en [0,6 , 1,8]): 25 puntos por coordenada (26 entradas en `_rejilla` por el `append(hi)` duplicado). |G| = 26^R: R=3 -> 17.576 ; R=4 -> 456.976 ; R=5 -> 11,9 M. Enumeracion exhaustiva viable solo para R<=3.

Referencias: `services/solver/DISENO.md:1143-1157`, `services/solver/app/solver/__init__.py:60`, `services/solver/app/solver/__init__.py:110-125`, `services/solver/app/solver/reparacion.py:112-116`

## _cuantizar y _rejilla — DOS rejillas distintas en el mismo fichero

**_cuantizar(sigma, lo, hi)** (l.233-236):
  q = np.round(sigma / 0.05) * 0.05 ; return np.clip(q, lo, hi)
Rejilla anclada en **0**: los valores admisibles son los multiplos de 0,05 dentro de [lo,hi], MAS lo y hi por efecto del clip.

**_rejilla(lo, hi)** (l.239-243):
  n = floor((hi - lo)/0.05 + 1e-9)
  puntos = lo + 0.05·[0..n]
  return clip(append(puntos, hi), lo, hi)
Rejilla anclada en **lo**. Con lo=0,6 y hi=1,8 devuelve 26 valores (0,60 ... 1,80 y luego 1,80 otra vez, duplicado; el ultimo punto calculado sale 1,8000000000000003 en float64 y el clip lo devuelve a 1,8 exacto).

**Incoherencia real y verificada**: si escalaMin no es multiplo de 0,05 (p.ej. 0,7333), _rejilla devuelve {0,7333 0,7833 0,8333 ...} mientras que _cuantizar solo puede producir {0,75 0,80 0,85 ...} U {0,7333, 1,8}. Es decir, `_pulir_una` puede devolver un sigma que `_cuantizar` nunca produciria. Con los valores por defecto (0,6 / 1,8, ambos multiplos de 0,05) las dos rejillas coinciden y el problema no se ve. El port debe decidir explicitamente: replicar bug por bug, o unificar en la rejilla anclada en 0 (mi recomendacion) y pre-registrar la divergencia en los tests de paridad.

**Trampa numerica de paridad**: `np.round` usa redondeo bancario (half-to-even): np.round(20.5) = 20.0. `Math.round` de JS redondea half-away-from-zero: Math.round(20.5) = 21. Difieren exactamente cuando sigma/0,05 cae en un .5 exacto. Verificado que 1.025/0.05 = 20.499999999999996 en float64, asi que muchos casos "a mitad" no lo son de verdad, pero no todos. Hay que implementar un `roundHalfToEven(x)` en TS si se quiere paridad bit a bit.

Referencias: `services/solver/app/solver/porciones.py:233-243`

## desviaciones y error_de

**desviaciones(totales, bandas) -> (u_mas, u_menos)** (l.109-115), funcion pura, sin solver:
  u_mas[n]  = (U_n < INF) ? max(0, totales[n] - U_n) : 0
  u_menos[n]= (L_n > -INF) ? max(0, L_n - totales[n]) : 0
Depende de la FINITUD de la cota, no del peso. Un nutriente con peso 0 pero cota finita (p.ej. fibra con fibraMinG=0) produce u_menos=0 de todas formas.

**error_de(totales, bandas) -> float** (l.118-131):
  W = bandas.peso_total = SUM_n max(w^+_n, w^-_n)
  si W <= 0: return 0.0            <- caso degenerado: todos los nutrientes inactivos -> E=0 y el plan se acepta sin control nutricional. Replicar exactamente.
  E = ( SUM_n [ w^+_n·u^+_n/e_n + w^-_n·u^-_n/e_n ] ) / W

E es la desviacion relativa media ponderada FUERA de banda. Se calcula SIEMPRE sobre los totales reales de los sigma CUANTIZADOS que se devuelven, nunca sobre el valor objetivo del LP (ese incluye el regularizador eps·SUM t y corresponde a los sigma continuos).

Umbrales de producto (__init__.py): UMBRAL_ERROR_OK = 0,04 ; UMBRAL_ERROR_ACEPTABLE = 0,12.
- E <= 0,04: aceptar, no reparar (corta el bucle de reparacion)
- 0,04 < E <= 0,12: aceptable tras agotar reparaciones
- E > 0,12: diagnostico §6, ok:false

Relacion con el objetivo del LP: J = W·E' + eps·SUM|sigma - sigma_ref|, donde E' es E evaluado sobre los totales CONTINUOS. Es decir W = 8,3 es el factor de escala entre la funcion objetivo del LP y el E reportado. Esto es lo que permite reproducir el desempate del LP en cualquier metodo alternativo.

Referencias: `services/solver/app/solver/porciones.py:109-131`, `services/solver/DISENO.md:575-599`, `services/solver/app/solver/__init__.py:108`

## _pulir_una — reoptimizacion exacta de una coordenada sobre la rejilla

_pulir_una(a, sigma, lo, hi, bandas, j) (l.246-270):
  resto  = a @ sigma - a[:,j]·sigma[j]           # (6,) contribucion de las demas recetas
  puntos = _rejilla(lo[j], hi[j])                # <=26 candidatos
  totales[k] = resto + puntos[k]·a[:,j]          # (26,6)
  errores[k] = error_de(totales[k], bandas)
  mejor  = argmin(errores)                       # PRIMER minimo -> desempata por el punto MAS BAJO de la rejilla
  salida = copia de sigma con salida[j] = puntos[mejor]

Puntos criticos para el port:
1. El criterio es **error_de**, es decir E, SIN el termino regularizador eps·SUM t. Es distinto del objetivo del LP. Si se reutiliza esta logica como motor de optimizacion (opcion b) hay que decidir si se sigue usando E puro (paridad con _pulir_una) o J completo (paridad con el LP). Recomiendo J para el descenso y E puro solo para replicar el paso de pulido final.
2. `np.argmin` devuelve el PRIMER indice minimo. Como `_rejilla` esta ordenada ascendente, los empates se resuelven hacia el sigma_j MAS PEQUENO. Replicarlo con un `<` estricto recorriendo en orden ascendente.
3. Es exactamente optimo sobre lo que se puede devolver: el problema es unidimensional y lineal a trozos, el optimo continuo esta en un punto de ruptura, pero como el sigma devuelto tiene que caer en la rejilla de todos modos, evaluar la rejilla es a la vez mas simple y estrictamente mejor que resolver el continuo y volver a redondear.
4. Coste: ~26 productos escalares de 6 elementos.

Nota: `resto = a @ sigma - a[:,j]·sigma[j]` recalcula el producto completo cada vez; en TS conviene mantener `totales` incrementalmente para el descenso coordinado.

Referencias: `services/solver/app/solver/porciones.py:246-270`

## resolver_porciones — flujo completo y paso de reparacion 1-D

resolver_porciones(a, lo, hi, sigma_ref, bandas) -> ResultadoPorcionado (l.293-349). `a` es (6, R).

1. Coerciones: a -> float64 contiguo; lo, hi -> float64; **sigma_ref = clip(sigma_ref, lo, hi)** (importante: se clipa ANTES de usarlo como ancla del regularizador).
2. Instancia Highs thread-local reutilizada; opciones: output_flag=False, threads=1 (determinismo), solver="simplex", time_limit = h.getRunTime() + 0.05.
   Comentario clave del codigo (l.313-320): fijar time_limit al valor absoluto 0,05 es un BUG grave y medido — `clear()` no reinicia el contador acumulado, asi que tras ~700 LP (media docena de semanas) todas las llamadas devuelven kTimeLimit y el servicio cae al porcionado de emergencia para siempre y en silencio. En TS este problema desaparece, pero conviene conservar la leccion: no poner presupuestos de tiempo absolutos acumulativos.
3. Si getModelStatus() != kOptimal -> `_porcionado_de_emergencia`.
4. sigma = _cuantizar(x[0:R], lo, hi)   (solo las primeras R componentes de la solucion; u^± y t se descartan)
5. totales = a @ sigma ; error = error_de(totales, bandas)   <- SIEMPRE recalculados sobre los sigma cuantizados
6. **Reparacion 1-D condicional**: si totales[kcal] < L_kcal o > U_kcal (y R > 0):
   - j = argmax_i( a[kcal,i] · sigma_i )   # la receta con mayor contribucion calorica REAL, no la de mayor densidad
   - candidato = _pulir_una(a, sigma, lo, hi, bandas, j)
   - se acepta solo si err_c < error (estrictamente menor)
   Nota: la condicion de disparo mira SOLO kcal, pero el criterio de aceptacion es E global. Y solo se pule UNA coordenada, UNA vez.
7. Devuelve ResultadoPorcionado(sigma, totales, error, emergencia=False).

**Invariante contractual** (repetido tres veces en el codigo y en DISENO.md): los totales devueltos son SIEMPRE a @ sigma_final. Mentir aqui es el bug que hace que la suma de la UI no cuadre con lo que la UI muestra por comida.

ResultadoPorcionado: { sigma: float64[R] cuantizado, totales: float64[6], error: float, emergencia: bool = False }.

Referencias: `services/solver/app/solver/porciones.py:134-139`, `services/solver/app/solver/porciones.py:293-349`, `services/solver/DISENO.md:737-750`

## _porcionado_de_emergencia

_porcionado_de_emergencia(a, lo, hi, bandas) (l.273-290). Escala uniforme para cuadrar kcal; nunca optimo, pero siempre existe.

  objetivo_kcal = (L_kcal > -INF) ? L_kcal : 0.0
  si U_kcal < INF: objetivo_kcal = (objetivo_kcal + U_kcal) / 2
  denom = SUM_i a[kcal,i]
  s = (denom > 0) ? objetivo_kcal / denom : 1.0
  sigma = _cuantizar(clip(full(R, s), lo, hi), lo, hi)
  totales = a @ sigma ; error = error_de(totales, bandas) ; emergencia = True

Con ambas cotas finitas: objetivo_kcal = (T(1-tol)+T(1+tol))/2 = T exactamente.
Caso borde: si kcal esta INACTIVO (ambas cotas ±INF), objetivo_kcal = 0 -> s = 0 -> sigma = lo para todas. Replicar.

Se instrumenta con emergencia=True porque si aparece en produccion es un bug a perseguir, no un modo de operacion. **Implicacion para el port**: sin solver externo que pueda fallar, esta rama pasa a ser codigo muerto y el campo `emergencia` sera siempre false. Conviene conservarla como red de seguridad para R=0 o `a` degenerada, y documentar que el contador de emergencias deja de tener el mismo significado diagnostico.

Referencias: `services/solver/app/solver/porciones.py:273-290`, `services/solver/DISENO.md:752-772`

## culpabilidad — quien empuja en la direccion equivocada

culpabilidad(a, sigma, totales, bandas) -> float64[R] (l.352-365):

  (u^+, u^-) = desviaciones(totales, bandas)
  g[n]        = (w^-_n·u^-_n - w^+_n·u^+_n) / e_n          # direccion de NECESIDAD: g_n>0 falta ese nutriente, g_n<0 sobra
  aporte[n,i] = a[n,i]·sigma_i / e_n
  kappa[i]    = -SUM_n g[n]·aporte[n,i]

OJO: e_n aparece DOS veces, luego el termino efectivo es
  kappa_i = -SUM_n (w^-_n·u^-_n - w^+_n·u^+_n)·a[n,i]·sigma_i / e_n^2
Hay que replicar la doble normalizacion literalmente.

Semantica: kappa alto = culpable. Aportar mucho de lo que sobra sube kappa; aportar mucho de lo que falta lo baja. Funciona igual cuando el problema es de magnitud y no de composicion (si sobran kcal, la receta mas calorica es la mas culpable). Sustituye a la heuristica de la spec ("mayor distancia composicional al residuo"), que era ciega al resultado del LP.

Uso aguas abajo (reparacion.py:186-196): `np.argsort(-kappa, kind='stable')` y se toma el primer indice cuya fila no este vetada. Es decir **solo importa el ORDEN, y en la practica solo el primer elemento no vetado**; los empates se rompen por indice de slot ascendente (orden estable). Esto es relevante para los tests de paridad: kappa es una funcion pura y debe coincidir a 1e-12 con las MISMAS entradas, pero si sigma difiere entre Python y TS, kappa difiere legitimamente.

Referencias: `services/solver/app/solver/porciones.py:352-365`, `services/solver/app/solver/reparacion.py:186-196`

## EVALUACION (a) simplex denso acotado en TS

**Que habria que escribir**: simplex de variables acotadas (bounded-variable simplex) con dos fases o Big-M, sobre un problema de <=22 columnas x <=16 filas. Filas con cota inferior Y superior (rangos) -> hay que introducir variables de holgura con cotas dobles, lo cual el bounded-variable simplex maneja de forma natural (cada holgura s_n in [L_n, U_n]).

**A favor**:
- Es la unica opcion que reproduce la semantica exacta del optimo continuo, que es lo que Python calcula.
- DISENO.md §3.2 afirma que con el regularizador "el optimo es unico y no depende del solver". Si eso se cumple, cualquier simplex correcto da el MISMO sigma* que HiGHS hasta tolerancia numerica, y la paridad seria casi exacta.
- Cero dependencias, cero bundle extra (~15 KB minificado).

**En contra (y es decisivo)**:
- El LP es, por diseno propio, **masivamente degenerado**: DISENO.md §3.2 lo dice explicitamente ("toda una cara del politopo es optima"). Un simplex artesanal sobre un problema degenerado es el escenario clasico de ciclado. Hay que usar regla de Bland o test de razon lexicografico, con la penalizacion de velocidad correspondiente (irrelevante a este tamano) y, sobre todo, la carga de test.
- La afirmacion de unicidad del optimo NO esta demostrada, solo verificada empiricamente en un caso (4 recetas identicas). Con eps·||sigma-sigma_ref||_1 el objetivo sigue siendo lineal a trozos: si la cara optima no contiene sigma_ref, pueden persistir empates (p.ej. dos recetas con columnas a[:,i] identicas y ambos sigma por encima de su ref). En esos casos (a) volveria a elegir un vertice arbitrario y la paridad se rompe igual.
- Tolerancias: hay que elegir eps de pivote, de factibilidad y de optimalidad a mano. Un LP mal escalado (kcal ~2000, sodio ~2300 mg, fibra ~30 g, sigma ~1) invita a problemas; los e_n mitigan el escalado del objetivo pero NO el de la matriz A, que sigue teniendo coeficientes entre 0,5 (fibra) y 800 (sodio).

**Coste**: 400-600 LOC + suite de tests propia. Estimacion 3-5 dias de trabajo real hasta confiar en el.
**Riesgo**: alto. Es el mayor riesgo de correccion de todo el port, y ademas sigue necesitando el paso de cuantizacion y pulido, que es donde esta la brecha real de calidad.

Referencias: `services/solver/DISENO.md:535-562`, `services/solver/app/solver/porciones.py:157-176`

## EVALUACION (b) descenso coordinado ciclico sobre la rejilla de 0,05 — RECOMENDADA (variante b')

**Idea**: reutilizar _pulir_una como paso elemental y barrer j = 0..R-1 ciclicamente hasta que ninguna coordenada mejore, con multi-arranque.

**Estructura del problema (esto es lo que hace viable la opcion)**:
- E(sigma) es **convexa y lineal a trozos** en sigma: totales = A·sigma es lineal, y cada termino max(0, A_n - U_n) y max(0, L_n - A_n) es convexo. El objetivo del LP J(sigma) = W·E(sigma) + eps·||sigma - sigma_ref||_1 tambien es convexo lineal a trozos.
- El dominio REAL de las soluciones devolubles es finito: G = producto de las rejillas por coordenada, |G_i| <= 26.

**Limitacion honesta**: el descenso coordinado sobre una funcion convexa NO SUAVE cuya parte no suave NO es separable puede estancarse en un punto que no es minimo global (condicion de Tseng 2001: la convergencia se garantiza para f = suave + no-suave SEPARABLE; aqui los quiebres estan en las bandas de nutriente, que acoplan todas las coordenadas). Y sobre la rejilla el estancamiento es aun mas probable: el caso patologico concreto y realista es **kcal pegado al borde de banda con w=3,0** — cualquier movimiento de una sola coordenada de ±0,05 rompe kcal y cuesta mas de lo que gana en proteina, mientras que un movimiento compensatorio (+0,05 en i, -0,05·(a_kcal,i/a_kcal,j) en j) mantendria kcal y mejoraria proteina. Esto no es un riesgo teorico, es el modo de fallo esperado.

**Variante recomendada (b')**, tres correcciones sobre (b) puro:
1. **Objetivo del descenso = J = W·E(sigma) + eps·SUM_i |sigma_i - sigma_ref_i|**, no E puro. Esto (i) reproduce el desempate del regularizador, que DISENO.md justifica por calidad de producto ("media racion de lentejas y 1,8 de tostada" es incocinable) y por estabilidad entre versiones, y (ii) elimina el vagabundeo por mesetas donde E es constante. El E reportado sigue siendo error_de puro.
2. **Vecindad de pares (2-opt)** cuando el barrido de una coordenada se estanca y J sigue mejorable: para cada par (i,j), evaluar la rejilla producto (<=26x26 = 676 puntos). Con R=5 son C(5,2)=10 pares -> 6.760 evaluaciones por barrido de pares, ~50 ops cada una -> ~340 kops. Con 168 LP/semana son ~57 Mops -> del orden de 50-150 ms de JS por semana. Aceptable, y se puede activar solo si E > UMBRAL_ERROR_OK tras el descenso simple.
3. **Multi-arranque determinista, sin RNG**: cuantizar(sigma_ref), la escala uniforme de _porcionado_de_emergencia, todo-lo, todo-hi, y el sigma que iguala kcal por minimos cuadrados. Se queda el mejor por (J, luego E, luego orden lexicografico de sigma) para que el desempate sea total y reproducible.

**A favor**:
- ~150 LOC, la mitad ya especificada por _pulir_una.
- Cero dependencias, cero bundle, cero WASM, cero carga asincrona.
- Determinista por construccion: aritmetica float64 pura, sin RNG, sin pivoteo, sin tolerancias de solver. Esquiva de paso el segundo bloqueo (numpy PCG64) para este modulo, que de todas formas no usa RNG.
- **Optimiza exactamente la magnitud que se devuelve** (ver el hallazgo siguiente sobre la rejilla).

**Coste**: 0,5-1 dia. **Riesgo**: medio, y —esto es lo importante— **medible offline** contra Python antes de desplegar.

Referencias: `services/solver/app/solver/porciones.py:246-270`, `services/solver/DISENO.md:535-562`

## EVALUACION (c) libreria JS de LP existente

Candidatas que conozco, con lo que se y lo que hay que verificar antes de comprometerse:

**1. highs-js (npm `highs`, repo lovasoa/highs-js)** — build WASM del PROPIO HiGHS.
- Ventaja unica: es literalmente el mismo solver, misma version de algoritmo, misma semantica de degeneracion. Paridad maxima posible.
- Interfaz: se le pasa el modelo como cadena en formato CPLEX LP y devuelve un objeto con estado y valores de columna. **El formato LP de CPLEX no tiene filas con rango**, asi que las 6 filas de nutriente hay que partirlas en 12 desigualdades (L_n <= expr y expr <= U_n). Es equivalente y trivial, pero es una reescritura del modelo, no un paso del CSC.
- Cotas de variable inferior Y superior: si, el formato LP tiene seccion `Bounds` con `l <= x <= u`.
- Determinismo: si, mismo binario WASM + mismas entradas -> mismo resultado (HiGHS con threads=1 ya se verifico determinista en Python, 200/200).
- **No he verificado** el tamano exacto del .wasm, la version actual, ni el estado de mantenimiento del paquete. Debe comprobarse antes de adoptarlo. Mi estimacion, sin confirmar, es del orden de 1-2 MB, que sobre GitHub Pages es un lastre de carga considerable para una app cuyo motor completo son ~2.400 lineas.

**2. glpk.js / glpk-wasm** — build WASM de GLPK.
- Soporta variables con cota doble (GLP_DB) y filas con rango de forma nativa, luego el modelo se traslada 1:1 desde el CSC sin partir filas.
- Determinista (codigo C fijo).
- Mismo problema de bundle (~1-2 MB estimado, sin verificar) y de inicializacion asincrona.
- No es HiGHS: ante degeneracion elegira OTRO vertice. Con el regularizador eso deberia ser irrelevante, pero no esta garantizado.

**3. javascript-lp-solver (jsLPSolver) / YALPS** — simplex en JS puro.
- Variables no negativas por defecto; las cotas hay que expresarlas como restricciones adicionales. **No es un bloqueo real** en este modelo: todas las variables son no negativas (sigma_i >= l_i >= 0 con l_i por defecto 0,6, y u^±, t >= 0), y basta la sustitucion sigma_i = l_i + s_i con s_i in [0, u_i - l_i] para dejar el modelo en forma estandar no negativa.
- Deterministas (JS puro, iteracion de claves en orden de insercion).
- **Riesgo alto de robustez numerica sobre un LP masivamente degenerado**; son implementaciones ligeras pensadas para modelos de negocio bien condicionados. YALPS (reescritura TS moderna de jsLPSolver) es la mejor de las dos, pero **no he verificado** su comportamiento con degeneracion ni su version actual.

**Sobre GitHub Pages**: servir un .wasm es solo un asset estatico y funciona; el coste real es peso de descarga + inicializacion asincrona, que obliga a que resolverPorciones sea async o a un await de arranque antes de generar el primer plan.

Referencias: `services/solver/app/solver/porciones.py:157-230`

## EL PUNTO CLAVE: sigma se devuelve SIEMPRE cuantizado — que implica para la optimalidad de (b)

Definiciones: G = rejilla admisible producto (<=26 puntos por coordenada); sigma* = optimo continuo del LP sobre la caja; Q(·) = _cuantizar.

Lo que Python devuelve es **Q(sigma*)**, mas —solo si las kcal se salieron de banda— un pulido de UNA coordenada. Por tanto:

  min_continuo E  <=  min_{sigma in G} E  <=  E(Q(sigma*))

es decir, **Python NO es optimo sobre la rejilla, que es el unico conjunto de soluciones que puede devolver**. Python resuelve exactamente un problema que no es el que importa, y luego redondea sin reoptimizar (salvo el parche 1-D de kcal).

**Magnitud de la brecha**: cada coordenada se mueve como mucho q/2 = 0,025, luego |delta_totales[n]| <= 0,025·SUM_i |a[n,i]|. Con R=5 recetas de ~400 kcal por racion base: hasta 50 kcal de desplazamiento. Y —punto crucial— **el optimo del LP tipicamente REPOSA SOBRE el borde de banda** (los optimos de LP estan en la frontera), asi que el redondeo lo saca fuera con alta probabilidad. Un u^+ de 50 kcal sobre e_kcal=2000 con w=3,0 y W=8,3 aporta a E:

  dE = 3,0 · (50/2000) / 8,3 ~= 0,009

Es decir ~0,9 puntos de E, sobre un umbral de aceptacion de 0,04. **No es despreciable: es del orden del 20-25 % del presupuesto de error.** Y Python solo lo corrige en el eje kcal y moviendo una coordenada.

**Consecuencia para (b)**: un descenso coordinado sobre G que minimice J converge a un punto **estable por coordenada** (y por pares, con la vecindad ampliada) que en general sera **igual o MEJOR en E** que Q(sigma*). No es "una aproximacion peor que el LP": es una heuristica distinta sobre el mismo conjunto finito, compitiendo contra otra heuristica (LP + redondeo) que tampoco es optima ahi.

**El unico caso en que (b) puede perder** es el estancamiento en minimo local no global (nutriente de peso alto pegado a un borde bloqueando los movimientos unidimensionales). La vecindad de pares y el multi-arranque desde Q(sigma_ref) —que es exactamente el ancla que el LP usa— acotan ese riesgo, y la comparacion offline contra Python lo cuantifica.

**Reencuadre de la pregunta**: la pregunta correcta no es "como reproduzco HiGHS en el navegador" sino "como minimizo J sobre una rejilla de <=26^5 puntos". Formulada asi, un solver de LP continuo es un medio indirecto y (b') es directo.

Referencias: `services/solver/app/solver/porciones.py:329-349`, `services/solver/app/solver/porciones.py:233-243`, `services/solver/app/solver/porciones.py:254-261`

## RECOMENDACION razonada, con coste y riesgo

**Recomiendo (b') como implementacion de produccion, con (c)/highs-js documentado como plan B detras de una interfaz.**

Orden de preferencia: **(b') > (c) highs-js > (c) glpk.js > (a) > (c) jsLPSolver/YALPS**.

Plan concreto:
1. Definir en TS la interfaz `interface ResolverPorciones { (a, lo, hi, sigmaRef, bandas): ResultadoPorcionado }`, sincrona. Todo lo demas del motor depende solo de esa firma.
2. Implementar `resolverPorcionesRejilla` (b'): descenso coordinado ciclico sobre J = W·E + eps·||sigma - sigmaRef||_1, barrido en orden j = 0..R-1, aceptando solo mejoras estrictas, desempate hacia el punto mas bajo de la rejilla (igual que argmin); tras estancarse, si E > 0,04, barrido de pares; multi-arranque determinista (Q(sigmaRef), escala uniforme de emergencia, todo-lo, todo-hi). Devolver siempre totales = A·sigma_final y error = error_de(totales) puro.
3. Portar SIN cambios (son funciones puras, paridad exacta esperada): `bandas_de`, `desviaciones`, `error_de`, `culpabilidad`, `_cuantizar`, `_rejilla`, `_pulir_una`, `_porcionado_de_emergencia`.
4. Construir el arnes de paridad (siguiente hallazgo) y medir ANTES de dar por bueno el port.
5. **Puerta de decision explicita, fijada de antemano**: si sobre >=2.000 instancias reales p95(E_ts - E_py) > 0,005, o si mas del 1 % de las instancias cambian de bucket de umbral (0,04 / 0,12) en direccion de empeorar, se cambia a (c) highs-js.

**Costes** (estimacion de trabajo real, no de lineas):
| Opcion | LOC nuevas | Esfuerzo | Bundle | Riesgo de correccion |
|---|---|---|---|---|
| (b') rejilla | ~150 | 0,5-1 dia | 0 KB | medio (optimo local), medible |
| (c) highs-js | ~60 (serializar a formato LP) + init async | 0,5-1 dia + verificacion | ~1-2 MB (SIN VERIFICAR) | bajo, dependencia externa |
| (c) glpk.js | ~80 (mapear CSC) + init async | 1 dia + verificacion | ~1-2 MB (SIN VERIFICAR) | bajo-medio |
| (a) simplex propio | 400-600 | 3-5 dias | ~15 KB | **alto** (degeneracion, ciclado, tolerancias) |
| (c) jsLPSolver/YALPS | ~80 | 1 dia | ~20-50 KB | alto (robustez en degeneracion) |

**Por que (b') y no (c)**, aun siendo (c) menos codigo: (i) el objetivo declarado del despliegue es validar el funcionamiento real, y la magnitud que valida el producto es E, no el vertice — y (b') optimiza E directamente sobre el conjunto devolvible; (ii) 1-2 MB de WASM en GitHub Pages para un LP de 22 columnas es desproporcionado; (iii) (b') no introduce inicializacion asincrona en el camino critico del motor; (iv) el riesgo de (b') es acotado y medible, el de una dependencia WASM no mantenida no lo es.

**Por que NO (a)**: es simultaneamente el mayor esfuerzo y el mayor riesgo, y su unica ventaja sobre (c) —no depender de un binario externo— la tiene tambien (b') con una decima parte del codigo. Escribir un simplex a mano para un LP que el propio DISENO.md califica de masivamente degenerado es el peor sitio donde gastar el presupuesto de riesgo del port.

Referencias: `services/solver/DISENO.md:535-562`, `services/solver/DISENO.md:1143-1157`

## Como testear la paridad TS vs Python de forma honesta

**Principio**: no se puede exigir el mismo vertice, porque el LP es degenerado por diseno y porque (b') ni siquiera resuelve el mismo problema (resuelve el discreto, que es el que importa). Lo que SI es comparable, en orden de valor:

**A. Magnitudes comparables (comparacion Python vs TS)**
1. **E = error_de(totales, bandas) del sigma devuelto.** Es la magnitud invariante frente a la eleccion de vertice y es la que consume el producto. No exigir igualdad: exigir **E_ts <= E_py + tau** con tau pequeno (p.ej. 1e-9 para el caso ideal), y reportar la distribucion completa de (E_ts - E_py): p50, p95, max, y % de instancias con E_ts <= E_py. La expectativa razonada es que E_ts sea MENOR en la mayoria de casos (ver hallazgo de la rejilla). Un test que exigiera E_ts == E_py seria deshonesto: fallaria cuando TS mejora.
2. **Bucket de umbral**: en que franja cae E (<=0,04 / (0,04, 0,12] / >0,12). Es lo unico que cambia el comportamiento observable (dispara reparacion, dispara ok:false). Exigir concordancia del 100 % o justificar cada discrepancia una a una.
3. **Valor objetivo del LP continuo**, SOLO si se elige (a) o (c): z = W·E'(sigma*) + eps·||sigma*-sigma_ref||_1. El valor optimo es UNICO aunque el argmin no lo sea. Exigir |z_ts - z_py| <= 1e-7·(1+|z_py|). Este es el test de paridad de LP correcto; comparar sigma* no lo es.
4. **Distancia agregada, no elemento a elemento**: ||sigma_ts - sigma_py||_1 y max_i |sigma_ts_i - sigma_py_i| como METRICA REPORTADA (histograma), nunca como asercion dura.

**B. Funciones puras: paridad EXACTA, sin excusas.** `bandas_de`, `desviaciones`, `error_de`, `culpabilidad`, `_cuantizar`, `_rejilla`, `_pulir_una`, `_porcionado_de_emergencia` no dependen del solver. Volcar desde Python un JSONL de (entrada -> salida) y exigir coincidencia a 1e-12 (o bit a bit en float64). Si estas fallan, no hay nada que discutir sobre el solver. Especial atencion a `culpabilidad`: con sigma IDENTICO de entrada debe coincidir exactamente; y ademas debe coincidir el ORDEN de argsort descendente estable, que es lo unico que se consume aguas abajo.

**C. Invariantes absolutos, verificables en ambos lados sin comparar entre si**
- totales == A·sigma a 1e-9 (es el `test_totales_coinciden_con_items` de DISENO.md §8.2: el bug mas caro posible).
- sigma_i in [l_i, u_i] para todo i.
- sigma_i esta en la rejilla: |sigma_i/0,05 - round(sigma_i/0,05)| < 1e-9, o sigma_i == l_i, o sigma_i == u_i.
- E >= 0, y E == 0 <=> todos los totales dentro de banda.
- Asimetrias de peso: un defecto de proteina de X g penaliza 2,5x un exceso de X g; sodio por debajo del maximo cuesta 0; fibra por encima del minimo cuesta 0.
- Monotonia: anadir sigma que empeora un nutriente fuera de banda no puede bajar E si los demas no cambian.

**D. Golden vectors analiticos** (portar literalmente los tests de DISENO.md §8.2, que son independientes del solver): `test_lp_optimo_analitico_dos_recetas`, `test_lp_cotas_activas`, `test_lp_error_cero_dentro_de_rango`, `test_lp_asimetria_proteina`, `test_lp_sodio_solo_penaliza_exceso`, `test_lp_fibra_solo_penaliza_defecto`, `test_cuantizacion_conserva_banda`. El mas valioso es **`test_lp_banda_muerta_no_mueve_sigma`**: si sigma_ref ya cae dentro de todas las bandas, el optimo es UNICO y vale exactamente sigma_ref -> ahi si se puede exigir igualdad de sigma. Es el unico caso en que exigir el mismo punto es legitimo.

**E. Determinismo interno de TS** (espejo de `test_lp_degenerado_es_estable`): 200 ejecuciones del mismo input -> sigma identico bit a bit. No compara con Python, compara TS consigo mismo.

**F. Arnes de datos**: generar desde Python un JSONL con >=2.000 instancias {a (6xR), lo, hi, sigma_ref, objetivo, activos} tomadas de ejecuciones reales del catalogo sintetico con semillas fijas (cubriendo R=1..5, nutrientes desactivados, cotas activas, objetivos inalcanzables) junto con la salida Python {sigma, totales, error, emergencia}. El runner TS corre en Node sobre el mismo JSONL. **Es imprescindible aislar la Etapa B**: la Etapa A depende de numpy SeedSequence/PCG64 (el otro bloqueo), asi que las selecciones de receta se INYECTAN desde el volcado de Python; comparar planes de extremo a extremo no valida nada mientras el RNG no este portado.

**G. Lo que NO se debe aseverar**: igualdad de sigma componente a componente (salvo el caso D de optimo unico), igualdad de la base optima, igualdad de u^+/u^-, igualdad del numero de iteraciones, ni igualdad del flag `emergencia` (en TS deja de dispararse por time_limit).

Referencias: `services/solver/DISENO.md:1245-1259`, `services/solver/app/solver/porciones.py:118-131`, `services/solver/app/solver/porciones.py:352-365`

## Lo que NO he podido verificar (no inventar)

Declarado explicitamente para que nadie lo tome por comprobado:
1. **No he verificado** en este entorno la existencia, version actual, API exacta, estado de mantenimiento ni tamano de bundle de `highs-js` (npm `highs`), `glpk.js`/`glpk-wasm`, `javascript-lp-solver` ni `yalps`. Todo lo que digo sobre ellos es conocimiento previo y **debe comprobarse con `npm view` / lectura del README antes de comprometer la arquitectura**. En particular el tamano del .wasm (mi estimacion de 1-2 MB es eso, una estimacion) y si highs-js sigue exponiendo `solve(lpFormatString)`.
2. **No he demostrado** que el optimo del LP con el regularizador sea unico. DISENO.md lo afirma y lo verifico empiricamente en UN caso (4 recetas identicas, 200/200 estables). Mi analisis dice que es generico pero no garantizado: si la cara optima no contiene sigma_ref, el termino L1 puede seguir empatado. Esto afecta a la premisa de que (a) o (c) darian paridad exacta con HiGHS.
3. **No he medido** la brecha real E_ts - E_py; el calculo de ~0,009 es una cota de orden de magnitud derivada analiticamente (0,025 de desplazamiento maximo por coordenada, w_kcal=3,0, W=8,3), no una medicion. Hay que medirla con el arnes del hallazgo anterior.
4. **No he leido** motor.py, semanal.py, scoring.py ni diagnostico.py; solo porciones.py completo, DISENO.md §3 (y §7-§8 para contexto) y las partes de reparacion.py y __init__.py que consumen este modulo. Si hay otros consumidores de `ResultadoPorcionado` o de `culpabilidad`, no los he visto.
5. **No he cronometrado** la implementacion (b') en JS; los ~50-150 ms/semana salen de contar operaciones, no de un benchmark.

## Riesgos

- **[alta]** El descenso coordinado (opcion b) se estanca en un minimo local no global. Caso concreto y esperable: kcal (peso 3,0) pegado al borde de banda bloquea todo movimiento unidimensional de +-0,05, mientras que un movimiento compensatorio en dos recetas mantendria kcal y mejoraria proteina. Resultado: E_ts > E_py en instancias apretadas.
  - Mitigación: Anadir vecindad de pares (2-opt) sobre la rejilla producto (<=26x26 por par, C(5,2)=10 pares, ~340 kops por barrido) activada cuando el descenso simple se estanca con E > 0,04. Multi-arranque determinista desde Q(sigma_ref), escala uniforme de emergencia, todo-lo y todo-hi. Puerta de decision pre-registrada: si p95(E_ts - E_py) > 0,005 sobre >=2.000 instancias, cambiar a highs-js WASM.
- **[alta]** Se adopta una dependencia WASM (highs-js / glpk.js) sin verificar su tamano, API o mantenimiento, y resulta ser 2 MB o estar abandonada, lastrando el bundle de GitHub Pages o bloqueando el proyecto.
  - Mitigación: Verificar con npm view + descarga real del .wasm ANTES de decidir. Mantener resolverPorciones detras de una interfaz sincrona para poder cambiar de implementacion sin tocar el resto del motor. No poner una carga asincrona en el camino critico del arranque de la app.
- **[media]** np.round usa redondeo bancario (half-to-even, np.round(20.5)=20) y Math.round de JS redondea half-away-from-zero (21). _cuantizar diverge en los sigma que caen exactamente a mitad de paso, produciendo sigma con un paso de rejilla de diferencia y, por efecto domino, un E distinto.
  - Mitigación: Implementar roundHalfToEven(x) en TS y usarlo en _cuantizar. Anadir un test de tabla con los valores frontera (k*0,05 + 0,025 para k = 12..36) comparado contra un volcado de np.round.
- **[media]** _cuantizar ancla la rejilla en 0 (multiplos de 0,05) mientras que _rejilla la ancla en lo. Si alguna receta trae un escalaMin que no sea multiplo de 0,05, _pulir_una puede devolver un sigma que _cuantizar nunca produciria, y las dos rutas del codigo dejan de ser consistentes. Verificado con lo=0,7333.
  - Mitigación: Decidir explicitamente y documentar: recomiendo unificar en la rejilla anclada en 0 (multiplos de 0,05 clipados a [lo,hi], mas los propios lo y hi como puntos admisibles) y pre-registrar esa divergencia en los tests de paridad para que no se lea como un fallo del port. Alternativa: portar bug por bug y anadir un test que fije el comportamiento.
- **[media]** El orden de reduccion en coma flotante difiere: numpy usa BLAS (con FMA y sumas por bloques) para a @ sigma, TS usara un bucle ingenuo. Diferencias de 1e-16 pueden voltear un argmin empatado en _pulir_una y cambiar sigma en un paso completo de rejilla.
  - Mitigación: Nunca comparar sigma componente a componente en los tests de paridad; comparar E y el bucket de umbral. Desempatar en _pulir_una con comparacion estrictamente menor recorriendo la rejilla en orden ascendente (replica exacta de np.argmin). Si hace falta mas robustez, redondear el error a ~1e-12 antes de comparar.
- **[alta]** Escribir un simplex propio (opcion a) sobre un LP que DISENO.md califica de masivamente degenerado provoca ciclado o convergencia a un vertice incorrecto, y el fallo aparece en produccion como un plan absurdo, no como una excepcion.
  - Mitigación: No elegir la opcion (a). Si se eligiera pese a todo: regla de Bland o test de razon lexicografico obligatorio, contador de iteraciones con tope duro, y validacion cruzada de cada solucion contra las condiciones KKT/complementariedad antes de aceptarla.
- **[baja]** El flag emergencia deja de dispararse en TS (no hay time_limit ni fallo de solver), con lo que el contador diagnostico de porcionado de emergencia pierde su significado y una regresion real pasa inadvertida.
  - Mitigación: Conservar _porcionado_de_emergencia como red para R=0 o matriz a degenerada, y sustituir la instrumentacion por un contador nuevo: numero de instancias en las que el descenso termino con E > UMBRAL_ERROR_ACEPTABLE, o en las que el barrido de pares fue necesario.
- **[baja]** Si todos los nutrientes quedan inactivos, peso_total = 0 y error_de devuelve 0,0: el plan se acepta con E=0 sin ningun control nutricional. Es el comportamiento de Python y hay que replicarlo, pero en un despliegue de validacion puede leerse como exito falso.
  - Mitigación: Replicar el comportamiento exacto (return 0.0 si W <= 0) pero exponer en la traza si el numero de nutrientes activos es menor que 6, para que la validacion en GitHub Pages no confunda 'sin datos' con 'objetivo alcanzado'.
- **[media]** El valor comparable E depende de bandas_de, que a su vez depende de `activos`, calculado en reparacion.py a partir de la cobertura de datos del pool (FRACCION_MINIMA_FIBRA, conocido[:,IDX_SODIO].all()). Si el port de esa logica difiere, E_ts y E_py dejan de ser comparables aunque el porcionado sea correcto.
  - Mitigación: Inyectar `activos` y `bandas` ya calculados desde el volcado de Python en el arnes de paridad de la Etapa B, y testear nutrientes_activos por separado como funcion pura con sus propios golden vectors.

---

# scoring

`scoring.py` implementa la etapa 0 (construcción del pool) y la etapa A (selección estocástica). El score de una receta r para un slot s es una combinación lineal de siete términos, todos normalizados a [0,1], con pesos fijos en `app/solver/__init__.py`: S = 4,0·fit + 2,0·esc + 1,5·desp + 1,2·sol + 0,0·afin − peso_coste·cost − 2,0·rep, donde `peso_coste` es la única ponderación dinámica (1,5 o 0). El rango real es [−3,5, 8,7] (el DISENO dice [−3,5, 9,5] porque su fórmula escrita usa 0,8·afin, pero el código fija W_AFIN = 0,0: es una discrepancia doc/código que hay que respetar, no "arreglar").
Los términos se calculan sobre TODO el pool de golpe: un producto matriz-vector (P,3)×(3,) para `fit`, dos `np.where` anidados para `esc`, dos `bitwise_count` sobre bitsets (P,W) uint64 para `desp` y `sol`, un `clip` para `cost` y un array precalculado por petición para `rep`. Las recetas inadmisibles reciben −inf.
Dos constantes gobiernan comportamiento no obvio: `DECAIMIENTO_REPETICION` = 0,85 elevado a `floor(pos/|S|)` sobre `recetasRecientes` (sólo la primera aparición cuenta, pero las posiciones duplicadas SÍ consumen índice), y `FRACCION_MINIMA_PRECIOS` = 0,80, por debajo de la cual el término de coste se apaga entero (peso 0) y se anota en la traza.
Para el port a TS el módulo en sí es matemática elemental y directa, sin dependencias exóticas: el trabajo real es (1) reescribir ~18 operaciones vectorizadas como bucles sobre TypedArrays, (2) implementar popcount sobre uint64 sin BigInt, y (3) decidir qué nivel de fidelidad numérica se exige. La reproducibilidad bit a bit contra el Python NO es alcanzable sin reimplementar PCG64 + SeedSequence(spawn_key) + el algoritmo exacto de `Generator.choice(p=...)` y sin emular float32; eso es el riesgo dominante y hay que decidirlo explícitamente antes de escribir código.

## Pesos, constantes y rango real del score

Todas viven en `app/solver/__init__.py` (líneas 78-88):

```python
W_FIT, W_ESC, W_DESP, W_SOL, W_AFIN = 4.0, 2.0, 1.5, 1.2, 0.0   # §2.2
W_COST, W_REP = 1.5, 2.0                                        # §2.2
DECAIMIENTO_REPETICION = 0.85                                   # §2.2f
FRACCION_MINIMA_PRECIOS = 0.80
TOP_K = 25
TAU_MIN, TAU_MAX = 0.12, 1.5
VARIEDAD_POR_DEFECTO = 45
PESO_SLOT = {"desayuno":0.22, "almuerzo":0.10, "comida":0.35, "merienda":0.10, "cena":0.28}
```

Expresión final (scoring.py:377-386):

```python
s = (W_FIT*fit + W_ESC*esc + W_DESP*desp + W_SOL*sol + W_AFIN*afin
     - ctx.peso_coste*cost - W_REP*ctx.pen_rep)
return np.where(admisible, s.astype(np.float32), -np.inf)
```

**`ctx.peso_coste` es el ÚNICO peso dinámico**: vale `W_COST` (1,5) o `0.0`. Los otros seis son constantes de módulo.

**Rango.** Con todos los φ en [0,1]: máximo 4,0+2,0+1,5+1,2 = **8,7**; mínimo −1,5−2,0 = **−3,5**. DISENO.md:235 afirma [−3,5, 9,5] porque su LaTeX (línea 228) escribe `+ 0,8·φ_afin` mientras el código fija W_AFIN = 0,0 y `afin = zeros` (scoring.py:374-375). **Es una discrepancia real entre documento y código.** El texto de DISENO §2.2(g) (líneas 338-340) confirma que el peso efectivo correcto es 0. Al portar hay que copiar el CÓDIGO (0,0), no la fórmula del documento; cambiarlo alteraría todos los planes.

**τ (temperatura).** `temperatura(v) = TAU_MIN * (TAU_MAX/TAU_MIN)**(v/100)`, con v = `VARIEDAD_POR_DEFECTO` = 45 → τ ≈ 0,3706. `motor.py:265` la fija por petición; `reparacion.py:217` la escala con `tau*(1 + 0.25*k)` en los reintentos. τ no interviene en el score, sólo en el muestreo.

**`VERSION_GENERADOR` = "1.0.0"**: el docstring de `__init__.py` exige subirlo si se toca cualquier constante. Un port a TS que cambie números debe cambiarla.

## Admisibilidad y vetos blandos: lo que ocurre ANTES de sumar términos

`score_slot` (scoring.py:306-325) construye la máscara antes de puntuar:

```python
admisible = pool.m_slot[:, IDX_SLOT[slot]] & ~excluidas
admisible &= pool.minutos <= ctx.topes.get(slot, SIN_LIMITE_MINUTOS)

estricto = admisible.copy()
if ctx.veto_semana is not None:
    estricto &= ~ctx.veto_semana
veto_ayer = ctx.veto_slot.get(slot)
if veto_ayer is not None:
    estricto[veto_ayer] = False
if estricto.any():
    admisible = estricto
```

Puntos que hay que replicar exactamente:

1. `SIN_LIMITE_MINUTOS = 32767` (scoring.py:41) es el máximo de `int16`, no un centinela arbitrario: `pool.minutos` es `int16`. En TS con `Int16Array` el valor tiene que ser el mismo o la comparación cambia.
2. **El tope de minutos es POR SLOT.** El nivel 1 del pool ya filtró por `max(topes[s] for s in restr.slots)` (scoring.py:149-151), que es una cota laxa; el filtro fino por slot se aplica aquí y sólo aquí. `topes_por_slot` (scoring.py:133-142) rellena TODOS los slots de `SLOTS` con 32767 si no aparecen en `minutosMaxPorSlot`.
3. **Los vetos de variedad semanal ceden si dejan el conjunto vacío** (`if estricto.any()`). Es, literalmente según el comentario, la única restricción del servicio que cede, y cede porque no es de seguridad. Un port que los aplique como filtro duro producirá fallos donde el Python devuelve plan.
4. `veto_slot` mapea slot → fila del pool elegida ayer (un único int), y se aplica con asignación escalar `estricto[veto_ayer] = False`.
5. `excluidas` es la máscara de "ya elegidas hoy" más las vetadas de la reparación; `seleccionar_dia` la actualiza con `excl[j] = True` tras cada slot (scoring.py:481).

Los términos φ se calculan para TODAS las filas del pool (también las inadmisibles) y sólo al final se sustituyen por −inf. Es desperdicio deliberado por vectorización; en TS conviene evaluarlo (saltar filas inadmisibles ahorra trabajo real y no cambia el resultado, porque el valor descartado nunca se lee).

## (a) W_FIT = 4,0 — encaje composicional por distancia angular

**Qué mide.** Cuánto se parece el perfil de macros de la receta al perfil de macros que le FALTA al día (el residuo). Es el término dominante (peso 4,0, casi la mitad del rango positivo).

**Cómo se calcula** (scoring.py:287-338):

```python
def vector_macro(residuo):                      # residuo es (6,) float64
    macros = np.maximum(residuo[1:4], 0.0)      # [proteína, carbohidrato, grasa]
    kcal   = np.array([4.0, 4.0, 9.0]) * macros # Atwater
    total  = kcal.sum()
    if total <= 0: return np.zeros(3, dtype=np.float32)
    frac   = kcal / total
    norma  = float(np.linalg.norm(frac))
    if norma <= 0: return np.zeros(3, dtype=np.float32)
    return (frac / norma).astype(np.float32)

v_res = vector_macro(residuo)
if np.any(v_res):
    cos = pool.v_macro @ v_res                              # (P,3)·(3,) -> (P,)
    fit = 1.0 - (2.0/np.pi) * np.arccos(np.clip(cos, -1.0, 1.0))
    fit = np.where(pool.tiene_macro, fit, 0.5).astype(np.float32)
else:
    fit = np.full(pool.p, 0.5, dtype=np.float32)
```

**Datos del catálogo necesarios.**
- `v_macro (N,3) float32`, norma L2 = 1, precalculado al cargar (DISENO.md:122-135, app/catalogo.py:170-187). Fórmula: k_macro = 4P + 4C + 9G; f = (4P, 4C, 9G)/k_macro; v = f/‖f‖₂. **Se usa la kcal derivada de Atwater, NO la kcal declarada del panel**: si el panel dice 320 y los macros suman 298, la fracción no sumaría 1 y el coseno se sesga. La kcal declarada sigue usándose en residuo, LP y totales.
- `tiene_macro (N,) bool` = `kcal_macro > 0` (catalogo.py:177). False para café solo / infusiones.

**Normalización.** `cos ∈ [-1,1]` por el clip → `arccos ∈ [0,π]` → `fit ∈ [-1,1]` formalmente. En la práctica ambos vectores viven en el octante no negativo, así que `cos ≥ 0` y **fit ∈ [0,1]**.

**Por qué arccos y no coseno crudo** (DISENO.md:248-265, medido sobre el catálogo real de 36 recetas): el coseno tiene mediana 0,946 y desviación típica 0,064; la transformación angular baja la mediana a 0,789 y **multiplica la desviación típica por 1,66×** (0,106). Como el softmax estandariza por σ, el factor no cambia probabilidades por sí solo; lo que cambia es la FORMA — arccos es lineal donde el coseno es plano, así que el orden del top-k deja de depender del ruido de float32. **No sustituir por coseno crudo en el port.**

**Dos casos neutros de 0,5, distintos entre sí:**
- `tiene_macro[r] == False` → fit[r] = 0,5 (una infusión ni encaja ni desencaja).
- residuo con todos los macros ≤ 0 (día ya cubierto) → `v_res` es el vector nulo, `np.any(v_res)` es False, y fit = 0,5 para TODO el pool; entonces el término no discrimina y deciden los demás.

**Trampa del port:** `vector_macro` clampa a 0 **componente a componente** (`np.maximum(residuo[1:4], 0.0)`), no el vector entero. Un residuo con proteína negativa y carbohidrato positivo da un vector válido con la proteína a cero.

## (b) W_ESC = 2,0 — encaje de escala (cociente, nunca resta)

**Qué mide.** Si el factor de ración que haría falta para cubrir la cuota calórica del slot cae dentro de las cotas de escalado de la receta.

**Cómo se calcula** (scoring.py:340-350):

```python
kcal_r = np.maximum(pool.nutr[:, IDX_KCAL], 1e-6)
eta = (max(residuo[IDX_KCAL], 0.0) * ctx.cuota.get(slot, 1.0)) / kcal_r
esc = np.where(
    eta < pool.escala_min,
    eta / np.maximum(pool.escala_min, 1e-6),
    np.where(eta > pool.escala_max, pool.escala_max / np.maximum(eta, 1e-6), 1.0),
).astype(np.float32)
```

Es decir: 1 si ℓ ≤ η ≤ u; η/ℓ si η < ℓ; u/η si η > u.

**Datos del catálogo.** `nutr[:,0]` (kcal por ración base), `escala_min` (por defecto 0,6) y `escala_max` (por defecto 1,8), constantes `ESCALA_MIN_POR_DEFECTO`/`ESCALA_MAX_POR_DEFECTO` en `__init__.py:110`. Se leen de los campos `escalaMin`/`escalaMax` del JSONL (catalogo.py:144).

**Normalización.** Cae siempre en (0,1] por construcción, salvo el caso η = 0 → esc = 0.

**Por qué cociente y no resta** (DISENO.md:285-289): la fórmula de la spec (`1 - |clamp - needed|`) mezcla unidades y castiga brutalmente a las recetas de pocas calorías. El cociente es invariante a escala y penaliza igual "necesito la mitad" que "necesito el doble" — la simetría correcta.

**Cuidado en el port:**
- `ctx.cuota` es el reparto renormalizado (`cuotas_de`), no `PESO_SLOT` crudo.
- Si el residuo de kcal ya es ≤ 0 (día cubierto), η = 0 → `0 < escala_min` → **esc = 0 para todo el pool**, no 1. Es uniforme, así que tampoco discrimina, pero desplaza el score absoluto en −2,0 y por tanto afecta a la media/σ del z-score del muestreo. Reproducirlo tal cual.
- Los tres guardas `1e-6` (kcal, escala_min, eta) evitan divisiones por cero y hay que copiarlos: en JS una división por 0 da Infinity, no una excepción, y contaminaría el score sin avisar.

## (c) W_DESP = 1,5 — despensa (cobertura por bitset)

**Qué mide.** Qué fracción de los ingredientes de la receta ya está en casa.

**Cómo se calcula** (scoring.py:352-357):

```python
n_seguro = np.maximum(pool.n_ingr.astype(np.float32), 1.0)
desp = (np.bitwise_count(pool.bits & ctx.bits_despensa).sum(axis=1).astype(np.float32)
        / n_seguro)
```

`pool.bits` es `(P, W) uint64` con W = ceil(M/64), M ≈ 600 alimentos → W ≈ 10. `ctx.bits_despensa` es `(W,) uint64`, difundido por broadcasting sobre las P filas.

**Construcción del bitset** (`bits_de`, scoring.py:121-130):

```python
palabras = cat.ingr_bits.shape[1]
fila = np.zeros(palabras, dtype=np.uint64)
for aid in alimento_ids:
    bit = cat.alimento_idx.get(aid)
    if bit is None: continue          # id desconocido: se ignora en silencio
    fila[bit >> 6] |= np.uint64(1) << np.uint64(bit & 63)
```

**Datos del catálogo.** `ingr_bits (N,W) uint64`, `n_ingredientes (N,) int16` (popcount precalculado, en realidad `len(f["ingredientes"])`, catalogo.py:162) y el diccionario `alimento_idx: alimentoId -> bit`. Del contrato: `restr.despensaAlimentoIds`.

**Normalización.** [0,1] mientras `n_ingredientes` coincida con el popcount de la fila; si el JSONL trae ingredientes duplicados o alimentos que no entran en el índice, el denominador es mayor y el término queda por debajo de 1. No es un bug a corregir en el port: es el comportamiento actual.

**Gancho no implementado** (DISENO.md:297-301): la ponderación por urgencia de caducidad NO es computable con el contrato actual (`despensaAlimentoIds` no trae `expiresOn`) y **deliberadamente no se inventa**. Cuando llegue, se sustituye el numerador por Σ urg(i) con urg(i) = clip(1 − días_a_caducar/7, 0,2, 1). No implementarlo en el port.

## (d) W_SOL = 1,2 — solape semanal (cobertura, NO Jaccard)

**Qué mide.** Qué fracción de los ingredientes de la receta ya está comprometida en los días de la semana ya cerrados, es decir, cuántas líneas NUEVAS añade a la lista de la compra.

**Cómo se calcula** (scoring.py:358-366) — idéntico a `desp` cambiando el bitset:

```python
sol = (np.bitwise_count(pool.bits & ctx.bits_semana).sum(axis=1).astype(np.float32)
       / n_seguro)
```

**Dato requerido.** `ctx.bits_semana (W,) uint64`, inicializado a ceros en `contexto_de` (scoring.py:271) y **mutado desde la etapa D**: `semanal.py:101` hace `ctx.bits_semana = ctx.bits_semana | mejor.bits` tras cerrar cada día con su mejor candidato provisional (menor error). El primer día vale 0 y el término no distorsiona.

**Por qué cobertura y no Jaccard** (DISENO.md:309-313, y el comentario in-line scoring.py:358-362): Jaccard divide por la unión, que crece con los días ya planificados, así que el mismo solape puntúa cada vez menos y **hacia el viernes el término se apaga solo**. La cobertura mide exactamente lo que se quiere maximizar. No sustituir por Jaccard.

**Consecuencia de arquitectura para el port:** este término impone que **los días se generen EN ORDEN** (`semanal.py:55-102`, comentario explícito en líneas 66-70). Es un acoplamiento consciente. Un port a TS que paralelice o reordene la generación de días producirá planes distintos.

## (e) W_COST = 1,5 — coste y su apagado por FRACCION_MINIMA_PRECIOS

**Qué mide.** Cuánto se pasa el coste por ración de la receta respecto al presupuesto por comida.

**Umbral, calculado una vez por petición** (`contexto_de`, scoring.py:256-265):

```python
peso_coste, umbral, motivo = W_COST, 0.0, None
presupuesto = restr.presupuestoSemanalCents
if presupuesto is None or presupuesto <= 0:
    peso_coste, motivo = 0.0, "sin_presupuesto"
elif pool.p == 0 or float(pool.coste_conocido.mean()) < FRACCION_MINIMA_PRECIOS:
    peso_coste, motivo = 0.0, "precios_incompletos"
else:
    umbral = presupuesto / max(1, n_dias * len(slots) * max(1, restr.comensales))
```

**Término** (scoring.py:368-372):

```python
if ctx.peso_coste > 0.0:
    b = max(ctx.umbral_coste, 1e-6)
    cost = np.clip((pool.coste_cents.astype(np.float32) - b) / b, 0.0, 1.0)
else:
    cost = np.zeros(pool.p, dtype=np.float32)
```

El `max(0, c−b)` del documento (DISENO.md:319) está implícito en el límite inferior del clip. Normalización: [0,1]; vale 0 hasta el umbral y satura en 1 al doble del umbral.

**FRACCION_MINIMA_PRECIOS = 0,80** (`__init__.py:84`). La media se calcula **sobre el POOL, no sobre el catálogo**: `pool.coste_conocido.mean()`. Si más del 20 % del pool no tiene precio, el término entero se apaga (peso 0) — "puntuar con precios inventados es peor que no puntuar". El motivo se propaga a la traza: `motor.py:266-267` hace `traza.terminos_desactivados.append(f"coste:{ctx.coste_desactivado_por}")`, con los dos valores posibles `sin_presupuesto` y `precios_incompletos`. **Ese campo de traza es observable y hay que mantenerlo en el port.**

**Comportamiento no obvio que hay que preservar.** El término usa `pool.coste_cents` SIN mirar `coste_conocido` por fila. En `catalogo.py:136,163`, `coste_cents` se inicializa a 0 y se rellena con `f.get("costeCents", 0)`. Por tanto **una receta sin precio conocido tiene coste 0 y puntúa `cost = clip((0−b)/b, 0, 1) = 0`, es decir, sale "gratis" y queda favorecida frente a las que sí tienen precio.** Como máximo afecta al 20 % del pool (por el guarda anterior), pero es un sesgo real. No es un bug detectado por mí en el sentido de "corregir": es comportamiento vigente que el port debe reproducir bit a bit si se quiere paridad.

**Datos requeridos.** `coste_cents (N,) int32` por ración, `coste_conocido (N,) bool`. Del contrato: `presupuestoSemanalCents`, `comensales`, `n_dias`, `len(slots)`.

## (f) W_REP = 2,0 y DECAIMIENTO_REPETICION = 0,85 — penalización de repetición

**Qué mide.** Cuánto de reciente es la receta en el historial del usuario. Se RESTA con peso 2,0 (el segundo más grande en valor absoluto).

**Se precalcula UNA vez por petición** (no por slot ni por día), en `contexto_de` → `ctx.pen_rep (P,) float32`.

```python
def penalizacion_repeticion(cat, pool, recientes, n_slots):
    pen = np.zeros(pool.p, dtype=np.float32)
    if not recientes or n_slots <= 0:
        return pen
    vistos = set()
    for pos, rid in enumerate(recientes):
        if rid in vistos:
            continue
        vistos.add(rid)
        fila = cat.idx_por_id.get(rid)
        if fila is None:
            continue
        j = int(pool.mapa_fila[fila])
        if j >= 0:
            pen[j] = DECAIMIENTO_REPETICION ** (pos // n_slots)
    return pen
```
(scoring.py:227-251; llamada en 273-275 con `n_slots = len(restr.slots)`)

**Contrato.** `recetasRecientes` llega **ordenada de más reciente a más antigua** (DISENO.md:326-329; es una nota de documentación en `types.ts`, no un cambio de tipo). Con |S| slots por día, la posición estima los días transcurridos: φ_rep = 0,85^⌊pos/|S|⌋. Fuera de la lista, φ_rep = 0.

**Por qué 0,85**: `__init__.py:80` — deja ~3 % de penalización residual a 21 días, que es la ventana de la spec. (0,85^21 ≈ 0,0328.)

**Cuatro sutilezas que un port ingenuo rompe:**
1. **Sólo cuenta la primera aparición** de cada id (`vistos`): "si una receta salió ayer y hace dos semanas, manda ayer".
2. **`pos` es el índice en la lista COMPLETA, duplicados incluidos.** El `continue` del dedupe no decrementa `pos`. Es decir, un duplicado consume una posición y desplaza la estimación de días de todo lo que viene detrás. Si en TS se deduplica la lista antes de recorrerla, los exponentes cambian y los planes cambian.
3. **División entera hacia abajo**: `pos // n_slots`. En JS hay que usar `Math.floor(pos / nSlots)`, no `|0` ni `~~` (equivalentes sólo para no negativos, pero mejor ser explícito).
4. **Doble indirección catálogo→pool**: `cat.idx_por_id[rid]` da la fila del catálogo, y `pool.mapa_fila[fila]` la traduce a posición del pool (o −1 si esa receta no pasó los filtros duros). Las recetas recientes que no están en el pool se ignoran en silencio. `mapa_fila` se construye en `construir_pool` (scoring.py:161-162) como `np.full(cat.n, -1)` seguido de `mapa[idx] = arange(len(idx))`.

**Lo que este término NO cubre.** No conoce las recetas elegidas dentro de la propia semana que se está generando; de eso se encargan `excl` (dentro del día), `veto_semana` (`MAX_USOS_RECETA_SEMANA = 2`) y `veto_slot` (el mismo slot ayer).

## (g) W_AFIN = 0,0 — afinidad, término muerto pero presente

```python
# (g) Afinidad: no existe en el contrato (food_preference es v1). Peso 0.
afin = np.zeros(pool.p, dtype=np.float32)
```
(scoring.py:374-375)

DISENO.md:338-340: `food_preference` es v1 del contrato; peso efectivo 0 en MVP. El término se deja en el código **con su peso en `app/solver/__init__.py` para que activarlo sea una línea**.

Decisión para el port: mantener la constante `W_AFIN = 0` y el array de ceros (o mantener la constante y elidir el array por rendimiento, documentándolo). Recordar la discrepancia: la fórmula LaTeX de DISENO.md:228 escribe 0,8, el código dice 0,0, y el texto de §2.2(g) confirma que 0,0 es lo correcto.

## Estructuras que el score consume: Pool y Catalogo

`Pool` (scoring.py:49-77) es una copia **contigua** de las filas admisibles del catálogo, materializada una vez por petición. Motivo (comentario 51-57 y DISENO.md:151-154): `nutr[idx]` copia ~90 KB una vez y luego cada slot hace productos matriz-vector contiguos; el fancy indexing por slot cuesta ~5× más y rompe la localidad de caché.

Campos y formas (P = tamaño del pool, W = ceil(M/64)):

| campo | forma / dtype | lo usa |
|---|---|---|
| `idx` | (P,) int32 — fila del catálogo | trazabilidad |
| `mapa_fila` | (N,) int32 — fila catálogo → pos pool, o −1 | `pen_rep` |
| `ids` | (P,) object (str) | desempate del muestreo |
| `nutr` | (P,6) float32 | esc, residuo, totales |
| `conocido` | (P,6) bool | etapas B/diagnóstico, no el score |
| `v_macro` | (P,3) float32 ‖·‖₂=1 | fit |
| `tiene_macro` | (P,) bool | fit |
| `escala_min` / `escala_max` | (P,) float32 | esc, σ |
| `m_slot` | (P,5) bool | admisibilidad |
| `minutos` | (P,) int16 | admisibilidad |
| `bits` | (P,W) uint64 | desp, sol |
| `n_ingr` | (P,) int16 | desp, sol |
| `coste_cents` | (P,) int32 | cost |
| `coste_conocido` | (P,) bool | apagado del cost |

Orden de columnas de `nutr`, FIJO en todo el servicio: `0 kcal · 1 proteinaG · 2 carbohidratoG · 3 grasaG · 4 fibraG · 5 sodioMg` (`__init__.py:21-30`). Cambiarlo invalida cualquier catálogo cacheado.

**Construcción del pool** (`construir_pool`, scoring.py:145-180), dos niveles:
- Nivel 1 cacheado: `m_dieta[:, IDX_DIETA[dieta]] & ~m_alergeno[:, cada alérgeno] & (minutos <= tope_global)` → `np.flatnonzero` → int32. Clave de caché `(cat.version, dieta, alergenos_ordenados, minutos_tope)`, TTL 3600 s, tamaño 256 con política de vaciado total.
- Nivel 2 por petición sin cachear: `np.bitwise_count(cat.ingr_bits[idx] & excl).sum(axis=1) == 0` para `ingredientesExcluidos`.

**Para el port a navegador:** la caché de proceso con `threading.Lock` (scoring.py:85-118) es innecesaria en JS monohilo — pero `invalidar_cache_pool()` sigue siendo semánticamente relevante si se recarga el catálogo. En un build estático con catálogo fijo la caché de nivel 1 puede reducirse a un `Map` sin TTL, ya que `cat.version` es constante.

## muestrear(): top-k + z-score + softmax con temperatura. El punto crítico de reproducibilidad

scoring.py:389-436. No es parte del score, pero es lo que lo consume y donde se pierde la reproducibilidad más fácilmente.

```python
validos = np.flatnonzero(np.isfinite(scores))
if validos.size == 0: return None
if validos.size > TOP_K:                                  # TOP_K = 25
    s_val = scores[validos]
    umbral = float(s_val[np.argpartition(-s_val, TOP_K - 1)[TOP_K - 1]])
    mejores   = validos[s_val >  umbral]
    empatados = validos[s_val == umbral]
    huecos = TOP_K - mejores.size
    if empatados.size > huecos:
        empatados = np.asarray(sorted(empatados.tolist(), key=lambda i: str(ids[i]))[:huecos], ...)
    validos = np.concatenate([mejores, empatados])
orden = sorted(validos.tolist(), key=lambda i: (-float(scores[i]), str(ids[i])))
cand = np.asarray(orden, dtype=np.int64)
if cand.size == 1: return int(cand[0])

s = scores[cand].astype(np.float64)
z = (s - s.mean()) / max(float(s.std()), 1e-3)
logits = z / max(tau, 1e-6)
logits -= logits.max()
p = np.exp(logits); p /= p.sum()
return int(cand[rng.choice(cand.size, p=p)])
```

**Las tres decisiones documentadas** (docstring 391-403 y DISENO.md:369-407):
1. Top-k = 25 recorta la cola larga y hace el coste independiente de |P|.
2. **El orden explícito por `(-score, id)` es OBLIGATORIO.** `argpartition` no define qué empatados deja dentro del corte; ordenar después NO lo arregla porque lo que varía es qué ENTRA. Por eso se usa `argpartition` sólo para obtener el VALOR umbral (que sí es único sea cual sea la permutación) y los empates en ese umbral se resuelven por id.
3. Estandarizar antes del softmax da a τ un significado estable.

**Detalles que hay que copiar literalmente en TS:**
- `s.std()` de numpy es **desviación típica poblacional (ddof=0)**, es decir divide por n, no por n−1.
- `max(std, 1e-3)` y `max(tau, 1e-6)`.
- `scores` es float32; `scores[cand].astype(np.float64)` promociona valores YA redondeados a float32 antes de calcular media y σ.
- Ordenación de empates por `str(ids[i])`: Python compara `str` por code point; JS compara por code unit UTF-16. Sólo difieren con caracteres fuera del BMP. Con ids ASCII no hay problema, pero conviene forzar comparación explícita.
- **`rng.choice(n, p=p)` de numpy** no es "buscar en la acumulada" genérico: internamente hace `cdf = p.cumsum(); cdf /= cdf[-1]; idx = cdf.searchsorted(random_double(), side='right')`. Reproducirlo bit a bit exige además PCG64 con el mismo `next_double`.
- En `reparacion.py:217` se llama con `tau_k = ctx.tau * (1 + 0.25*k)`, no con `ctx.tau`.

## Inventario completo de operaciones numpy a reescribir como bucles en TS

Regla del módulo (docstring, scoring.py:7-9): *si un bucle `for` de Python itera sobre recetas, es un bug*. En TS esa regla se INVIERTE: no hay ufuncs, así que cada una de estas líneas es un bucle sobre P. Lista exhaustiva de `scoring.py`:

**Construcción del pool**
1. `cat.m_dieta[:, col].copy()`, `m &= ~cat.m_alergeno[:, col]`, `m &= cat.minutos <= tope` (92-96) → un bucle sobre N con máscara `Uint8Array`.
2. `np.flatnonzero(m).astype(np.int32)` (97) → recorrido + push a `Int32Array`.
3. `np.bitwise_count(cat.ingr_bits[idx] & excl).sum(axis=1) == 0` (158) → doble bucle (filas × W palabras) con popcount.
4. `mapa = np.full(cat.n, -1); mapa[idx] = np.arange(...)` (161-162).
5. Catorce *fancy indexings* `cat.X[idx]` (164-180) → copias a TypedArrays compactos (o, alternativa: no copiar y usar `idx` como indirección; cambia el rendimiento, no el resultado).

**vector_macro** (287-303)
6. `np.maximum(residuo[1:4], 0.0)`, `[4,4,9]*macros`, `.sum()`, `np.linalg.norm` → trivial, sólo 3 elementos.

**score_slot** (306-386)
7. Máscaras booleanas `&`, `~`, `.copy()`, `.any()` (310-324) → bucles sobre P.
8. **`pool.v_macro @ v_res`** (333) → matvec (P,3)×(3,): bucle `for i: c = vm[3i]*v0 + vm[3i+1]*v1 + vm[3i+2]*v2`. Es la operación más cara del módulo.
9. `np.arccos(np.clip(cos,-1,1))` (334) → `Math.acos` por elemento. ~P llamadas por slot.
10. `np.where(tiene_macro, fit, 0.5)` (336) y `np.full(P, 0.5)` (338).
11. `np.maximum(nutr[:,0], 1e-6)` (344) y la división de `eta` (345).
12. **`np.where` ANIDADO** para `esc` (346-350): numpy evalúa AMBAS ramas y luego selecciona; en TS es un `if/else if/else` que además evita divisiones inútiles. Resultado idéntico, mejor rendimiento.
13. `np.maximum(pool.n_ingr.astype(float32), 1.0)` (352).
14. **`np.bitwise_count(bits & X).sum(axis=1)`** dos veces (355, 364) → doble bucle P×W. Es la segunda operación más cara.
15. `np.clip((coste - b)/b, 0, 1)` (370).
16. `np.zeros(P)` para `afin` (375) → constante 0, elidible.
17. **La combinación lineal de siete arrays (P,)** (377-385) → numpy crea 7 temporales de P elementos; en TS es UN solo bucle que acumula. Ganancia real.
18. `np.where(admisible, s.astype(float32), -inf)` (386).

**muestrear** (389-436)
19. `np.flatnonzero(np.isfinite(scores))`, indexación booleana `s_val > umbral` / `== umbral`, `np.concatenate`, `argpartition`, `sorted`, `.mean()`, `.std()`, `np.exp`, división por la suma.

**sigma_sugerido / totales_de** (439-493)
20. `np.clip(eta, escala_min[j], escala_max[j])` (450) → escalar, trivial.
21. `(pool.nutr[filas] * sigmas[:,None]).sum(axis=0)` (492-493) → bucle sobre |filas| (≤5) × 6.

**Nota de tipos.** `np.bitwise_count` requiere numpy ≥ 2.0 (DISENO.md:161-162). En JS no hay uint64 nativo salvo BigInt (lento). Recomendación: representar cada palabra de 64 bits como **dos `Uint32Array`** (o un `Uint32Array` de 2W columnas) y usar el popcount SWAR clásico de 32 bits. Con M ≈ 600 alimentos son 2W ≈ 20 palabras de 32 bits por receta.

## Ciclo de vida del Contexto: campos mutables y orden de generación

`Contexto` (scoring.py:188-208) es `@dataclass(slots=True)` **sin `frozen`**: se muta a lo largo de la generación. Un port a TS con objetos inmutables cambiará los resultados.

Campos y quién los toca:
- `cuota`, `topes`, `bits_despensa`, `pen_rep`, `peso_coste`, `umbral_coste`, `tau`, `coste_desactivado_por`: se fijan una vez en `contexto_de` (scoring.py:254-279) y no cambian.
- **`bits_semana`**: ceros al empezar; `semanal.py:101` lo sustituye por `ctx.bits_semana | mejor.bits` al cerrar cada día.
- **`veto_semana` (P,) bool**: `semanal.py:81` lo recalcula al comienzo de cada día como `usos >= MAX_USOS_RECETA_SEMANA` (=2), donde `usos` es un contador incremental por fila del pool.
- **`veto_slot` dict slot→fila**: `semanal.py:102` lo reemplaza con `dict(zip(mejor.slots, mejor.filas))` — las recetas del día anterior.

El comentario de scoring.py:201-206 explica el porqué de que estas restricciones duras vivan en el contexto y no sólo en la etapa D: si sólo se comprueban al ensamblar, **los K candidatos de un día se generan sin conocerlas y el recocido no tiene ningún estado factible que visitar**; con el catálogo semilla eso producía semanas con la misma cena tres veces.

Consecuencia para el port: el orden `día 0 → cerrar mejor → día 1 → …` es semánticamente obligatorio, tanto por `bits_semana` (§2.2d) como por `veto_semana`/`veto_slot`.

## Funciones auxiliares del módulo (contrato exacto)

**`cuotas_de(slots)`** (211-214): `cuota[s] = PESO_SLOT[s] / sum(PESO_SLOT[t] for t in slots)`. Reparto renormalizado al subconjunto pedido. **Lanza ZeroDivisionError si `slots` está vacío** (no hay guarda); en TS daría `Infinity` en silencio — añadir la comprobación o replicar el error.

**`orden_de_slots(slots)`** (217-224): `sorted(set(slots), key=lambda s: (-PESO_SLOT[s], IDX_SLOT[s]))`. Deduplica y ordena por cuota descendente, desempate por el orden canónico de `SLOTS`. Determinista y además correcto: los slots grandes consumen la mayor parte del presupuesto y deben elegir primero. **El orden en que la petición liste los slots no afecta al plan.** En TS: `Array.prototype.sort` es estable desde ES2019, pero como la clave es un par total no hace falta estabilidad.

**`topes_por_slot(restr)`** (133-142): rellena los CINCO slots de `SLOTS` con `SIN_LIMITE_MINUTOS` si faltan, no sólo los pedidos.

**`sigma_sugerido(pool, j, residuo, cuota)`** (439-450): `clip(η, escala_min[j], escala_max[j])`, con 1.0 si kcal ≤ 0. Se usa DOS veces: para actualizar el residuo (restar la ración real y no 1,0, que dejaría un residuo inflado y elegiría los slots siguientes contra un objetivo falso, DISENO.md:419-423) y como ancla del desempate del LP (σ_ref de §3.3).

**`seleccionar_dia(...)`** (453-485): bucle sobre `orden_de_slots`, `score_slot` → `muestrear` → `excl[j] = True` → `residuo -= sigma_sugerido(...) * pool.nutr[j]` en float64. Devuelve `None` en cuanto un slot se queda sin candidatos. `rng_por_slot(slot)` se inyecta para que el módulo no conozca la estructura del árbol de semillas.

**`totales_de(pool, filas, sigmas)`** (488-493): Σ σᵢ·nutrientesᵢ en float64. "La única fuente de los totales que se devuelven".

**Vector objetivo del que sale el residuo** (`reparacion.py:66-84`, no está en scoring.py pero lo alimenta): `[kcal, centro(proteinaG), centro(carbohidratoG), centro(grasaG), fibraMinG or 0, sodioMaxMg or 0]` en float64. La etapa A sólo necesita la dirección; el cuadre contra los extremos de las bandas lo hace el LP.

## Riesgos

- **[alta]** Reproducibilidad bit a bit con el Python: exige reimplementar PCG64 + SeedSequence(spawn_key=ruta) y el algoritmo interno exacto de Generator.choice(p=...) (cumsum, normalizar por el último, un next_double, searchsorted side='right'). Sin eso, el mismo seed da planes distintos en TS y en Python, y el bug es indepurable en soporte — exactamente lo que el docstring de rng_de advierte.
  - Mitigación: Decidir explícitamente el nivel de fidelidad ANTES de escribir código. Opción A (paridad real): implementar PCG64 de 128 bits con BigInt o con aritmética de 64 bits en pares de Uint32, más SeedSequence con spawn_key, más el choice de numpy. Opción B (paridad relajada, recomendada para el MVP en Pages): un PRNG contadorizado propio (p.ej. splitmix64 sobre hash(seed, ruta)) que conserve la PROPIEDAD estructural — nodos independientes, flujo de un nodo que no depende de cuántos números consuman los demás — y aceptar por escrito que los planes no coincidirán con el backend Python. Elegida B, subir VERSION_GENERADOR y documentarlo en DISENO.md.
- **[alta]** float32 vs float64. En el Python nutr, v_macro, escala_*, y el propio score son float32; el residuo y el muestreo son float64. En JS todo es float64 por defecto. Los scores redondeados de forma distinta cambian el CONJUNTO del top-25, el orden, la media y la σ del z-score, y por tanto la receta elegida — aunque cada término individual difiera sólo en el séptimo decimal.
  - Mitigación: Usar Float32Array para nutr, v_macro, escala_min/max y para el array de score, y Math.fround() en los puntos donde el Python hace .astype(np.float32) (fit línea 336, esc línea 350, desp/sol líneas 355 y 364, cost línea 370, s línea 386). Añadir un test de regresión que compare, sobre el catálogo semilla, los vectores de score completos TS vs Python con tolerancia 0 en float32.
- **[media]** Popcount sobre uint64 en el navegador. np.bitwise_count no tiene equivalente; BigInt es 10-50× más lento que Uint32 y el término desp/sol se evalúa P×W veces por slot, con ~420 llamadas a score_slot por petición (7 días × 12 intentos × 5 slots) más las reparaciones.
  - Mitigación: Representar los bitsets como Uint32Array de 2W columnas (W ≈ 10 → 20 palabras de 32 bits para M ≈ 600 alimentos) y usar popcount SWAR de 32 bits. Medir con P ≈ 1.500; si no llega, precalcular por día la intersección con bits_semana y bits_despensa una sola vez fuera del bucle de slots (ambos bitsets son constantes dentro del día).
- **[media]** Divergencia de funciones trascendentes: Math.acos y Math.exp de V8 no están obligados a coincidir bit a bit con la libm que usa numpy. fit hace P llamadas a arccos por slot y el softmax hace hasta 25 exp.
  - Mitigación: Aceptar la divergencia si se ha elegido paridad relajada. Si se exige paridad, implementar acos/exp propias con polinomios de precisión conocida, o —más barato— redondear fit a float32 antes de acumular (que es lo que ya hace el Python en la línea 336) para que el error de 1 ULP en float64 se pierda en el redondeo.
- **[media]** Reescribir la penalización de repetición deduplicando la lista de recetasRecientes antes del bucle. Es el error natural al leer el código, porque el `continue` del dedupe parece implicar que las posiciones duplicadas no cuentan. Sí cuentan: `enumerate` avanza igualmente, así que un duplicado desplaza la estimación de días de todo lo que viene detrás.
  - Mitigación: Portar el bucle literalmente: recorrer el array original con su índice, saltar los ya vistos sin tocar el índice, y usar Math.floor(pos / nSlots). Test dirigido: lista ['a','a','b'] con nSlots=2 debe dar pen[a]=0.85^0=1 y pen[b]=0.85^1=0.85, NO pen[b]=0.85^0.
- **[media]** Portar el Contexto como estructura inmutable o generar los días en paralelo/desordenados. El término de solape semanal (bits_semana), veto_semana y veto_slot son estado mutado entre días desde semanal.py; el orden de días es semánticamente obligatorio.
  - Mitigación: Mantener el Contexto como objeto mutable y el bucle de días estrictamente secuencial. Si se prefiere un estilo funcional, pasar el estado explícitamente día a día, pero nunca generar días en paralelo aunque el navegador lo permita con Workers.
- **[media]** Perder el apagado del término de coste o cambiar su sesgo oculto. Dos comportamientos frágiles: (1) la media de coste_conocido se calcula sobre el POOL, no sobre el catálogo; (2) las recetas sin precio tienen coste_cents = 0 y por tanto cost = 0, es decir salen 'gratis' y quedan favorecidas.
  - Mitigación: Portar contexto_de literalmente, incluida la guarda `pool.p == 0`, y NO añadir un filtro por coste_conocido dentro del término de cost. Exponer coste_desactivado_por en la traza del cliente con los dos valores exactos ('sin_presupuesto', 'precios_incompletos'); es información observable que la UI ya consume vía traza.terminos_desactivados.
- **[media]** Romper el desempate del top-k. Es, según el propio docstring, 'el fallo de reproducibilidad más fácil de introducir'. Un port que use sort descendente por score sin desempatar por id, o que use un select-k que no reproduzca la semántica valor-umbral / estrictamente-mayores / empatados-ordenados-por-id, cambiará el conjunto candidato en cuanto haya scores repetidos (frecuente con fit=0,5 neutro y esc=1 saturado).
  - Mitigación: Portar muestrear() paso a paso, incluida la separación mejores/empatados y el recorte de empatados por orden de id. En TS basta ordenar validos por (-score, id) y tomar los 25 primeros SOLO si se replica también el criterio de umbral; lo más seguro es copiar la estructura tal cual. Test: pool sintético con 30 recetas de score idéntico, verificar que el top-25 son los 25 ids menores lexicográficamente.
- **[baja]** Comparación de cadenas para el desempate: Python ordena str por code point, JavaScript por code unit UTF-16. Difieren para caracteres fuera del BMP.
  - Mitigación: Con recetaIds ASCII/slug no hay diferencia. Documentar la restricción en el generador de catálogo (ids ASCII) o, si se quiere blindaje, comparar con un comparador por code point (iterar con for...of, que itera por code point).
- **[baja]** Copiar el W_AFIN = 0,8 de la fórmula LaTeX de DISENO.md §2.2 en lugar del W_AFIN = 0,0 del código, creyendo que el código está desactualizado.
  - Mitigación: El código manda: DISENO.md §2.2(g) (líneas 338-340) confirma explícitamente 'peso efectivo 0 en MVP'. Aprovechar el port para corregir la fórmula del documento y su rango declarado ([-3,5, 9,5] → [-3,5, 8,7]), sin tocar el valor.
- **[baja]** Traducir mal los guardas numéricos (1e-6 en kcal, escala_min, eta y tau; 1e-3 en la σ del z-score). En Python una división por cero en numpy da un warning y un inf; en JS da Infinity en silencio y contamina el score sin dejar rastro.
  - Mitigación: Copiar los cuatro guardas literalmente y añadir un assert de desarrollo que verifique que ningún score finito es NaN o Infinity antes de pasarlo a muestrear().
- **[baja]** Reproducir el reparto y el orden de slots a partir del array `slots` de la petición en lugar de derivarlos. cuotas_de además divide por cero si slots está vacío.
  - Mitigación: Portar orden_de_slots con el dedupe (new Set) y la clave compuesta (-PESO_SLOT[s], IDX_SLOT[s]), y validar slots.length > 0 en el borde de entrada antes de llegar al motor, como ya hace motor.py aguas arriba.

---

# reparacion-semanal

Las etapas C y D son puro Python/NumPy sin dependencias externas (ni HiGHS ni scipy): C llama al LP de la etapa B, pero su propia lógica es aritmética densa sobre vectores de 6 nutrientes y bucles cortos sobre slots (<=5), días (<=7), candidatos (<=12) e intentos (<=3). Portarlas a TypeScript es mecánico salvo por dos puntos: (a) el LP que invocan (`resolver_porciones`, fuera del ámbito de esta lectura, pero llamado 150-340 veces por semana) y (b) la reproducibilidad del RNG.

Etapa C (`reparacion.py`) genera un candidato de día: selección estocástica (etapa A) + porcionado LP, y si E > UMBRAL_ERROR_OK (0,04) hasta MAX_INTENTOS_REPARACION=3 sustituciones dirigidas de UN SOLO slot, el elegido por `culpabilidad()` (producto escalar con signo cambiado entre lo que la receta aporta y lo que al día le falta). Cada reintento k sube la temperatura a tau*(1+0,25k) y usa un nodo distinto del árbol de semillas. Se devuelve siempre el mejor visto. UMBRAL_ERROR_ACEPTABLE (0,12) NO se usa aquí: vive en `motor.py:300`, después de la etapa D, sobre el peor día.

Etapa D (`semanal.py`) genera K_CANDIDATOS_DIA=6 candidatos por día (deduplicados por frozenset de filas, hasta 2K=12 intentos), y recorre el espacio 6^7 con recocido simulado: SA_T0=0,05, SA_ALFA=0,994, SA_ITERACIONES=400. El coste es sum(E_d) + 0,006*ingredientes_unicos + 0,30*exceso_presupuesto + 0,05*repeticiones, con las duras (<=2 usos/semana, nunca mismo slot dos días seguidos) como rechazo del movimiento, no penalización.

La aleatoriedad se consume en exactamente TRES puntos: `rng.choice(n, p)` en `muestrear` (un único double por nodo del árbol, generador fresco y desechado), y `rng.integers` x2 + `rng.random()` en el bucle SA sobre un ÚNICO flujo secuencial. Los dos últimos son condicionales y con cortocircuito, y numpy bufferiza medias palabras de 32 bits entre llamadas: he verificado el modelo exacto y es reproducible en TS.

Coste estimado en JS: ~120-300 ms por semana con P=1500 recetas, dominado por `score_slot` (300-670 llamadas O(P)); el recocido en sí es <2 ms. Es viable computacionalmente pero bloquea el hilo principal 10-60 frames: hace falta Web Worker.

## Etapa C — flujo completo de generar_candidato_dia

Firma: `generar_candidato_dia(pool, ctx, objetivo, slots, seed, dia, k_cand) -> CandidatoDia | None`.

Secuencia exacta:

1. `objetivo_vec = vector_objetivo(objetivo)`: vector (6,) float64 = `[kcal, (protMin+protMax)/2, (carbMin+carbMax)/2, (grasaMin+grasaMax)/2, fibraMinG or 0, sodioMaxMg or 0]`. Es el CENTRO de cada banda, no la banda: la etapa A sólo necesita la dirección; el cuadre contra los extremos lo hace el LP.
2. `slots_orden = orden_de_slots(slots)` = `sorted(set(slots), key=lambda s: (-PESO_SLOT[s], IDX_SLOT[s]))`. Con los 5 slots da: comida(0.35), cena(0.28), desayuno(0.22), almuerzo(0.10), merienda(0.10) — almuerzo antes que merienda por IDX_SLOT. **El orden en que la petición liste los slots no afecta al plan.** `slots` y `filas` del CandidatoDia van en este orden, NO en el de presentación.
3. `seleccionar_dia(...)` con `rng_por_slot = lambda slot: rng_de(seed, RUTA_A, dia, k_cand, 0, IDX_SLOT[slot])`. Devuelve `dict[slot -> fila]` o `None` si algún slot se queda sin recetas admisibles (entonces `generar_candidato_dia` devuelve `None`).
4. Construcción de `ref` (sigma de referencia) recorriendo `slots_orden`: `ref[pos] = sigma_sugerido(pool, j, residuo, ctx.cuota[slot])` y `residuo -= ref[pos] * pool.nutr[j].astype(float64)`. Ojo: el residuo se actualiza secuencialmente y en el mismo orden. `sigma_sugerido` = `clip(max(residuo[kcal],0) * cuota / kcal_receta, escala_min[j], escala_max[j])`, y devuelve 1.0 si `kcal_receta <= 0`.
5. `activos, fibra_fiable = nutrientes_activos(pool, filas, objetivo)` → máscara (6,) bool. Desactiva FIBRA si la fracción de kcal del día con dato de fibra conocido < FRACCION_MINIMA_FIBRA (0,80); desactiva SODIO si `objetivo.sodioMaxMg is None` o si algún item no tiene sodio conocido. Un nutriente desactivado tiene banda abierta y peso 0: ni penaliza ni entra en E.
6. `bandas = bandas_de(objetivo, activos)`; `a, res = _porcionar(pool, filas, ref, bandas)` donde `a` es (6,R) float64 contigua = transpuesta de `pool.nutr[filas]`, y `lo/hi` son `pool.escala_min/max[filas]`.
7. `mejor = _empaquetar(...)` con `intentos=0`. **Si `mejor.error <= UMBRAL_ERROR_OK` (0,04) se retorna inmediatamente, sin entrar al bucle de reparación.**

`_empaquetar` calcula `bits = np.bitwise_or.reduce(pool.bits[filas], axis=0)` — la unión de bitsets de ingredientes del día, (W,) uint64. Es lo que la etapa D usa para contar ingredientes únicos.

`CandidatoDia` (dataclass slots): `slots: list[str]`, `filas: list[int]` (posiciones en el pool, NO ids), `sigma: (R,) float64 cuantizado`, `totales: (6,) float64 de esos sigma —no los del LP continuo—`, `error: float`, `intentos: int`, `emergencia: bool`, `fibra_fiable: bool`, `bits: (W,) uint64`. Propiedad `claves = frozenset(filas)`, usada para deduplicar los K candidatos del día.

Referencias: `services/solver/app/solver/reparacion.py:138-182`, `services/solver/app/solver/reparacion.py:42-64`, `services/solver/app/solver/reparacion.py:66-83`, `services/solver/app/solver/reparacion.py:86-109`, `services/solver/app/solver/reparacion.py:112-135`, `services/solver/app/solver/scoring.py:452-484`, `services/solver/app/solver/scoring.py:217-224`, `services/solver/app/solver/scoring.py:439-450`

## Etapa C — bucle MAX_INTENTOS_REPARACION y uso de culpabilidad()

`for k in range(1, MAX_INTENTOS_REPARACION + 1)` → k = 1, 2, 3. MAX_INTENTOS_REPARACION = 3 (`__init__.py:118`).

En cada iteración k:

**(a) Culpable.** `kappa = culpabilidad(a, res.sigma, res.totales, bandas)` — usa `a` y `bandas` del ÚLTIMO porcionado resuelto, no del inicial. Implementación (`porciones.py:352-365`):
```python
u_mas, u_menos = desviaciones(totales, bandas)   # cuánto sobra / cuánto falta
g = (bandas.w_menos * u_menos - bandas.w_mas * u_mas) / bandas.e   # (6,)
aporte = a * sigma[None, :] / bandas.e[:, None]                    # (6, R)
return -(g[None, :] @ aporte).ravel()                              # (R,)
```
`g_n > 0`: falta ese nutriente; `g_n < 0`: sobra; `g_n = 0`: en banda. `kappa_i` alto = la receta i aporta mucho de lo que sobra y poco de lo que falta. Funciona también cuando el problema es de magnitud: si sobran kcal, `g_kcal < 0` y la receta más calórica sale como la más culpable.

`desviaciones` (porciones.py:109-115): `u_mas = where(hi < INF_HIGHS, max(0, totales-hi), 0)`, `u_menos = where(lo > -INF_HIGHS, max(0, lo-totales), 0)`. INF_HIGHS = 1e30.

**(b) Selección del culpable.** `next((int(p) for p in np.argsort(-kappa, kind='stable') if filas[p] not in vetadas), None)`. Es argmax de kappa; el `kind='stable'` sobre un orden de selección ya determinista da desempate por índice de slot ascendente (posición en `slots_orden`). Si todas las filas están vetadas → `break`.

**(c) Veto local.** `vetadas.add(filas[culpable])` — veto local al día, nunca global. `vetadas` se inicializa vacío antes del bucle.

**(d) Residuo del slot culpable, con los sigma REALES del LP:**
```python
residuo_s = objetivo_vec.copy()
for pos, fila in enumerate(filas):
    if pos != culpable:
        residuo_s -= float(res.sigma[pos]) * pool.nutr[fila].astype(float64)
```
Este residuo es mucho mejor que el de la primera pasada: ya no es una estimación, se sabe exactamente qué hueco hay que llenar.

**(e) Máscara de exclusión:** `excl` (P,) bool con True en todas las filas actuales EXCEPTO la del culpable, más todas las `vetadas`.

**(f) Reselección** (ver apartado de temperatura y RNG).
Si `muestrear` devuelve `None` (ningún candidato admisible) → `break`.

**(g) Nuevo porcionado.** `filas[culpable] = nuevo`; se recalculan `activos`/`bandas` (la nueva receta puede cambiar la fiabilidad de fibra/sodio); `ref_k = res.sigma.copy()` y `ref_k[culpable] = sigma_sugerido(pool, nuevo, residuo_s, ctx.cuota[slot_culpable])` — es decir, los sigma del LP anterior se reutilizan como ancla para los slots no tocados.

**(h) Actualización del mejor.** `if candidato.error < mejor.error: mejor = candidato` — comparación ESTRICTA, así que un empate conserva el candidato de k menor (determinismo). `if mejor.error <= UMBRAL_ERROR_OK: break`.

Se devuelve `mejor`, que puede tener error > 0,04 tras agotar los 3 intentos. `mejor.intentos` es el k en el que se encontró el mejor, NO el número total de intentos realizados (esto se agrega en `traza.intentos_reparacion`, motor.py:293).

Nota de coste: se sustituye SÓLO el slot culpable, no el día entero. Por eso la reparación re-puntúa 1 slot y no 5; el coste por intento baja ~4x.

Referencias: `services/solver/app/solver/reparacion.py:184-241`, `services/solver/app/solver/porciones.py:352-365`, `services/solver/app/solver/porciones.py:109-115`, `services/solver/app/solver/__init__.py:118-119`, `services/solver/DISENO.md:778-840`

## Etapa C — FACTOR_TEMPERATURA_REINTENTO y reselección

`FACTOR_TEMPERATURA_REINTENTO = 0.25` (`__init__.py:119`).

```python
tau_k = ctx.tau * (1.0 + FACTOR_TEMPERATURA_REINTENTO * k)
nuevo = muestrear(
    score_slot(pool, ctx, slot_culpable, residuo_s, excl),
    pool.ids,
    tau_k,
    rng_de(seed, RUTA_A, dia, k_cand, k, IDX_SLOT[slot_culpable]),
)
```
Con k = 1,2,3 → tau_k = 1,25*tau ; 1,50*tau ; 1,75*tau. Racional documentado: si el primer intento falló, el argmax local no era la respuesta; subir la temperatura amplía la exploración.

`ctx.tau` sale de `temperatura(variedad)` = `TAU_MIN * (TAU_MAX/TAU_MIN)**(variedad/100)` con TAU_MIN=0,12, TAU_MAX=1,5, VARIEDAD_POR_DEFECTO=45. Mapa geométrico. No hay clamp superior sobre tau_k: con variedad=100, tau_3 = 1,5*1,75 = 2,625.

Dentro de `muestrear` (scoring.py:389-436) tau entra como `logits = z / max(tau, 1e-6)` sobre z-scores estandarizados del top-K (TOP_K=25). El std usa `max(float(s.std()), 1e-3)` — **`np.ndarray.std()` es desviación POBLACIONAL (ddof=0)**, punto fácil de equivocar en el port.

Referencias: `services/solver/app/solver/reparacion.py:216-222`, `services/solver/app/solver/__init__.py:119`, `services/solver/app/solver/__init__.py:86-88`, `services/solver/app/solver/__init__.py:195-201`, `services/solver/app/solver/scoring.py:389-436`

## Etapa C — UMBRAL_ERROR_OK vs UMBRAL_ERROR_ACEPTABLE: dónde se aplica cada uno

`UMBRAL_ERROR_OK, UMBRAL_ERROR_ACEPTABLE = 0.04, 0.12` (`__init__.py:108`, §3.3).

**UMBRAL_ERROR_OK (0,04) — criterio de PARADA, sólo en reparacion.py:**
- `reparacion.py:181` — si el candidato inicial ya cumple, no se entra al bucle de reparación.
- `reparacion.py:238` — corta el bucle en cuanto el mejor visto cumple.

**UMBRAL_ERROR_ACEPTABLE (0,12) — criterio de HONESTIDAD, NO está en reparacion.py ni en semanal.py.** Se aplica en `motor.py:300`, después de la etapa D y de `reparar_duras`:
```python
peor = max(range(n_dias), key=lambda d: resultado.dias[d].error)
if resultado.dias[peor].error > UMBRAL_ERROR_ACEPTABLE:
    fallo = diagnosticar_objetivo(...)   # devuelve RespuestaError, no plan
```
El peor día manda: un plan semanal con un día roto es un plan roto. Por encima del umbral no se devuelve plan, se devuelve un `FalloGeneracion` con exactamente 3 sugerencias (§6).

OJO para el port: DISENO.md §4.2 dice "Si tras los 3 intentos E > 0,12, el día se marca como fallido y se dispara §6", lo que sugiere una comprobación por día dentro de la etapa C. **El código NO lo hace ahí**: la comprobación es una sola, global, sobre el peor día, y después de la etapa D. Portar lo que dice el documento en vez de lo que hace el código cambiaría el comportamiento (abortaría antes de que la etapa D pudiera elegir un candidato mejor del mismo día).

Definición de E (`porciones.py:118-131`): desviación relativa media ponderada FUERA de banda, sobre los totales REALES de los sigma cuantizados (nunca sobre el valor objetivo del LP, que incluye el regularizador EPS_REG y corresponde a sigma continuos):
```
E = sum(w_mas*u_mas/e + w_menos*u_menos/e) / sum(max(w_mas, w_menos))
```
E = 0 significa "todos los nutrientes dentro de su rango", no "clavado en el centro". Si `peso_total <= 0` devuelve 0,0.

Referencias: `services/solver/app/solver/__init__.py:108`, `services/solver/app/solver/reparacion.py:181`, `services/solver/app/solver/reparacion.py:238`, `services/solver/app/solver/motor.py:299-312`, `services/solver/app/solver/porciones.py:118-131`, `services/solver/DISENO.md:836`

## Etapa C — recomponer_dia y mejor_alternativa (rutas SIN aleatoriedad)

Ambas las usa la etapa D (`reparar_duras`). **Ninguna de las dos consume RNG.**

`recomponer_dia(pool, ctx, objetivo, slots_orden, filas, intentos=0) -> CandidatoDia`: rehace `ref` con `sigma_sugerido` recorriendo (slot, fila) en orden y actualizando el residuo, recalcula `activos`/`bandas` y vuelve a resolver el LP. Existe porque al sustituir un item los sigma y totales viejos dejan de ser válidos: devolver los totales viejos con la receta nueva sería mentir.

`mejor_alternativa(pool, ctx, slot, residuo, excluidas) -> int | None`: **argmax determinista**, no muestreo.
```python
s = score_slot(pool, ctx, slot, residuo, excluidas)
validos = np.flatnonzero(np.isfinite(s))
if validos.size == 0: return None
return min(validos.tolist(), key=lambda i: (-float(s[i]), str(pool.ids[i])))
```
Desempate por **comparación lexicográfica de strings** sobre `pool.ids` (no numérica). En TS esto es `String(a) < String(b)`, que para UTF-16 vs Python str puede diferir en caracteres no ASCII; con ids tipo UUID/slug es equivalente.

Racional: la reparación de duras no debe introducir aleatoriedad nueva — ya se está corrigiendo un plan concreto y hace falta la mejor sustitución, no una sorteada.

Referencias: `services/solver/app/solver/reparacion.py:244-287`

## Etapa D — generar_candidatos: K_CANDIDATOS_DIA, dedup y acoplamiento secuencial

`K_CANDIDATOS_DIA = 6` (`__init__.py:125`). `generar_candidatos(pool, ctx, objetivos, slots, seed) -> (por_dia, duplicados)`.

Bucle por día d (en orden, obligatoriamente secuencial):
```python
usos = np.zeros(pool.p, dtype=np.int16)          # fuera del bucle de días
for d, objetivo in enumerate(objetivos):
    ctx.veto_semana = usos >= MAX_USOS_RECETA_SEMANA    # (P,) bool
    vistos: set[frozenset] = set()
    candidatos = []
    for k in range(2 * K_CANDIDATOS_DIA):        # hasta 12 intentos
        if len(candidatos) >= K_CANDIDATOS_DIA: break
        cand = generar_candidato_dia(pool, ctx, objetivo, slots, seed, d, k)
        if cand is None: break                   # pool agotado dentro del día
        if cand.claves in vistos:
            duplicados += 1; continue
        vistos.add(cand.claves); candidatos.append(cand)
    por_dia.append(candidatos)
    if candidatos:
        mejor = min(candidatos, key=lambda c: c.error)     # min estable: gana el de menor índice en empate
        ctx.bits_semana = ctx.bits_semana | mejor.bits
        ctx.veto_slot = dict(zip(mejor.slots, mejor.filas, strict=True))
        for fila in mejor.filas: usos[fila] += 1
```

Puntos críticos para el port:

1. **`ctx` es estado MUTABLE compartido entre días.** Se mutan `veto_semana`, `bits_semana` y `veto_slot` en ese orden exacto. Cualquier reordenación cambia los scores del día siguiente y por tanto todo el plan.
2. **El día se cierra con su MEJOR candidato provisional** (menor error), no con el que acabará eligiendo el recocido. Eso es lo que el día siguiente ve como "ya está en la lista de la compra" (`bits_semana`, término de solape §2.2d) y como "esto ya comiste ayer" (`veto_slot`). Es el motivo de que `reparar_duras` sea imprescindible al final.
3. **La deduplicación es por `frozenset(filas)`** — conjunto, no secuencia: dos candidatos con las mismas recetas en distintos slots cuentan como duplicado. En TS hay que implementar un hash de conjunto (p.ej. ordenar las filas y unir con coma, o XOR de hashes).
4. **El índice k se pasa como `k_cand` al árbol de semillas**, así que el intento de regeneración k=6..11 usa nodos distintos de k=0..5. Coincide con lo que DISENO §5.4 llama `rng_de(seed, RUTA_A, d, k+K, 0, ·)`.
5. `ctx.veto_semana` se aplica dentro de `score_slot` (scoring.py:318-323) SÓLO si deja algo que elegir (`if estricto.any(): admisible = estricto`). Es la única restricción del servicio que cede, y cede porque no es de seguridad.
6. Un día puede acabar con lista VACÍA (si `generar_candidato_dia` devuelve None en el primer intento). Ese caso se propaga hasta `motor.py:279` como fallo de pool.

`MAX_USOS_RECETA_SEMANA = 2` (`__init__.py:130`).

Referencias: `services/solver/app/solver/semanal.py:57-105`, `services/solver/app/solver/__init__.py:125-130`, `services/solver/app/solver/scoring.py:307-323`, `services/solver/DISENO.md:940-956`

## Etapa D — función objetivo semanal (_coste) y constantes lambda/mu/nu

`LAMBDA_INGREDIENTES, MU_PRESUPUESTO, NU_REPETICION = 0.006, 0.30, 0.05` (`__init__.py:129`).

```python
def _coste(combo, por_dia, unicos, coste_cents, presupuesto) -> float:
    err = 0.0; usos = {}
    for d, k in enumerate(combo):
        if not por_dia[d]: continue          # días vacíos NO contribuyen
        cand = por_dia[d][k]
        err += cand.error
        for fila in cand.filas: usos[fila] = usos.get(fila, 0) + 1
    rep = sum(max(0, u - 1) for u in usos.values())
    exceso = 0.0
    if presupuesto and presupuesto > 0:
        exceso = max(0.0, coste_cents - presupuesto) / presupuesto
    return err + LAMBDA_INGREDIENTES*unicos + MU_PRESUPUESTO*exceso + NU_REPETICION*rep
```

- **err**: suma de E_d de los días seleccionados. Es el término dominante por diseño.
- **unicos**: NO se recalcula aquí — se pasa desde el contador incremental (`contador.unicos`), que ya refleja el movimiento propuesto. Es decir, `_coste` recibe un valor que el llamante debe haber actualizado ANTES. Acoplamiento delicado de portar (ver el bucle SA).
- **exceso**: `coste_cents` viene de `cents_de(combo)` = `sum_d sum_i pool.coste_cents[fila_i] * sigma_i` multiplicado por `max(1, comensales)`. Si `presupuesto` es None o <= 0, el término es 0.
- **rep** (repetición blanda): `sum(max(0, usos(r)-1))` sobre TODAS las recetas del combo.

Calibración documentada (§5.1): E_d vive en [0, 0,12] y la unión de ingredientes en [40, 130]. lambda=0,006 → quitar 10 ingredientes de la lista vale lo mismo que empeorar un día en 6 puntos de desviación nutricional, casi todo su presupuesto de error. mu=0,30 → rebasar el presupuesto un 20 % cuesta 0,06, equivalente a degradar un día entero. nu=0,05 por repetición.

Nota: `unicos` es un entero típicamente 40-130, así que `LAMBDA_INGREDIENTES*unicos` aporta 0,24-0,78 al coste, mientras `err` con 7 días aporta 0-0,84. Están efectivamente al mismo nivel, que es el propósito.

Referencias: `services/solver/app/solver/semanal.py:186-220`, `services/solver/app/solver/semanal.py:244-254`, `services/solver/app/solver/__init__.py:126-129`, `services/solver/DISENO.md:846-881`

## Etapa D — restricciones duras (_viola_dura) y arranque voraz

**`_viola_dura(combo, por_dia) -> bool`** (`semanal.py:108-129`). Dos reglas, ambas de RECHAZO (el movimiento se descarta, no se penaliza):
```python
usos = {}; previo = None
for d, k in enumerate(combo):
    if not por_dia[d]: continue              # día vacío: se salta y NO actualiza `previo`
    cand = por_dia[d][k]
    for fila in cand.filas:
        usos[fila] = usos.get(fila,0) + 1
        if usos[fila] > MAX_USOS_RECETA_SEMANA: return True     # > 2 usos
    if previo is not None:
        pares_previos = set(zip(previo.slots, previo.filas, strict=True))
        if pares_previos & set(zip(cand.slots, cand.filas, strict=True)):
            return True                      # misma receta, mismo slot, dos días consecutivos
    previo = cand
```
Detalles para el port:
- La segunda regla compara PARES (slot, fila), no filas sueltas: la misma receta en slots distintos dos días seguidos es legal. En TS conviene codificar el par como `IDX_SLOT[slot]*P + fila` en un `Set<number>`.
- Un día vacío NO rompe la cadena de `previo`: se comparan los dos días no vacíos que lo rodean. Comportamiento de borde a preservar literalmente.
- Se llama con un combo PARCIAL desde `_arranque_voraz` (`combo` de longitud d+1 contra `por_dia[:d+1]`), así que debe tolerar `len(combo) == len(por_dia)`.

Codificarlas como penalización blanda dejaría que un buen término de ingredientes las comprara, y el usuario lo lee como fallo del producto.

**`_arranque_voraz(por_dia) -> list[int]`** (`semanal.py:132-157`):
```python
for d, cands in enumerate(por_dia):
    if not cands: combo.append(0); continue        # día vacío → índice 0 (nunca se indexa)
    orden = sorted(range(len(cands)), key=lambda k: (cands[k].error, k))
    elegido = orden[0]
    for k in orden:
        if not _viola_dura([*combo, k], por_dia[:d+1]): elegido = k; break
    combo.append(elegido)
```
El voraz ingenuo (argmin de error día a día) produce planes con la misma receta tres veces o dos cenas iguales seguidas; el recocido rechaza los movimientos que violan las duras pero nunca visita un estado que ya arrancó violándolas, así que devolvería el plan malo intacto. Si ningún candidato de un día es factible, se coge el de menor error y se sigue (fallback deliberado: un plan con una repetición de más es mejor que ningún plan).

Ordenación por `(error, k)` → desempate por índice de candidato, determinista.

Referencias: `services/solver/app/solver/semanal.py:108-157`, `services/solver/app/solver/__init__.py:130`

## Etapa D — contador incremental de ingredientes únicos

`bits_a_indices(bits) -> np.ndarray[int32]` (`semanal.py:45-54`): expande el bitset (W,) uint64 del día a un array de índices de alimento. Algoritmo: por cada palabra w, `b = (v & -v).bit_length() - 1` (lowest set bit), índice = `w*64 + b`, `v &= v - 1`.

**Para el port a TS**: `v & -v` sobre `int` de precisión arbitraria de Python funciona; en JS los operadores bitwise son de 32 bits con signo. Dos opciones: (a) guardar los bitsets como `Uint32Array` de 2W palabras y usar `31 - Math.clz32(v & -v)`; (b) usar `BigInt` con `BigInt.asUintN(64, ...)`. La opción (a) es mucho más rápida y además simplifica `np.bitwise_count(pool.bits & mascara)` en `score_slot`, que es el bucle caliente.

`_Contador` (`semanal.py:160-183`), `__slots__ = ('uso','unicos')`:
```python
uso = np.zeros(n_alimentos, dtype=np.int16)   # n_alimentos = pool.bits.shape[1] * 64
unicos = 0
anadir(indices): for b in indices: if uso[b]==0: unicos += 1; uso[b] += 1
quitar(indices): for b in indices: uso[b] -= 1; if uso[b]==0: unicos -= 1
```
Nótese el orden opuesto de las comprobaciones en `anadir` (comprobar antes de incrementar) y `quitar` (decrementar antes de comprobar). ~40 operaciones por movimiento en vez de ~500 de recalcular la unión; con 400 iteraciones baja la etapa D de ~40 ms a ~12 ms en Python.

Precálculo: `ingr = [[bits_a_indices(c.bits) for c in cands] for cands in por_dia]` — se hace UNA vez, antes del recocido (D*K = 42 expansiones).

Referencias: `services/solver/app/solver/semanal.py:45-54`, `services/solver/app/solver/semanal.py:160-183`, `services/solver/app/solver/semanal.py:238-242`, `services/solver/DISENO.md:883-905`

## Etapa D — el bucle de recocido simulado, literal

`SA_T0, SA_ALFA, SA_ITERACIONES = 0.05, 0.994, 400` (`__init__.py:131`). T_400 = 0,05 * 0,994^400 ≈ 0,00456.

Guardas previas (`semanal.py:231-261`):
- Si TODOS los días están vacíos → `ResultadoSemanal([], 0.0, 0.0, dias_vacios)` sin tocar el RNG.
- `combo = _arranque_voraz(por_dia)`; se inicializa el contador con los candidatos del arranque.
- `coste_inicial = coste_actual = coste_total(combo)`; `mejor, coste_mejor = list(combo), coste_actual`.
- **El recocido se salta entero si `d_total <= 1` o si ningún día tiene más de 1 candidato**: `if d_total > 1 and any(len(c) > 1 for c in por_dia)`. En ese caso el RNG de RUTA_D no se crea ni se consume.

Bucle:
```python
rng = rng_de(seed, RUTA_D)          # un solo flujo: el bucle es estrictamente secuencial
t = SA_T0
for _ in range(SA_ITERACIONES):     # 400
    d = int(rng.integers(d_total))                       # [1] SIEMPRE
    k_viejo = combo[d]
    if len(por_dia[d]) > 1:
        k_nuevo = int(rng.integers(len(por_dia[d])))     # [2] CONDICIONAL
        if k_nuevo != k_viejo:
            propuesta = list(combo); propuesta[d] = k_nuevo
            if not _viola_dura(propuesta, por_dia):
                contador.quitar(ingr[d][k_viejo])
                contador.anadir(ingr[d][k_nuevo])        # contador YA refleja la propuesta
                coste_nuevo = coste_total(propuesta)
                delta = coste_nuevo - coste_actual
                if delta < 0 or rng.random() < np.exp(-delta / max(t, 1e-9)):   # [3] CONDICIONAL + CORTOCIRCUITO
                    combo, coste_actual = propuesta, coste_nuevo
                    if coste_actual < coste_mejor:
                        mejor, coste_mejor = list(combo), coste_actual
                else:
                    contador.quitar(ingr[d][k_nuevo])    # deshacer
                    contador.anadir(ingr[d][k_viejo])
    t *= SA_ALFA                    # SIEMPRE, incluso si se saltó todo el cuerpo
```

Invariantes que el port DEBE preservar:
1. **`t *= SA_ALFA` está fuera de todos los `if`**: el enfriamiento avanza aunque el movimiento se rechace o ni se proponga.
2. **El contador se muta ANTES de `coste_total`** y se deshace en el `else`. Si la propuesta viola una dura o k_nuevo == k_viejo, el contador NO se toca.
3. **Se devuelve `mejor`, no `combo`.** El recocido termina en un estado arbitrario; sin memoria del mejor se puede devolver algo peor que el arranque voraz. El comentario del código lo llama "el error de implementación más común de SA".
4. `mejor` sólo se actualiza dentro de la rama de aceptación, con comparación estricta `<`.
5. `max(t, 1e-9)` evita división por cero.

Retorno:
```python
ResultadoSemanal(
    dias=[por_dia[d][k] for d, k in enumerate(mejor) if por_dia[d]],   # días vacíos se OMITEN
    coste_inicial=coste_inicial, coste_final=coste_mejor,
    dias_sin_candidato=dias_vacios,
)
```
**`dias` puede ser más corto que `objetivos`**, y `motor.py:279` lo detecta (`len(resultado.dias) != n_dias`) para devolver un fallo de pool. El port no debe "arreglar" esto rellenando huecos.

Espacio de búsqueda: 6^7 = 279.936 estados; 400 iteraciones es un muestreo deliberadamente ligero, justificado en §5.3 porque T0=0,05 es del orden de un delta-C típico (~0,03) y al inicio se acepta ~50 % de los empeoramientos.

Referencias: `services/solver/app/solver/semanal.py:223-298`, `services/solver/app/solver/__init__.py:131`, `services/solver/DISENO.md:907-938`

## RNG — mapa EXACTO de consumo de aleatoriedad (lo más sensible del port)

**Sólo hay tres puntos de consumo en todo el motor.** Verificado leyendo el código y comprobado empíricamente contra numpy 2.0.2.

## Árbol de semillas
`rng_de(seed, *ruta)` = `Generator(PCG64(SeedSequence(entropy=int(seed), spawn_key=tuple(ruta))))`. `RUTA_A, RUTA_D, RUTA_DESEMPATE = 0, 1, 2`.

Rutas usadas en C y D:
- `(RUTA_A, dia, k_cand, 0, IDX_SLOT[slot])` — selección inicial, un nodo por slot (reparacion.py:161).
- `(RUTA_A, dia, k_cand, k, IDX_SLOT[slot_culpable])` con k=1..3 — reparación, un nodo por intento (reparacion.py:221).
- `(RUTA_D,)` — el recocido entero, un único nodo (semanal.py:262-264).

## Punto 1 — `muestrear`, scoring.py:436
```python
return int(cand[rng.choice(cand.size, p=p)])
```
**Cada generador de RUTA_A se crea, se usa como máximo UNA vez y se descarta.** Además hay una salida temprana en scoring.py:427-428 (`if cand.size == 1: return int(cand[0])`) que consume CERO números aleatorios.

Verificado: `Generator.choice(n, p=p)` con `size=None` equivale exactamente a
```python
cdf = p.cumsum(); cdf /= cdf[-1]
u = rng.random()
idx = int(cdf.searchsorted(u, side='right'))
```
Es decir: **UN solo double y una búsqueda por CDF inversa**. Esto simplifica enormemente el port: toda la aleatoriedad de las etapas A y C se reduce a "un uniforme en [0,1) por nodo del árbol".

## Punto 2 — el recocido, semanal.py:267, 270, 279
Un único generador secuencial. Por iteración (400 en total), EN ESTE ORDEN:
1. `rng.integers(d_total)` — **siempre**.
2. `rng.integers(len(por_dia[d]))` — **sólo si `len(por_dia[d]) > 1`**.
3. `rng.random()` — **sólo si** `k_nuevo != k_viejo` **y** `not _viola_dura(...)` **y** `delta >= 0`. El `or` de Python cortocircuita: si `delta < 0` el `random()` NO se evalúa y NO se consume.

El número de extracciones depende de la trayectoria. Portar esto con evaluación ansiosa (calcular el uniforme antes del `if`) DESINCRONIZA el flujo y produce otro plan.

## Modelo de bajo nivel de numpy (verificado experimentalmente)
Si se quiere paridad bit a bit con el motor Python (planes guardados reproducibles), hay que replicar:

- **`rng.random()`** = `(next_uint64() >> 11) * 2**-53`. Consume una palabra de 64 bits fresca.
- **`rng.integers(n)`** con n < 2^32 = **Lemire de 32 bits sobre un flujo de uint32**, donde el flujo de uint32 se obtiene de cada uint64 tomando **primero los 32 bits BAJOS y luego los ALTOS**, con la mitad sobrante BUFFERIZADA en el bit generator (`has_uint32`/`uinteger` del estado de PCG64):
  ```
  w = siguiente_uint32()
  m = w * n                  # 64 bits
  leftover = m & 0xFFFFFFFF
  if leftover < n:           # rama de rechazo, prob. ~n/2^32
      threshold = (2**32 - n) % n
      while leftover < threshold: w = siguiente_uint32(); m = w*n; leftover = m & 0xFFFFFFFF
  return m >> 32
  ```
- **`random()` NO vacía el buffer de uint32**: si queda media palabra buffereada, sobrevive a través de una llamada a `random()` y la consume el siguiente `integers()`. Verificado con la secuencia mixta `[i(7), i(6), r, i(7), r, i(6)]`, que reproduce exactamente los valores de numpy con ese modelo.

En el bucle SA esto importa: cuando el paso 2 se salta (día con 1 solo candidato), la mitad alta de la palabra queda buffereada y la consume el paso 1 de la iteración SIGUIENTE.

## Consecuencia práctica para el port
Dos estrategias, hay que elegir explícitamente:

- **(A) Paridad total con Python**: implementar en TS SeedSequence (mezcla de entropía + spawn_key, `generate_state`), PCG64 (LCG de 128 bits con salida XSL-RR, requiere BigInt o aritmética de 64 bits en dos mitades), el buffer de uint32 y Lemire con rechazo. Son unas 150-250 líneas. Ventaja: cualquier plan generado por el backend Python se reproduce idéntico en el navegador y los tests dorados existentes valen tal cual.
- **(B) RNG propio normativo** (p.ej. splitmix64/xoshiro sembrado por un hash del `spawn_key`): mucho más simple y rápido, pero rompe la reproducibilidad contra Python y obliga a rebasear todos los tests dorados y a subir `VERSION_GENERADOR` (`__init__.py:171`, cuyo docstring advierte explícitamente de esto).

Recomendación: **(A)**, porque el diseño entero está construido alrededor de la reproducibilidad y porque el árbol de semillas ya garantiza que el flujo de un nodo no depende de cuántos números consuman los demás — es decir, la parte difícil (etapas A y C) se reduce a un único double por nodo, y sólo el bucle SA necesita el modelo completo con buffer.

Referencias: `services/solver/app/solver/__init__.py:167-192`, `services/solver/app/solver/reparacion.py:156-162`, `services/solver/app/solver/reparacion.py:217-222`, `services/solver/app/solver/semanal.py:262-291`, `services/solver/app/solver/scoring.py:404-436`, `services/solver/DISENO.md:936-938`

## Etapa D — reparar_duras, la pasada final

`reparar_duras(pool, ctx, objetivos, dias) -> (dias, arreglados)` (`semanal.py:301-378`). Se llama desde `motor.py:288` DESPUÉS de `ensamblar` y ANTES del umbral de honestidad.

Por qué hace falta pese a que la etapa A ya veta y el recocido ya rechaza: los K candidatos de un día se generan contra el *mejor provisional* de los días anteriores, y el recocido puede cambiar esos días. Si además ningún candidato del día es factible, el arranque voraz cede a propósito. Medido con 5 slots y 7 días sobre el catálogo semilla, eso dejaba pasar una receta usada 3 veces.

Algoritmo:
1. Contar `usos[fila]` sobre todos los días.
2. Para cada día d y cada posición pos: marcar `repetida = usos[fila] > 2` y `consecutiva = (ayer tiene el mismo slot con la misma fila)`. Si ninguna, continuar.
3. Residuo real del día fijando todo lo demás con los sigma actuales: `residuo = vector_objetivo(objetivos[d]) - sum_{otra != pos} sigma[otra]*nutr[otra]`.
4. Dos máscaras de exclusión, en orden de exigencia:
   - `base`: todas las filas del día (nunca repetir receta dentro del día) + la fila de ayer en ese slot si existe.
   - `estricta` = base + todas las `agotadas` (`usos >= MAX_USOS_RECETA_SEMANA`).
5. `nueva = mejor_alternativa(..., estricta)`; si None, `mejor_alternativa(..., base)`; si None, se deja como está y no se cuenta como arreglado. **Se cede la regla del tope semanal antes que la de días consecutivos**: el usuario percibe mucho más "otra vez lo mismo que ayer" que "esto ya salió el lunes".
6. Actualizar `usos[fila] -= 1`, `usos[nueva] += 1`, `filas[pos] = nueva`, `arreglados += 1`.
7. Si hubo cambios en el día: `dias[d] = recomponer_dia(pool, ctx, objetivos[d], cand.slots, filas, cand.intentos)` — se rehace el LP del día.

Detalles de portabilidad:
- **`dias` se MUTA en sitio y también se devuelve.** El día d se reemplaza mientras el bucle sigue, así que `ayer = dias[d-1]` ve el día ya reparado. Orden importante.
- `agotadas` se recalcula dentro del bucle interno con el `usos` actualizado, así que las sustituciones anteriores afectan a las siguientes.
- `cand.sigma` usado en el paso 3 es el del día ANTES de reparar (se lee de `cand`, no de `dias[d]`), incluso si ya se sustituyó otra posición del mismo día en una iteración previa del bucle interno. Es una aproximación consciente; el LP final lo corrige.
- No consume aleatoriedad en ningún punto.

Referencias: `services/solver/app/solver/semanal.py:301-378`, `services/solver/app/solver/motor.py:286-290`

## Coste computacional y veredicto Web Worker

## Recuento de operaciones (D=7 días, S=5 slots, K=6, R=3 reparaciones máx.)

**Llamadas a `score_slot` (el bucle caliente, O(P) cada una):**
- Por candidato de día: S (selección inicial) + n_rep (reparaciones efectivas, 0-3) → 5 a 8.
- Candidatos generados por día: K=6 en el caso bueno, hasta 2K=12 si hay duplicados.
- Total semana: **típico ~7 x 6,5 x 6,5 ≈ 300**; **peor caso 7 x 12 x 8 = 672**.
- Más `mejor_alternativa` en `reparar_duras`: 0 a 2 x D x S = 0-70, en la práctica 0-6.

**Coste de un `score_slot` con P recetas y W palabras de bitset:**
- ~25-40 flops por receta (arccos del encaje composicional, cociente de escala, desperdicio, coste, repetición) + W popcounts x2 (despensa y solape semanal).
- Con P=1500, W=16: ~1500 x (35 + 64) ≈ **1,5 x 10^5 operaciones**, de las cuales 1500 son `Math.acos` (caras: ~20-50 ns cada una en JS).
- Medido en NumPy: 50 us (P=1500) / 114 us (P=5000) (DISENO §7.1).
- **Estimación JS con TypedArrays, sin SIMD: 150-400 us** (factor 3-8x sobre NumPy; NumPy vectoriza y usa SIMD, JS no, pero evita el overhead de creación de arrays temporales si se escriben bucles manuales sobre buffers preasignados).

**Total scoring: 300-670 llamadas x ~250 us ≈ 75-170 ms** (P=1500). Con P=5000: **200-500 ms**.

**Llamadas al LP:** por candidato 1 + n_rep → total semana 7 x 6,5 x 2,5 ≈ 115, peor caso 7 x 12 x 4 = 336, más <=7 de `recomponer_dia`. Cada LP tiene R=3-5 variables sigma + 12 variables de holgura (u+/u- por nutriente) y 6 filas de igualdad + cotas. En NumPy+HiGHS: 64 us. **Un símplex denso en TS sobre una tabla de ~13x20 debería costar 30-150 us → 5-50 ms totales.** No es el cuello de botella.

**Recocido (etapa D completo):**
- 400 iteraciones x [`_viola_dura` ~D x R = 35 recetas + construcción de 2 Sets de pares por día → ~150-250 ops; `_coste` ~D x R = 35 + dict de usos → ~100 ops; `cents_de` ~35 mults; contador ~2 x 30 = 60 ops] ≈ **400-600 ops/iteración**.
- Total: **~2 x 10^5 operaciones → menos de 2 ms en JS.**
- Precálculo `bits_a_indices`: 42 candidatos x W=16 palabras → trivial.
- **Conclusión: la etapa D NO es el problema.** DISENO §7.1 le asigna 12 ms en Python; en JS será menos porque son bucles escalares sobre listas cortas, donde JS es competitivo con Python por un factor de 30-50x.

## Total estimado para una semana en el navegador
| P | Estimación |
|---|---|
| 1.500 | **120-250 ms** |
| 5.000 | **300-800 ms** |
| Un solo día | **20-40 ms** |

(No incluye la construcción del pool ni la carga del catálogo, fuera del ámbito de esta lectura.)

## Veredicto: SÍ hace falta Web Worker

Razones, en orden:
1. **120-800 ms de JS síncrono bloquean el hilo principal 7-50 frames.** No sólo se congela el scroll: no se puede ni animar el spinner que indica que está calculando. El presupuesto de un frame es 16 ms y aquí se rebasa por 10-50x.
2. **Sin worker no hay cancelación.** El usuario cambia un filtro y el motor sigue calculando el plan anterior hasta el final. Con worker basta con `terminate()` o un token de generación.
3. **Con worker se puede reportar progreso por día** (`generar_candidatos` ya es un bucle sobre días), que es lo que convierte 500 ms de espera opaca en una barra que avanza.
4. El coste de cruzar el límite del worker es despreciable: el catálogo se envía una vez al arrancar (structured clone o, mejor, `Transferable` sobre los `ArrayBuffer` de `nutr`, `bits`, `m_slot`, ...) y luego sólo van y vienen la petición y el plan.

**No hace falta `SharedArrayBuffer` ni paralelismo real.** GitHub Pages no puede enviar las cabeceras COOP/COEP que SAB exige, así que esa puerta está cerrada de todas formas — pero tampoco se necesita: un solo worker basta, y DISENO §7.3 ya decidió no paralelizar (los 42 candidatos son independientes pero la etapa D es intrínsecamente secuencial por `bits_semana`, §5.5).

**Notas de integración con Next.js static export bajo `/PlanEat/`:**
- La forma robusta es `new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' })`, que el bundler resuelve a un asset con hash y respeta `assetPrefix`/`basePath`.
- Si en su lugar se coloca un worker precompilado en `public/`, la URL debe construirse con el `basePath` (`/PlanEat/solver.worker.js`); una ruta absoluta `/solver.worker.js` da 404 en GitHub Pages.
- El worker debe cargar el catálogo por `fetch` relativo al mismo `basePath`, o recibirlo por `postMessage` desde la página.

Referencias: `services/solver/DISENO.md:1134-1180`, `services/solver/DISENO.md:1194-1222`, `services/solver/app/solver/semanal.py:266-291`, `services/solver/app/solver/scoring.py:307-367`

## Discrepancias entre DISENO.md §4-§5 y el código: portar el CÓDIGO, no el documento

Tres puntos donde el documento y la implementación no coinciden. El código es la especificación efectiva.

1. **Umbral de fallo por día.** §4.2 (línea 836) dice "Si tras los 3 intentos E > 0,12, el día se marca como fallido y se dispara §6". `reparacion.py` NO importa ni usa `UMBRAL_ERROR_ACEPTABLE`; la comprobación es única, sobre el peor día, en `motor.py:299-301`, y ocurre después de la etapa D y de `reparar_duras`.

2. **Items bloqueados.** §4.2 (líneas 838-840) describe saltar al siguiente kappa si el slot culpable está bloqueado (`ItemPlan.bloqueado = true`) y un culpable `items_bloqueados` para el diagnóstico. **No existe nada de eso en `reparacion.py`**: el único mecanismo de exclusión es el conjunto local `vetadas`. No inventarlo en el port.

3. **Pseudocódigo del recocido.** §5.3 (líneas 914-922) dibuja `alt <- rng.integers(K)` incondicional y "si viola una dura → contar iteración y seguir". El código real (`semanal.py:269-274`) sólo extrae `k_nuevo` si `len(por_dia[d]) > 1`, y además el `rng.random()` está detrás de un cortocircuito `delta < 0 or ...`. Implementar el pseudocódigo del documento produce un flujo de aleatoriedad distinto y, por tanto, otro plan.

Además, un detalle de precisión numérica que ningún documento menciona: `pool.nutr` es **float32** y `.astype(np.float64)` lo ensancha en varios puntos (reparacion.py:101, 175, 208, 264, 346; semanal.py:250 usa `pool.coste_cents` directamente). Los scores de `score_slot` también son float32. Si el port lo hace todo en `number` (float64) los resultados divergen desde el primer redondeo. Hay que usar `Float32Array` para el catálogo y `Math.fround` donde el original hace una operación en float32.

Referencias: `services/solver/DISENO.md:836`, `services/solver/DISENO.md:838-840`, `services/solver/DISENO.md:907-923`, `services/solver/app/solver/motor.py:299-301`, `services/solver/app/solver/semanal.py:266-291`, `services/solver/app/solver/reparacion.py:101`

## Riesgos

- **[alta]** Reproducibilidad del RNG: si el port no replica exactamente PCG64 + SeedSequence(spawn_key), el buffer de uint32 de numpy y Lemire-32 con rechazo, los planes generados en el navegador NO coincidirán con los del backend Python. Un plan guardado deja de ser reproducible y el bug es indepurable en soporte (advertencia explícita del docstring de __init__.py).
  - Mitigación: Implementar en TS el trío completo (SeedSequence.generate_state, PCG64 XSL-RR con BigInt o dos mitades de 32 bits, y el buffer has_uint32) — unas 150-250 lineas, verificables con vectores de prueba generados desde Python. Bancada de tests: para 200 rutas aleatorias comparar los primeros 10 valores de random()/integers(n) contra el volcado de numpy. Si se opta por un RNG propio, subir VERSION_GENERADOR y rebasear todos los tests dorados, asumiendo que los planes guardados por el backend no se reproducen.
- **[alta]** Cortocircuito y consumo condicional en el bucle SA: `delta < 0 or rng.random() < exp(...)` no consume el uniforme cuando delta<0, y `rng.integers(len(por_dia[d]))` sólo se extrae si el día tiene más de un candidato. Una traducción con evaluación ansiosa desincroniza el flujo desde la primera iteración y produce un plan distinto sin que nada falle visiblemente.
  - Mitigación: Portar el bucle literalmente, sin refactorizar los condicionales. Añadir un test que, para un seed fijo, compare la SECUENCIA de (d, k_nuevo, aceptado) de las 400 iteraciones contra un volcado del Python, no sólo el plan final.
- **[alta]** Funciones trascendentes no reproducibles entre motores: Math.exp aparece en la aceptación del SA (`np.exp(-delta/t)`) y en el softmax de `muestrear`; Math.acos aparece en el encaje composicional de score_slot. Ni el estándar ECMAScript ni la libm de CPython garantizan redondeo correcto, así que pueden diferir en 1 ULP. Una diferencia de 1 ULP puede voltear la comparación `rng.random() < exp(...)` o el orden del top-K, y a partir de ahí el plan diverge por completo.
  - Mitigación: Aceptar que la paridad exacta con Python no es alcanzable con exp/acos de biblioteca y decidir el criterio de aceptación: (a) tests que comparen métricas agregadas (error por día <= umbral, restricciones duras respetadas) en vez de igualdad del plan; o (b) implementar exp/acos deterministas propias (polinomios en float64) compartidas por Python y TS. Dentro de un mismo motor JS el resultado SÍ es estable, así que la reproducibilidad navegador-a-navegador del mismo Chrome/Firefox está garantizada; el riesgo real es Python vs navegador y entre motores distintos.
- **[alta]** Sustitución de HiGHS: la etapa C llama al LP entre 115 y 340 veces por semana. Un solver LP escrito a mano puede devolver un vértice distinto al de HiGHS en problemas degenerados, y el propio DISENO reconoce que EPS_REG=1e-3 existe precisamente porque sin él HiGHS devuelve un vértice arbitrario. Un LP con un criterio de pivote distinto rompe los sigma y, en cascada, culpabilidad() y todos los umbrales.
  - Mitigación: Fuera del ámbito de esta lectura (es porciones.py), pero condiciona C y D: el port del LP debe usar la regla de Bland o un desempate lexicográfico explícito para que el vértice sea único, y hay que validar con un banco de 500 problemas comparando sigma y error contra HiGHS. Alternativa si el símplex resulta inestable: dado que R<=5 variables acotadas y cuantizadas a PASO_RACION=0,05, el espacio es enumerable en el peor caso (25^5 = 9,7M, demasiado; pero con búsqueda por coordenadas desde el sigma de referencia es viable). Decidir esto ANTES de portar C.
- **[media]** Precisión float32 vs float64: el catálogo (pool.nutr, scores) es float32 y el motor lo ensancha a float64 en puntos concretos. Portar todo a `number` (float64) cambia los scores en el 7º dígito, lo que basta para reordenar el top-25 y cambiar la receta muestreada.
  - Mitigación: Usar Float32Array para nutr/scores/v_macro y Math.fround en las operaciones que el original hace en float32; usar Float64Array sólo donde el Python hace .astype(np.float64). Test: comparar el vector de scores completo de score_slot contra un volcado de Python con tolerancia 0.
- **[media]** Bloqueo del hilo principal: 120-800 ms de cómputo síncrono congelan la UI 7-50 frames, sin posibilidad de mostrar progreso ni de cancelar cuando el usuario cambia un filtro.
  - Mitigación: Ejecutar el motor en un Web Worker dedicado (`new Worker(new URL('./solver.worker.ts', import.meta.url), {type:'module'})` para que el bundler respete el basePath /PlanEat/). Enviar el catálogo una vez con ArrayBuffers transferibles. Emitir un mensaje de progreso por día desde el bucle de generar_candidatos. Implementar cancelación con token de generación o terminate(). No se necesita SharedArrayBuffer (GitHub Pages no puede enviar COOP/COEP) ni paralelismo: la etapa D es secuencial por bits_semana.
- **[media]** Semántica de bitsets en JS: bits_a_indices usa `(v & -v).bit_length()` sobre enteros de precisión arbitraria de Python; los operadores bitwise de JS son de 32 bits con signo y `pool.bits` es uint64. Una traducción ingenua produce índices de alimento erróneos, lo que corrompe silenciosamente el conteo de ingredientes únicos (el término lambda de la etapa D) y el término de solape de score_slot.
  - Mitigación: Reestructurar el bitset como Uint32Array de 2W palabras en lugar de uint64, y usar `31 - Math.clz32(v & -v)` para el bit más bajo y un popcount de 32 bits (SWAR) para np.bitwise_count. Es además la opción más rápida para el bucle caliente de score_slot. Test de equivalencia: para 1000 bitsets aleatorios, comparar el conjunto de índices contra Python.
- **[media]** Estado mutable compartido: generar_candidatos muta ctx.veto_semana, ctx.bits_semana y ctx.veto_slot entre días en un orden concreto; reparar_duras muta la lista `dias` en sitio mientras la recorre y lee `dias[d-1]` ya reparado; el _Contador del SA se muta antes de calcular el coste y se deshace en la rama de rechazo. Cualquier reordenación o copia defensiva bienintencionada cambia el resultado.
  - Mitigación: Portar estas tres funciones literalmente, con comentarios que marquen el orden como load-bearing. Evitar estructuras inmutables en estos tres sitios concretos aunque el resto del port las use. Test de regresión sobre el plan completo con seed fijo.
- **[baja]** Desempates por comparación de strings: muestrear y mejor_alternativa desempatan con `str(pool.ids[i])` y comparación lexicográfica de Python; JS compara por unidades de código UTF-16. Con ids ASCII (uuid, slug) es equivalente, pero con acentos o caracteres fuera del BMP el orden puede diferir.
  - Mitigación: Verificar que los ids del catálogo son ASCII; si no, normalizar a un id numérico entero estable en el catálogo compilado y desempatar por ese entero en ambos lados (cambio que habría que aplicar también al Python para mantener la paridad).
- **[baja]** Detalles estadísticos fáciles de equivocar: np.ndarray.std() es poblacional (ddof=0) y se usa en el softmax de muestrear; np.argsort(kind='stable') sobre -kappa necesita un sort estable en TS (Array.prototype.sort lo es desde ES2019, pero con NaN el comparador debe definirse explícitamente); min(candidatos, key=...) de Python devuelve el PRIMER mínimo en caso de empate.
  - Mitigación: Escribir helpers explícitos (stdPoblacional, argsortEstableDesc, minPorClave) con tests unitarios propios, y usarlos en lugar de expresiones ad-hoc.
- **[baja]** Casos de borde del ensamblado que un port podría 'arreglar' por error: ensamblar OMITE de la lista `dias` los días sin candidatos (el resultado es más corto que objetivos, y motor.py lo usa como señal de fallo de pool); _viola_dura salta los días vacíos sin actualizar `previo`, de modo que compara los dos días no vacíos que rodean el hueco; el arranque voraz cede deliberadamente si ningún candidato del día es factible.
  - Mitigación: Documentar los tres comportamientos como intencionados en el código TS y cubrirlos con tests que construyan explícitamente un por_dia con un día vacío en el medio.

---

# diagnostico

diagnostico.py es, para el port, el modulo mas facil de los cinco del solver: no usa LP ni RNG. Todo su numpy se reduce a reducciones booleanas AND/OR sobre vectores de N recetas, flatnonzero, max/min por columna y bitwise_count para el bitset de ingredientes excluidos. Se porta a TS con Uint8Array/Float32Array y bucles, sin dependencias externas.
Hace dos cosas. Fase 1 (diagnosticar_pool): ablacion leave-one-out sobre ~20 mascaras de restriccion que mide, por eje, cuantas recetas devolveria el pool si se quitara ESE eje y solo ese; el argmax de esa ganancia es restriccionCulpable, y las sugerencias son los siguientes ejes por ganancia, filtrando SIEMPRE los alergenos. Fase 2 (diagnosticar_objetivo): calcula cotas demostrables (proteina maxima por densidad, fibra maxima, kcal minimas, sodio minimo) y compara el objetivo contra ellas en un orden fijo de prioridad; los numeros de las sugerencias salen del mejor plan REAL construido (parametro alcanzado), no de la cota teorica, para que la sugerencia sea cierta cuando el usuario la aplica.
Las tres puertas de 6.0 NO estan en diagnostico.py sino en motor.py:246-262; diagnostico.py solo aporta el contador candidatos_por_slot, y el umbral derivado vive en motor._min_candidatos_slot. Hay que portar las tres piezas juntas o la puerta 3 (catalogo_estrecho) desaparece y el catalogo semilla de 36 recetas rechazaria el 100 % de las peticiones.
Riesgos principales: los textos son contrato de producto y usan formato Python :.0f, cuyo redondeo half-to-even no coincide con toFixed(0) de JS; el catalogo esta en float32 en Python y seria float64 en JS, lo que puede cambiar el ganador de un argmax de densidad casi empatado; _tres puede emitir sugerencias duplicadas y hay un test que exige 3 distintas; y el desempate del culpable en el codigo es alfabetico por clave, no por orden de insercion como dice DISENO.md.

## Las tres puertas de 6.0: donde estan de verdad y que distingue cada una

**Aviso de arquitectura: las puertas NO viven en `diagnostico.py`.** Estan implementadas en `motor.generar` (`motor.py:246-262`). `diagnostico.py` solo aporta el contador `candidatos_por_slot`. Si se porta `diagnostico.py` aislado, el port pierde la logica de disparo entera.

Constantes (`services/solver/app/solver/__init__.py:137-152`):

| Constante | Valor | Papel |
|---|---|---|
| `MIN_POOL` | 40 | umbral de CALIDAD del pool, no de rechazo |
| `MIN_CANDIDATOS_SLOT_DIA` | 3 | elegir + 2 reparaciones (horizonte 1 dia) |
| `MIN_CANDIDATOS_SLOT_SEMANA` | 8 | ceil(7/`MAX_USOS_RECETA_SEMANA`) + 4 de holgura |
| `FRACCION_POOL_ATRIBUIBLE` | 0.5 | frontera entre "tus filtros podan" y "el catalogo es corto" |

**Umbral por slot derivado** (`motor.py:129-144`), NO es una constante suelta:
```python
if n_dias <= 1: return MIN_CANDIDATOS_SLOT_DIA           # 3
holgura = MIN_CANDIDATOS_SLOT_SEMANA - ceil(7 / MAX_USOS_RECETA_SEMANA)  # 8 - 4 = 4
return min(MIN_CANDIDATOS_SLOT_SEMANA, ceil(n_dias / MAX_USOS_RECETA_SEMANA) + holgura)
```
Para n_dias = 2..7 da 5,6,6,7,7,8 (y se satura en 8). `MAX_USOS_RECETA_SEMANA = 2`.

**Las tres puertas, en este orden exacto** (`motor.py:249-262`):
```python
min_slot = _min_candidatos_slot(n_dias)
por_slot = candidatos_por_slot(pool, restr, slots)   # diagnostico.py:326
flojos   = {s: c for s, c in por_slot.items() if c < min_slot}
puerta_1 = bool(flojos)
puerta_2 = pool.p < MIN_POOL and pool.p < FRACCION_POOL_ATRIBUIBLE * cat.n
if puerta_1 or puerta_2:  -> diagnosticar_pool(...)  -> ok:false
if pool.p < MIN_POOL:     -> traza.catalogo_estrecho = True  y SE GENERA IGUAL
```

- **Puerta 1 - Viabilidad (dura).** Algun slot pedido tiene `|P_s| < min_slot`. Significado: no se puede ni llenar el plan sin repetir. Es por SLOT, con el tope de minutos de ESE slot (ver `_por_slot`, `diagnostico.py:317-323`), no con un tope global. Respuesta: `ok:false` + fase 1.
- **Puerta 2 - Atribucion.** `|P| < MIN_POOL` **y ademas** `|P| < 0.5 * N` (N = tamano del catalogo entero, `cat.n`). Significado: el pool es pequeno *y* la poda la han causado los filtros del usuario. Respuesta: `ok:false` + fase 1.
- **Puerta 3 - Catalogo corto.** `|P| < MIN_POOL` pero `|P| >= 0.5 * N`: los filtros apenas podan, el corto es el catalogo. Respuesta: **se genera el plan igual** y solo se anota `catalogo_estrecho` en la traza (no en la respuesta al usuario). El comentario del codigo es explicito: "culpar al usuario aqui seria mentirle".

**Por que existe la puerta 3** (DISENO.md:968-1011): el catalogo semilla tiene 36 recetas < 40, asi que un umbral absoluto `|P| < MIN_POOL` rechazaria el 100 % de las peticiones con un diagnostico que culpa al usuario de restricciones que no ha puesto. Los minimos por slot medidos del catalogo semilla son desayuno 11, almuerzo 8, comida 21, merienda 9, cena 22 - todos >= 8, por eso la puerta 1 no salta y se generan semanas correctas. Test que lo fija: `tests/test_solver.py:104-116` (`assert traza.catalogo_estrecho is True`).

DISENO tambien explica por que NO se baja `MIN_POOL` a 0 en desarrollo: entonces el diagnostico de sobre-restriccion (la funcionalidad de producto mas diferencial) no se ejercitaria nunca en local y se descubriria roto en produccion.

**Cuarto punto de disparo, distinto de las puertas**: tras generar, si `resultado.dias_sin_candidato` o faltan dias, se vuelve a llamar a `diagnosticar_pool` (`motor.py:279-284`) - pool agotado DENTRO del dia, no objetivo inalcanzable. Y el disparo de la fase 2 es `peor_dia.error > UMBRAL_ERROR_ACEPTABLE (0.12)` tras la etapa C (`motor.py:296-312`).

Referencias: `services/solver/app/solver/__init__.py:137-152`, `services/solver/app/solver/motor.py:129-144`, `services/solver/app/solver/motor.py:246-262`, `services/solver/app/solver/motor.py:279-284`, `services/solver/app/solver/motor.py:296-312`, `services/solver/app/solver/diagnostico.py:317-328`, `services/solver/DISENO.md:968-1011`, `services/solver/tests/test_solver.py:104-116`

## Atribucion de culpa: ablacion leave-one-out y catalogo completo de restriccionCulpable

### Construccion de las mascaras (`diagnostico.py:126-147`)
`mascaras_restriccion(cat, restr, slots)` devuelve un dict **ordenado** (dict de Python conserva orden de insercion) de mascaras booleanas de longitud N (catalogo COMPLETO, no el pool):

1. `"dieta"` -> `cat.m_dieta[:, IDX_DIETA[restr.dieta]]` (copia)
2. `"alergeno:<a>"` por cada alergeno excluido, recorriendo la tupla `ALERGENOS` en su orden canonico -> `~cat.m_alergeno[:, IDX_ALERGENO[a]]`
3. `"ingredientes_excluidos"` (solo si la lista no esta vacia) -> `bitwise_count(cat.ingr_bits & excl).sum(axis=1) == 0`, con `excl = bits_de(cat, restr.ingredientesExcluidos)`
4. `"tiempo:<slot>"` por cada slot pedido cuyo tope < `SIN_LIMITE_MINUTOS` (32767), recorriendo `sorted(set(slots), key=IDX_SLOT)` -> `cat.minutos <= topes[s]`
5. `"slots"` -> OR de `cat.m_slot[:, IDX_SLOT[s]]` sobre los slots pedidos. El comentario justifica su existencia: sin ella un pool "grande" podria no contener ninguna receta admisible en ningun slot pedido.

El orden de insercion es deliberado ("es el desempate determinista de la ablacion").

### La ablacion (`diagnostico.py:150-167`)
```python
p0 = AND_reduce(todas).sum()
for nombre in mascaras:
    resto = [m for k, m in mascaras.items() if k != nombre]
    base = AND_reduce(resto).sum() if resto else N
    ganancia[nombre] = base - p0
```
Ganancia = "cuantas recetas MAS tendrias si quitaras solo este eje". Coste ~20 reducciones AND sobre N booleanos (~2 ms segun DISENO). Es la unica forma de decir "+41 recetas" sin inventarse el numero.

**Ojo**: `p0` NO es igual a `pool.p`. El pool (`scoring.construir_pool`) se filtra con el MAXIMO de los topes de minutos y sin la mascara `slots`; la ablacion usa topes por slot y ademas exige admisibilidad en algun slot pedido. Por tanto `p0 <= pool.p` en general. Los mensajes usan `p0`; el campo `recetasCandidatas` usa `p_total = pool.p`. Es intencional (el contrato dice "|P| real") pero hay que replicarlo tal cual o los numeros del mensaje cambian.

### Eleccion del culpable (`diagnostico.py:220-224`)
```python
culpable = max(ganancia, key=lambda k: (ganancia[k], k)) if ganancia else "pool_insuficiente"
```
Desempate: mayor ganancia y, a igualdad, **clave alfabeticamente MAYOR**. Nota: DISENO.md:1036 dice "desempatando por el orden fijo de mascaras"; el codigo NO hace eso. El codigo manda.

### Filtro de seguridad de las sugerencias (`diagnostico.py:170-175`)
```python
ejes = [(k, g) for k, g in ganancia.items() if not k.startswith("alergeno:") and g > 0]
sorted(ejes, key=lambda kv: (-kv[1], kv[0]))
```
Se descartan TODOS los ejes de alergeno y los de ganancia 0 o negativa. Orden: ganancia descendente y, a igualdad, clave alfabeticamente MENOR (sentido inverso al desempate del culpable). Esta es la regla no negociable de spec 11.3: el alergeno puede SER el culpable y aparecer en el mensaje, pero jamas puede aparecer entre las sugerencias.

### Catalogo completo de valores de `restriccionCulpable`
Clave estable, legible por maquina; la web la mapea a botones y la analitica la agrega (DISENO.md:1126).

**Fase 1 (`diagnosticar_pool`)** - la rama del slot flojo tiene prioridad sobre todo lo demas:
- `slot_sin_candidatos:<slot>` (`diagnostico.py:236`) - se emite si `slots_flojos` no esta vacio; el slot elegido es `min(slots_flojos, key=(cuenta, IDX_SLOT[slot]))`, es decir el de menos candidatos y, a empate, el mas temprano del dia.
- `dieta`
- `alergeno:<a>` con a en {gluten, crustaceos, huevos, pescado, cacahuetes, soja, lacteos, frutos_de_cascara, apio, mostaza, sesamo, sulfitos, altramuces, moluscos}
- `ingredientes_excluidos`
- `tiempo:<slot>` con slot en {desayuno, almuerzo, comida, merienda, cena}
- `slots` (posible: es una clave de mascara y puede ganar el argmax; NO tiene rama de mensaje propia, cae en el `else` generico)
- `pool_insuficiente` (solo si `ganancia` esta vacio, es decir si no hay mascaras)

**Fase 2 (`diagnosticar_objetivo`)**, en orden de comprobacion:
- `kcal_insuficientes_para_slots`
- `proteina_vs_kcal`
- `fibra_inalcanzable`
- `sodio_inalcanzable`
- `objetivo_inalcanzable_generico`

**Fuera de `diagnostico.py`**, emitidos por el motor / la capa HTTP:
- `macros_incompatibles` (`motor.py:228-237`)
- `objetivo_mal_formado` (ruta HTTP, ver `tests/test_solver.py:930`)

Orden de prioridad declarado en DISENO.md:1101-1108: kcal_insuficientes_para_slots -> proteina_vs_kcal -> fibra_inalcanzable -> sodio_inalcanzable -> macros_incompatibles -> objetivo_inalcanzable_generico. **Discrepancia real**: en el codigo `macros_incompatibles` se comprueba el PRIMERO de todo (motor.py:224-239, antes incluso de construir el pool), no el quinto. El motivo esta comentado: cuesta 1 microsegundo y ahorra ~300 ms de trabajo inutil.

Referencias: `services/solver/app/solver/diagnostico.py:126-147`, `services/solver/app/solver/diagnostico.py:150-167`, `services/solver/app/solver/diagnostico.py:170-175`, `services/solver/app/solver/diagnostico.py:197-278`, `services/solver/app/solver/diagnostico.py:358-496`, `services/solver/app/solver/motor.py:224-239`, `services/solver/app/solver/scoring.py:133-180`, `services/solver/DISENO.md:1013-1054`, `services/solver/DISENO.md:1101-1108`, `services/solver/DISENO.md:1110-1130`

## Generacion de las 3 sugerencias y papel de KCAL_MINIMAS / KCAL_MINIMAS_ABSOLUTO

### El embudo `_tres` (`diagnostico.py:104-118`)
Contrato de producto: SIEMPRE exactamente `N_SUGERENCIAS = 3`. El comentario lo justifica: "ni dos (el usuario se siente en un callejon) ni cinco (deja de ser una decision y pasa a ser un formulario)".
```python
def _tres(sugerencias, relleno):
    salida = []
    for s in [*sugerencias, *relleno]:
        if s and s not in salida: salida.append(s)   # dedup por igualdad exacta
        if len(salida) == 3: break
    while len(salida) < 3:
        salida.append("Escribenos y ampliamos el catalogo con lo que te falta.")
    return salida
```
Detalle sutil: el bucle `for` comprueba `len(salida) == 3` DESPUES de intentar anadir, asi que un elemento duplicado tampoco rompe el conteo. El `while` final NO deduplica (ver riesgos).

### Fase 1 - de donde salen las tres (`diagnosticar_pool`, `diagnostico.py:206-216`)
- **Principales**: `[_frase_eje(e, g, restr) for e, g in ejes]`, con `ejes = _ejes_sugeribles(ganancia)` (ordenados por ganancia desc, sin alergenos, sin ganancia <= 0).
- **Relleno**, en este orden:
  1. `f"Planificar {len(slots)-1} comidas al dia en vez de {len(slots)}"` - solo si `len(slots) > 2`.
  2. `"Avisarte en cuanto el catalogo tenga mas recetas que te encajen"` - siempre.

Se usa el MISMO `_tres(sugerencias, relleno)` tanto en la rama `slot_sin_candidatos:<slot>` como en las demas ramas de fase 1.

### Fase 2 - las tres (`diagnosticar_objetivo`, `diagnostico.py:380-386`)
Se recalcula la ablacion y se construye el bloque **estructural** de relleno, comun a las cuatro ramas:
- `_frase_eje` del PRIMER eje sugerible (`ejes[:1]`, es decir como maximo uno).
- `f"Planificar {len(slots)-1} comidas al dia en vez de {len(slots)}"` si `len(slots) > 2`.

Y las sugerencias especificas por rama (ver el apartado de textos). El principio de calidad esta en el docstring del modulo y en el de `diagnosticar_objetivo`: los numeros **no salen de la cota teorica sino del mejor plan REAL** (`alcanzado`, vector de 6 nutrientes del peor dia). "Si decimos 'puedes llegar a 138 g', es porque hay un plan con 138 g". `alcanzado` puede ser `None`; entonces se cae a la cota (`prot_max` / `fibra_max`) y en la rama generica no se emite ninguna sugerencia especifica.

Hay un test que ejecuta literalmente esta promesa: `test_sugerencia_a_funciona` (`tests/test_solver.py:737-759`) parsea los gramos de la primera sugerencia con regex, reejecuta la peticion con ese minimo de proteina y exige `ok: true`.

### `_kcal_segura` y el suelo (`diagnostico.py:84-91`)
```python
def _kcal_segura(valor: float) -> int:
    return int(max(math.ceil(valor / 50) * 50, KCAL_MINIMAS_ABSOLUTO))
```
Dos efectos: redondea SIEMPRE hacia arriba a multiplo de 50, y aplica el suelo. Comentario: "si el usuario pide 400 kcal al dia, la salida honesta es subir a 1.200, no a 700".

- `KCAL_MINIMAS_ABSOLUTO = 1200` (`__init__.py:156`) es lo que USA el codigo, en los dos unicos sitios donde una sugerencia propone kcal:
  - `f"Subir a {_kcal_segura(kcal_min)} kcal al dia"` (rama kcal_insuficientes_para_slots)
  - `f"Subir a {kcal_necesarias} kcal al dia"` con `kcal_necesarias = _kcal_segura(prot_min_pedida / max(prot_max/kcal, 1e-9))` (rama proteina_vs_kcal)
- `KCAL_MINIMAS = {"hombre": 1500, "mujer": 1200}` (`__init__.py:155`) **NO se importa ni se usa en `diagnostico.py`**. Es espejo de `packages/shared/src/nutricion.ts:66` y el solver no conoce el sexo del usuario (no esta en `RestriccionesGeneracion`), asi que solo puede aplicar el suelo absoluto. DISENO.md:1043 y 1082 hablan de `KCAL_MINIMAS`; el codigo se queda deliberadamente en el minimo comun seguro. **En el port hay que mantener esta separacion**: si en el navegador se tuviera acceso al perfil, subir el suelo a `KCAL_MINIMAS[sexo]` seria un cambio de comportamiento, no una equivalencia.

### Regla del 25 %
En la rama de proteina, la sugerencia "Subir a X kcal" solo se ofrece si `kcal_necesarias <= kcal * 1.25`. Comentario: "por encima de eso deja de ser un ajuste y pasa a ser otro objetivo". DISENO.md:1082 lo expresa como "no supera el TDEE en mas del 25 %".

### Tests de seguridad que el port debe seguir pasando
- `test_nunca_sugiere_relajar_alergeno` (`tests/test_solver.py:658-684`): regex sobre las 3 sugerencias que prohibe cualquier mencion a alergen|gluten|lacteo|huevo|pescado|crustaceo|cacahuete|soja|frutos de cascara|apio|mostaza|sesamo|sulfito|altramuz|molusco.
- `test_nunca_sugiere_bajar_de_kcal_minimas` (`tests/test_solver.py:687-697`): todo numero que preceda a "kcal" en una sugerencia debe ser >= 1200.
- `test_siempre_exactamente_tres_sugerencias` (`tests/test_solver.py:637-655`): `len == 3` **y** `len(set(...)) == 3`.

Referencias: `services/solver/app/solver/diagnostico.py:84-91`, `services/solver/app/solver/diagnostico.py:104-118`, `services/solver/app/solver/diagnostico.py:206-216`, `services/solver/app/solver/diagnostico.py:380-386`, `services/solver/app/solver/diagnostico.py:414-425`, `services/solver/app/solver/__init__.py:152-156`, `packages/shared/src/nutricion.ts:66`, `services/solver/tests/test_solver.py:637-697`, `services/solver/tests/test_solver.py:737-759`, `services/solver/DISENO.md:1038-1044`

## Todos los textos en espanol que produce el modulo (transcripcion literal)

Transcritos con los acentos y los signos tipograficos exactos del fuente. `{...}` marca interpolacion; `:.0f` es formato Python de 0 decimales.

### Diccionarios de nombres legibles (`diagnostico.py:42-81`)
- `NOMBRE_DIETA`: omnivora->"omnivora" (con tilde: omnívora), vegetariana, vegana, pescetariana, baja_en_carbohidratos->"baja en carbohidratos", mediterranea->"mediterránea".
- `NOMBRE_ALERGENO`: gluten, crustaceos->"crustáceos", huevos, pescado, cacahuetes, soja, lacteos->"lácteos", frutos_de_cascara->"frutos de cáscara", apio, mostaza, sesamo->"sésamo", sulfitos, altramuces, moluscos.
- `NOMBRE_SLOT`: identidad para los cinco slots.
- `SLOT_CON_ARTICULO`: "el desayuno", "el almuerzo", "la comida", "la merienda", "la cena". Comentario: "con articulo, para que las sugerencias se lean como frases y no como etiquetas".

### Sugerencias por eje - `_frase_eje` (`diagnostico.py:178-194`)
| eje | plantilla |
|---|---|
| `dieta` | `Ampliar la dieta más allá de «{dieta}» (+{g} recetas)` |
| `ingredientes_excluidos` | `Revisar tus {n} ingredientes excluidos (+{g} recetas)` |
| `tiempo:<slot>` | `Subir el tiempo del {slot} de {t} a {t+10} min (+{g} recetas)` |
| `slots` | `Elegir otras comidas del día (+{g} recetas)` |
| cualquier otro | `Relajar «{eje}» (+{g} recetas)` |

Nota: se usan comillas latinas « » (U+00AB / U+00BB), no comillas rectas.

### Relleno
- `Planificar {n-1} comidas al día en vez de {n}`
- `Avisarte en cuanto el catálogo tenga más recetas que te encajen`
- Ultima instancia (`_tres`): `Escríbenos y ampliamos el catálogo con lo que te falta.` (unica que acaba en punto)

### Mensajes de fase 1 (`diagnosticar_pool`)
- `slot_sin_candidatos:<slot>`: `Sólo encuentro {cuantas} recetas para el {slot} con tus filtros, y necesito al menos {min_por_slot} para armar el plan sin repetir.`
- `alergeno:<a>`: `Excluir {alergeno} deja {p0} recetas. Mantenemos la exclusión: la seguridad va primero.`
- `dieta`: `La dieta {dieta} deja {p0} recetas para {n_slots} comidas al día, y no me da para un plan variado.`
- `ingredientes_excluidos`: `Tus {k} ingredientes excluidos dejan fuera {g} recetas y me quedo con {p0}.`
- `tiempo:<slot>`: `Con {t} min para el {slot} sólo quedan {p0} recetas.`
- resto (incluye `slots` y `pool_insuficiente`): `Tu combinación de filtros deja {p0} recetas y necesito al menos {MIN_POOL} para que el plan no se repita.`

### `macros_incompatibles` (`diagnostico.py:286-314`)
- `Los mínimos de macros que pides suman {minimo:.0f} kcal, más de las {kcal:.0f} kcal del día.`
- `Los máximos de macros que pides suman {maximo:.0f} kcal, menos de las {kcal:.0f} kcal del día.`
- Sus tres sugerencias son fijas y viven en `motor.py:232-236`: `Recalcular los macros a partir de tus kcal objetivo`, `Ampliar el rango de carbohidratos`, `Ampliar el rango de grasa`.

### Mensajes y sugerencias de fase 2 (`diagnosticar_objetivo`)
**`kcal_insuficientes_para_slots`**
- mensaje: `Con {n_slots} comidas al día, lo mínimo que puedo servir son {kcal_min:.0f} kcal, y tú pides {kcal:.0f}.`
- sug 1: `Quitar {slot_con_articulo}: el mínimo baja a {kcal_min_menos:.0f} kcal`
- sug 2: `Subir a {_kcal_segura(kcal_min)} kcal al día`

**`proteina_vs_kcal`**
- mensaje: `No consigo llegar a {prot_pedida:.0f} g de proteína con {kcal:.0f} kcal y las {p_total} recetas que quedan tras tus filtros. Lo más cerca que llego es {logrado:.0f} g.`
- sug 1: `Bajar el mínimo de proteína a {floor(logrado)} g`
- sug 2 (condicional al 25 %): `Subir a {kcal_necesarias} kcal al día`

**`fibra_inalcanzable`**
- mensaje: `Con estas recetas no llego a {fibraMinG:.0f} g de fibra; lo más alto que consigo son {logrado:.0f} g.`
- sug 1: `Bajar la fibra mínima a {floor(logrado)} g`

**`sodio_inalcanzable`**
- mensaje: `No consigo bajar de {logrado:.0f} mg de sodio con estas recetas, y tu tope son {tope:.0f} mg.`
- sug 1: `Subir el tope de sodio a {techo:.0f} mg` con `techo = ceil(logrado/100)*100`

**`objetivo_inalcanzable_generico`**
- mensaje base: `No encuentro una combinación que cuadre con tus objetivos y las {p_total} recetas disponibles.`
- detalle concatenado (solo si `alcanzado` no es None; **empieza por un espacio**): ` Lo más cerca que llego son {kcal:.0f} kcal con {prot:.0f} g de proteína.`
- sug 1: `Ampliar la tolerancia de calorías al {max(tol,0.03)*100+5:.0f} %` (con espacio antes del %)
- sug 2: `Bajar el mínimo de proteína a {floor(prot_alcanzada)} g`

### Observaciones de estilo que el port debe conservar
- Se usa "Sólo/sólo" con tilde diacritica (grafia antigua) de forma consistente.
- Los enteros se formatean SIN separador de miles: el codigo produce `Subir a 1750 kcal al día`, no "1.750". El ejemplo de DISENO.md:1119 escribe "1.750"; el codigo es la autoridad.
- Las sugerencias no llevan punto final; los mensajes si.
- Ninguna cadena esta externalizada a un fichero de i18n: el modulo es monolingue por diseno.

Referencias: `services/solver/app/solver/diagnostico.py:42-81`, `services/solver/app/solver/diagnostico.py:104-118`, `services/solver/app/solver/diagnostico.py:178-194`, `services/solver/app/solver/diagnostico.py:226-278`, `services/solver/app/solver/diagnostico.py:286-314`, `services/solver/app/solver/diagnostico.py:388-496`, `services/solver/app/solver/motor.py:228-237`

## Cotas demostrables de la fase 2: formulas exactas para el port

`cotas_alcanzables(pool, restr, slots, cuota, kcal)` (`diagnostico.py:331-355`) devuelve la tupla `(prot_max, fibra_max, kcal_min, sodio_min)`.

`_por_slot` (`diagnostico.py:317-323`) da, por slot, los indices del pool que cumplen `pool.m_slot[:, IDX_SLOT[s]] AND pool.minutos <= topes[s]`. Recorre `sorted(set(slots), key=IDX_SLOT)`.

Para cada slot s con al menos una fila (los slots vacios se SALTAN, no anulan la suma):
```
k        = max(nutr[filas, KCAL], 1e-6)          # elemento a elemento, float64
prot_max += kcal * cuota[s] * max(nutr[filas, PROT] / k)
fibra_max += kcal * cuota[s] * max(nutr[filas, FIBRA] / k)
kcal_min += min(nutr[filas, KCAL] * escala_min[filas])
sodio_min += min(nutr[filas, SODIO] * escala_min[filas])
```
- `prot_max` / `fibra_max` son cotas SUPERIORES validas porque asignan a cada slot la mejor densidad existente e ignoran las cotas de sigma (que solo pueden empeorarlo).
- `kcal_min` / `sodio_min` son cotas INFERIORES: ni comiendo la receta mas ligera en su racion mas pequena se baja de ahi. No dependen de `cuota`.

`cuota` viene de `scoring.cuotas_de(slots)`: `PESO_SLOT[s] / sum(PESO_SLOT)` sobre los slots pedidos, con `PESO_SLOT = {desayuno 0.22, almuerzo 0.10, comida 0.35, merienda 0.10, cena 0.28}`.

### Orden de comprobacion literal en `diagnosticar_objetivo`
1. `if kcal*(1+tol) < kcal_min and len(slots) > 1` -> `kcal_insuficientes_para_slots`. Se recalculan las cotas quitando `cuota_menor = min(slots, key=cuota[s])` para poder decir a cuanto baja el minimo. **Detalle deliberado**: la segunda llamada pasa `{s: cuota[s] for s in restantes}` SIN renormalizar - da igual porque `kcal_min` no usa `cuota`, y el `prot_max` de esa llamada se descarta. No "arreglarlo" en el port.
2. `if objetivo.proteinaG.min > prot_max` -> `proteina_vs_kcal`. `logrado = alcanzado[PROT]` si hay plan, si no `prot_max`. `kcal_necesarias = _kcal_segura(prot_min / max(prot_max/kcal, 1e-9))`.
3. `if float(objetivo.fibraMinG or 0.0) > fibra_max` -> `fibra_inalcanzable`.
4. `if sodioMaxMg is not None and alcanzado is not None and alcanzado[SODIO] > sodioMaxMg * 1.2` -> `sodio_inalcanzable`. Doble condicion importante: **la rama de sodio no usa `sodio_min` en absoluto** (se calcula y se descarta con `_sodio_min`), y exige un 20 % de margen antes de quejarse.
5. Cae al generico.

`macros_incompatibles(objetivo)` (`diagnostico.py:286-314`) es puramente algebraico: `minimo = 4*P.min + 4*C.min + 9*G.min`, `maximo = 4*P.max + 4*C.max + 9*G.max`; falla si `minimo > kcal*(1+tol)` o `maximo < kcal*(1-tol)`.

### Contrato de salida (`Fallo`, `diagnostico.py:94-102`)
Espejo interno de `schemas.FalloGeneracion`: `restriccionCulpable: str`, `mensaje: str`, `recetasCandidatas: int`, `sugerencias: list[str]`. `motor._a_contrato` lo traduce 1:1. `recetasCandidatas` es siempre `pool.p` (o 0 en el caso de macros incompatibles, donde el pool no se ha construido aun).

Referencias: `services/solver/app/solver/diagnostico.py:94-102`, `services/solver/app/solver/diagnostico.py:286-314`, `services/solver/app/solver/diagnostico.py:317-355`, `services/solver/app/solver/diagnostico.py:388-471`, `services/solver/app/solver/scoring.py:211-214`, `services/solver/app/solver/__init__.py:70-76`, `services/solver/DISENO.md:1056-1108`

## Guia concreta de port a TypeScript

**Buena noticia: este modulo no toca ninguno de los dos bloqueos.** No hay LP (eso es `porciones.py`) ni RNG con SeedSequence (eso es `__init__.rng_de`). Todo lo que necesita del navegador es aritmetica y bucles.

### Equivalencias numpy -> TS
| numpy | TS |
|---|---|
| mascara booleana `(N,)` | `Uint8Array(N)` |
| `np.logical_and.reduce(lista)` | bucle sobre indices con `&` acumulado; sal pronto si quieres, pero necesitas el `sum()` |
| `.sum()` de booleanos | contador entero |
| `np.flatnonzero(m)` | `Int32Array` construido en un bucle |
| `np.bitwise_count(a & b).sum(axis=1) == 0` | popcount sobre `BigUint64Array` o, mejor, dos `Uint32Array` por palabra + popcount de 32 bits (evita BigInt, que es lento) |
| `np.logical_or.reduce` | OR acumulado |
| `arr[filas, COL].max()` | bucle con `Math.max` |
| `dict` de Python | `Map` (conserva orden de insercion, igual que dict) - **no uses objeto plano**: las claves `alergeno:x` son strings no numericas asi que el orden se conservaria, pero `Map` es mas explicito y seguro |

### Reglas de paridad exacta
1. **Guarda `nutr` y `escala_min` como `Float32Array`**, no `Float64Array`. Python los tiene en float32 (`scoring.py:62-67`); si en TS son float64, las densidades `prot/kcal` difieren en el ultimo bit y un argmax casi empatado puede elegir otra receta -> otro numero en el mensaje.
2. **`:.0f` de Python NO es `toFixed(0)` de JS.** Python usa redondeo half-to-even sobre el double; JS `toFixed` redondea segun otra regla y ademas tiene rarezas conocidas (`(1.005).toFixed(2)`). Implementa un helper `fmt0(x)` que replique half-to-even si quieres paridad literal de los textos; si no, acepta que algun mensaje difiera en 1 unidad.
3. `math.floor` -> `Math.floor`; `math.ceil` -> `Math.ceil`. `int(...)` de un float positivo trunca -> `Math.trunc`.
4. **Desempates**: el argmax del culpable usa `(ganancia, clave)` con clave MAYOR ganando; `_ejes_sugeribles` ordena por `(-ganancia, clave)` con clave MENOR primero. Todas las claves son ASCII, asi que la comparacion de strings de JS (unidades UTF-16) coincide con la de Python (code points). `Array.prototype.sort` es estable desde ES2019, pero escribe el comparador completo igual.
5. `dict` de conteos por slot -> el `min(slots_flojos.items(), key=(cuenta, IDX_SLOT))` necesita el orden canonico de slots, no el de insercion.
6. Los textos llevan tildes, « » y ñ. Sirve el fichero como UTF-8 con `<meta charset>`; en GitHub Pages es lo por defecto pero conviene comprobarlo.

### Que hay que portar junto
`diagnostico.py` solo es util con: `motor._min_candidatos_slot` + el bloque de las tres puertas (`motor.py:246-262`), `scoring.topes_por_slot`, `scoring.bits_de`, `scoring.cuotas_de`, `SIN_LIMITE_MINUTOS` y la estructura `Pool`/`Catalogo` (campos usados aqui: `m_dieta`, `m_alergeno`, `ingr_bits`, `minutos`, `m_slot`, `n`, `alimento_idx` en el catalogo; `nutr`, `escala_min`, `m_slot`, `minutos`, `p` en el pool).

Referencias: `services/solver/app/solver/diagnostico.py:126-167`, `services/solver/app/solver/scoring.py:41-77`, `services/solver/app/solver/scoring.py:121-142`, `services/solver/app/solver/motor.py:246-262`

## Riesgos

- **[media]** _tres puede devolver sugerencias DUPLICADAS. El bucle for deduplica, pero el while final anade la misma cadena de ultima instancia ('Escribenos y ampliamos el catalogo con lo que te falta.') tantas veces como haga falta, sin comprobar duplicados. Escenario real: rama proteina_vs_kcal con 1 sugerencia especifica (la de kcal se descarta por la regla del 25 %), ablacion sin ejes sugeribles (todas las ganancias 0) y len(slots) <= 2 -> estructural vacio -> salida = [sug, filler, filler]. El test test_siempre_exactamente_tres_sugerencias exige len(set(...)) == 3.
  - Mitigación: Portarlo con el bug para tener paridad exacta, pero anadir un test que fuerce ese escenario. Si se decide corregir, usar una lista de rellenos genericos distintos y documentarlo como divergencia consciente respecto del Python, no como refactor silencioso.
- **[media]** El motor llama a diagnosticar_pool por segunda vez (motor.py:282) pasando `por_slot` COMPLETO como argumento `slots_flojos`, no el dict filtrado `flojos`. Como ese dict nunca esta vacio, la rama de slot_sin_candidatos siempre se dispara y produce mensajes incoherentes del tipo 'Solo encuentro 21 recetas para la comida ... y necesito al menos 8'.
  - Mitigación: Portar la llamada tal cual para no cambiar el comportamiento observable, pero registrarlo como bug conocido de producto y decidir explicitamente si se corrige en el port (pasar {} o filtrar) antes de desplegar en Pages, donde este camino se vera mas por catalogo corto.
- **[media]** Perdida de paridad numerica al pasar de float32 (numpy) a float64 (JS). Afecta a los argmax de densidad proteica/fibra de cotas_alcanzables y, por tanto, a que receta define la cota y a los numeros impresos en los mensajes; tambien puede cambiar el lado de la comparacion prot_min > prot_max en casos limite y con ello el restriccionCulpable elegido.
  - Mitigación: Almacenar nutr, escala_min y escala_max como Float32Array en el port y hacer las divisiones tras leer del Float32Array (JS redondea a float32 al escribir). Anadir un test de golden values contra las salidas del Python para el catalogo semilla.
- **[media]** Los textos son contrato de producto pero contienen formato Python :.0f, cuyo redondeo half-to-even no coincide con Number.toFixed(0). Un mensaje que en Python dice '1600 kcal' puede decir '1601' o '1599' en JS en valores frontera, y hay tests que parsean numeros de las sugerencias con regex (test_sugerencia_a_funciona, test_nunca_sugiere_bajar_de_kcal_minimas).
  - Mitigación: Implementar un helper fmt0/fmtN que replique el redondeo half-to-even de Python y usarlo en TODAS las interpolaciones numericas del modulo. Portar los tres tests de fallo honesto como tests de la version TS.
- **[alta]** Portar diagnostico.py aislado sin las tres puertas de motor.py:246-262 ni _min_candidatos_slot. El resultado seria un despliegue que aplica MIN_POOL = 40 como umbral absoluto y, con el catalogo semilla de 36 recetas, rechaza el 100 % de las peticiones en la demo publica de GitHub Pages culpando al usuario.
  - Mitigación: Tratar 'puertas + diagnostico' como una sola unidad de port. Como test de humo del despliegue, reproducir test_catalogo_semilla_genera_dia: debe devolver ok:true con la marca catalogo_estrecho, no un fallo.
- **[alta]** Regresion de la regla de seguridad de alergenos. Es un filtro por prefijo de string ('alergeno:') aplicado en un solo sitio (_ejes_sugeribles). Cualquier reescritura que reordene o inline esa funcion puede dejar que un alergeno se cuele entre las sugerencias, y el resultado seria sugerir a un alergico que coma el alergeno.
  - Mitigación: Aislar _ejes_sugeribles como unica puerta de entrada a las sugerencias estructurales, y portar test_nunca_sugiere_relajar_alergeno con su regex completa como test bloqueante de CI/build, no como test opcional.
- **[media]** Divergencias entre DISENO.md y el codigo que un port 'guiado por el documento' introduciria como bugs: (a) el desempate del culpable es alfabetico por clave, no por orden de insercion de mascaras (DISENO.md:1036); (b) macros_incompatibles se comprueba el PRIMERO, no el quinto del orden de prioridad (DISENO.md:1101-1108); (c) el codigo usa KCAL_MINIMAS_ABSOLUTO=1200, no KCAL_MINIMAS por sexo (DISENO.md:1043); (d) DISENO.md:1050-1054 describe una tabla PLANTILLAS con salidas que el codigo no genera (por ejemplo 'reactivar el ingrediente mas caro' o 'permitir dieta contigua').
  - Mitigación: Tomar diagnostico.py como unica fuente de verdad para el port y anotar estas cuatro divergencias en el DISENO.md al terminar, para que la proxima persona no las reintroduzca.
- **[baja]** p0 (de la ablacion) y p_total (pool.p) son magnitudes distintas y aparecen en el mismo Fallo: los mensajes usan p0, recetasCandidatas usa p_total. Un port que unifique ambos por parecer 'el mismo numero' cambiaria los textos y romperia test_proteina_imposible_identifica_culpable (assert recetasCandidatas == 36).
  - Mitigación: Mantener las dos variables separadas y con nombres distintos en TS, con un comentario que explique que la ablacion aplica topes por slot y la mascara 'slots' mientras que el pool solo aplica el tope global.
- **[baja]** np.bitwise_count requiere numpy >= 2.0 y en TS obliga a un popcount propio. Una implementacion con BigInt sobre BigUint64Array es correcta pero notablemente lenta y se ejecuta en el hilo principal del navegador dentro de la ablacion (una pasada por eje).
  - Mitigación: Representar ingr_bits como Uint32Array de 2*W palabras y usar el popcount clasico de 32 bits sin BigInt. Con 36-450 recetas el coste es despreciable, pero conviene fijar la representacion antes de escribir scoring y diagnostico para no tener dos formatos.
- **[baja]** En cotas_alcanzables los slots sin ninguna fila admisible se SALTAN silenciosamente (continue), de modo que sus cuotas se pierden y las cotas quedan sesgadas a la baja. En la practica no se llega ahi porque la puerta 1 ya habria fallado antes, pero si el port cambia el orden de las comprobaciones el sesgo se vuelve visible.
  - Mitigación: Replicar el continue tal cual y anadir una assert/invariante en desarrollo de que diagnosticar_objetivo solo se invoca cuando todos los slots superan min_slot.

---

# datos-contrato

catalogo.py es el único punto de contacto con disco: lee data/catalogo.jsonl (36 líneas JSON, una por receta), deriva un vocabulario alfabético de alimentos (66 ids presentes en recetas, no los 73 de ingredientes.json) y compila 15 arrays numpy alineados por índice de fila más dos diccionarios. El total ocupa 4,2 KB de memoria numérica con el catálogo semilla: en el navegador cabe entero en typed arrays sin discusión. La estructura es struct-of-arrays pura, así que el port natural a TS son Float32Array/Int16Array/Uint8Array planos con stride, sustituyendo las máscaras booleanas (n,k) por bitmasks de un entero por fila y los bitsets uint64 por Uint32Array con popcount SWAR (JS no tiene np.bitwise_count y BigInt64Array es lento). El contrato HTTP es minúsculo: GET /health y POST /v1/plan/generate, con la particularidad de que un fallo diagnosticado es 200 con ok:false y sólo la petición mal formada es 422 — y hay DOS cuerpos distintos de 422 (el del motor, con forma RespuestaError, y el de pydantic/FastAPI, con forma {detail:[...]}). Tres datos imprescindibles para reproducir un plan (seed, versión de catálogo, versión de generador) viajan sólo en cabeceras X-PlanEat-*, cosa que desaparece al portar al navegador: hay que meterlos en el payload. Del catálogo, el motor usa 15 campos y la UI otros 6; titulos, ingredientesPerecederos, alimento_id/n_alimentos son peso muerto en el motor, y racionesBase y revisadaPor ni siquiera se cargan. Empaquetado: catalogo.jsonl 21,5 KB (3,4 KB gzip) e ingredientes.json 28 KB (3,8 KB gzip); con GitHub Pages sirviendo gzip, embeber el catálogo compilado en el bundle es lo correcto y el fetch sólo se justifica para recetas.json (pasos y gramos, 36 KB) si se quiere lista de la compra. Las discrepancias schemas.py↔types.ts son reales pero acotadas: opcionalidad divergente en 7 campos, PanelNutricional reutilizado con dos semánticas incompatibles (por 100 g vs totales del día), y tipos TS (Alimento, Receta, Ingrediente.escalable, FuenteNutricional) que no encajan con los ficheros de datos que dicen describir.

## 1a. Formato exacto de catalogo.jsonl (lo único que lee el motor)

36 líneas, una receta por línea, JSON sin saltos internos. Las 17 claves son SIEMPRE las mismas (verificado sobre las 36 filas):

| Clave | Tipo | Ejemplo | ¿La lee catalogo.py? |
|---|---|---|---|
| `id` | str | `"avena_yogur_arandanos"` | sí |
| `titulo` | str | `"Avena con yogur griego y arándanos"` | sí |
| `racionesBase` | int (1 o 2) | `1` | **NO** |
| `nutr` | list[float] de 6 | `[404.22, 22.46, 54.76, 11.16, 7.0, 54.5]` | sí |
| `conocido` | list[bool] de 6 | `[true]*6` | sí (default `[True]*6`) |
| `minutos` | int | `5` (máx real 40) | sí |
| `dietas` | list[str] | `["omnivora","pescetariana","vegetariana"]` | sí |
| `alergenos` | list[str] | `["gluten","lacteos"]` | sí |
| `slots` | list[str] | `["desayuno","merienda"]` | sí |
| `ingredientes` | list[str] ordenada | `["arandanos","avena_copos","miel","yogur_griego"]` | sí |
| `ingredientesPerecederos` | list[str] | `["arandanos","yogur_griego"]` | sí (default `[]`) |
| `costeCents` | int | `166` (máx 545) | sí (default `0`) |
| `costeConocido` | bool | `true` (36/36 lo son) | sí (default `False`) |
| `escalaMin` | float | `0.6` (constante hoy) | sí (default 0.6) |
| `escalaMax` | float | `1.8` (constante hoy) | sí (default 1.8) |
| `revisadaPor` | null | `null` siempre | **NO** |

Orden fijo de `nutr` y `conocido` (= `solver.NUTRIENTES`, `app/solver/__init__.py:21`): **kcal, proteina, carbohidrato, grasa, fibra, sodio**. kcal en kcal, macros y fibra en gramos, sodio en **mg** (no sal). Todo **por ración base**, ya dividido entre `racionesBase` por el generador.

Los valores son magnitudes por ración base: `factorRacion` (σ del LP) multiplica la fila entera de forma uniforme (`motor.py:174`, `pool.nutr[fila] * sigma`).

El fichero es GENERADO por `scripts/construir_catalogo.py` desde `ingredientes.json` + `recetas.json`. Ese script deriva nutrición (suma de panel*g/100, dividida entre raciones), alérgenos (unión), dietas (`derivar_dietas`, con los conjuntos CARNE/PESCADO_Y_MARISCO/LACTEO/HUEVO/OTRO_ANIMAL codificados a mano en el propio script, `construir_catalogo.py:37-48`) y coste (primer `formatosCompra` con `precioEstimadoCents`). El umbral `baja_en_carbohidratos` es `< 25 g` por ración. `mediterranea` sí se declara a mano en recetas.json.

Referencias: `services/solver/data/catalogo.jsonl:1`, `services/solver/app/catalogo.py:139-164`, `services/solver/app/solver/__init__.py:21-30`, `services/solver/scripts/construir_catalogo.py:169-196`

## 1b. Estructuras que produce cargar_catalogo(): formas, dtypes y significado exacto

Medido ejecutando el loader real con el catálogo semilla (n=36 recetas, 66 alimentos, W=2 palabras uint64). `version` resultante: `6b4fe8f81196dd7e`.

**Invariante maestro** (docstring del módulo): *todos* los arrays están alineados por índice de fila; la fila `i` es la misma receta en todos ellos. Nada del motor puede romper esto.

| Campo | Forma | dtype | bytes | Significado |
|---|---|---|---|---|
| `version` | escalar str | — | — | `sha256(bytes del fichero).hexdigest()[:16]` |
| `ids` | (36,) | object | 288 | id de receta por fila |
| `idx_por_id` | dict[str,int] | — | — | inverso de `ids`; lanza si hay duplicados |
| `titulos` | (36,) | object | 288 | título legible |
| `nutr` | (36, 6) | **float32** | 864 | kcal, prot, carb, grasa, fibra, sodio (por ración base) |
| `conocido` | (36, 6) | bool | 216 | por nutriente: `false` = "no lo sé", NO "cero" |
| `v_macro` | (36, 3) | float32 | 432 | vector unitario de composición macro (ver abajo) |
| `tiene_macro` | (36,) | bool | 36 | `4P+4C+9G > 0` |
| `escala_min` | (36,) | float32 | 144 | cota inferior de σ en el LP (0.6) |
| `escala_max` | (36,) | float32 | 144 | cota superior de σ (1.8) |
| `m_dieta` | (36, 6) | bool | 216 | columnas en orden `DIETAS` |
| `m_alergeno` | (36, 14) | bool | 504 | columnas en orden `ALERGENOS` (14 de la UE) |
| `m_slot` | (36, 5) | bool | 180 | columnas en orden `SLOTS` |
| `minutos` | (36,) | **int16** | 72 | prep+cocción; el centinela "sin tope" es 32767 (`scoring.py:41`) |
| `ingr_bits` | (36, 2) | **uint64** | 576 | bitset de alimentos |
| `ingr_perec_bits` | (36, 2) | uint64 | 576 | bitset de perecederos |
| `n_ingredientes` | (36,) | int16 | 72 | `len(ingredientes)` |
| `alimento_idx` | dict[str,int] | — | — | id de alimento → nº de bit |
| `alimento_id` | list[str] | — | — | inverso, ordenado alfabéticamente |
| `coste_cents` | (36,) | int32 | 144 | por ración base |
| `coste_conocido` | (36,) | bool | 36 | si el coste es completo |

**Total de las matrices numéricas: 4.212 bytes.** Propiedades: `n` = `ids.shape[0]`, `n_alimentos` = `len(alimento_id)`.

**Vocabulario de alimentos (crítico para el port).** `todos = sorted({a for f in filas for a in f['ingredientes']})` — se construye SÓLO desde los ids que aparecen en el jsonl, no desde ingredientes.json: hoy salen **66**, no 73 (sobran `alubias_cocidas, lomo_cerdo, mozzarella, muslo_pollo, queso_curado, soja_texturizada, tempeh`). `palabras = max(1, ceil(len/64))` = 2. El comentario de `catalogo.py:115-118` es normativo: el orden debe ser determinista entre procesos o los bitsets cacheados dejan de ser comparables. Verificado que los 66 ids son ASCII puros, así que `Array.prototype.sort()` de JS (orden por unidad UTF-16) coincide con `sorted()` de Python (orden por code point). Los títulos **no** son ASCII, pero no se ordenan.

**_bitset** (`catalogo.py:81-89`): `fila[bit >> 6] |= 1 << (bit & 63)`, uint64. Los ids desconocidos se ignoran en silencio.

**v_macro** (`catalogo.py:170-188`), el término que decide la etapa A:
```
kcal_macro = 4*P + 4*C + 9*G          # Atwater, NO la kcal declarada
tiene_macro = kcal_macro > 0
seguro = where(tiene_macro, kcal_macro, 1.0)
fracciones = [4P/seguro, 4C/seguro, 9G/seguro]     # (n,3)
normas = ||fracciones||_2 por fila
v_macro[tiene_macro] = fracciones / normas   # 0 en las filas sin macro
```
El comentario justifica por qué se normaliza con la kcal de Atwater y no con la declarada: si el panel dice 320 y los macros suman 298, las fracciones no suman 1 y el coseno de la etapa A queda sesgado. La kcal declarada se sigue usando para todo lo demás.

**Errores que lanza:** `FileNotFoundError` si no existe el fichero (con instrucción de regenerarlo), `ValueError` si está vacío, `ValueError` si hay ids de receta duplicados.

Referencias: `services/solver/app/catalogo.py:36-78`, `services/solver/app/catalogo.py:81-89`, `services/solver/app/catalogo.py:106-137`, `services/solver/app/catalogo.py:115-121`, `services/solver/app/catalogo.py:170-188`

## 1c. Equivalente razonable en TypeScript para el navegador

Mantener **struct-of-arrays con stride**, no un array de objetos: todo el motor está escrito bajo la regla "si un bucle for itera sobre recetas, es un bug" (`scoring.py:7-9`), y aunque en JS no se puede vectorizar, un bucle sobre un `Float32Array` plano es 5-20× más rápido que sobre objetos y es traducción literal del original.

```ts
export interface Catalogo {
  version: string;              // constante de build, no se recalcula
  n: number;
  nAlimentos: number;
  ids: string[];                // (n)
  idxPorId: Map<string, number>;
  titulos: string[];            // (n)  — sólo UI
  nutr: Float32Array;           // (n*6) row-major: nutr[i*6 + IDX_KCAL]
  conocido: Uint8Array;         // (n*6) 0/1
  vMacro: Float32Array;         // (n*3)
  tieneMacro: Uint8Array;       // (n)
  escalaMin: Float32Array;      // (n)
  escalaMax: Float32Array;      // (n)
  mDieta: Uint8Array;           // (n) bitmask de 6 bits  (ver nota)
  mAlergeno: Uint16Array;       // (n) bitmask de 14 bits
  mSlot: Uint8Array;            // (n) bitmask de 5 bits
  minutos: Int16Array;          // (n)
  ingrBits: Uint32Array;        // (n*W32)  W32 = ceil(nAlimentos/32) = 3 hoy
  ingrPerecBits: Uint32Array;   // (n*W32)
  nIngredientes: Int16Array;    // (n)
  alimentoIdx: Map<string, number>;
  alimentoId: string[];
  costeCents: Int32Array;       // (n)
  costeConocido: Uint8Array;    // (n)
}
```

Decisiones y su porqué:

1. **Float32Array, no number[].** No es sólo memoria: `nutr` y `v_macro` son float32 en Python y todo el scoring opera en float32 (numpy 2.5 con NEP 50 mantiene float32 al multiplicar por escalares Python). Si en TS se usa float64, el coseno de la etapa A y el softmax difieren en el bit 24 y en un empate el `muestrear()` puede elegir otra receta. Con `Float32Array` los redondeos coinciden en almacenamiento; para las operaciones intermedias hace falta `Math.fround()` en cada paso si se quiere paridad bit a bit. **Alternativa más barata y recomendable: precalcular `v_macro` en el build (Python) y embeberlo ya redondeado**, así el único punto sensible desaparece.

2. **Máscaras booleanas (n,k) → un entero por fila.** `m_dieta` (6 columnas), `m_alergeno` (14) y `m_slot` (5) caben en 6/16/5 bits. El filtro base de `scoring._idx_base` (`m &= ~m_alergeno[:,a]`, `m &= minutos <= tope`) se convierte en un único bucle con `(mDieta[i] >> idxDieta & 1) && !(mAlergeno[i] & maskAlergenos) && minutos[i] <= tope`. Es más rápido y más corto que replicar las columnas. Si se prefiere traducción literal, `Uint8Array(n*k)` también vale.

3. **Bitsets: Uint32Array, NO BigUint64Array.** JS no tiene `np.bitwise_count` y las operaciones bitwise sobre BigInt son ~10× más lentas que sobre enteros de 32 bits. Con W32 = ceil(66/32) = 3 palabras, el popcount es el SWAR clásico:
```ts
function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}
```
Esto sustituye los 4 usos de `np.bitwise_count(... & ...).sum(axis=1)` (`scoring.py:158,355,364` y `diagnostico.py:139`). Ojo: `semanal._Contador` se dimensiona con `pool.bits.shape[1]*64` (`semanal.py:239`); con palabras de 32 hay que cambiarlo a `*32`, o sobredimensionar sin más (el array de uso es `Int16Array`, da igual).

4. **Fancy indexing (`cat.nutr[idx]`).** Los 13 gathers de `construir_pool` (`scoring.py:167-179`) se vuelven bucles que copian a typed arrays nuevos del tamaño del pool. Conviene una función genérica `gatherRows(src, idx, stride)`.

5. **`np.flatnonzero(m).astype(np.int32)`** → un bucle que llena un `Int32Array` con contador; nada de `filter/map` sobre arrays de objetos.

6. **`version`.** Sólo se usa como clave de caché del pool (`scoring.py:101`) y como cabecera. En el navegador NO merece la pena calcular sha256 con `crypto.subtle` (es async y contaminaría todo el arranque): inyéctalo como constante de build junto con el catálogo compilado.

7. **Formato de entrega.** Lo más limpio es que el script de build (una variante de `construir_catalogo.py`) emita directamente el catálogo **ya compilado** en JSON columnar (arrays planos de números + los arrays de strings), y que el TS lo pase a typed arrays con un `new Float32Array(json.nutr)`. Así el navegador no repite el `sorted()` del vocabulario ni el cálculo de v_macro, que son los dos puntos donde una divergencia rompería el determinismo.

Referencias: `services/solver/app/catalogo.py:36-78`, `services/solver/app/solver/scoring.py:88-96`, `services/solver/app/solver/scoring.py:158-179`, `services/solver/app/solver/semanal.py:45-52`, `services/solver/app/solver/semanal.py:239`

## 2. Contrato HTTP completo de main.py

Sólo hay **dos rutas** propias. FastAPI añade `/docs`, `/redoc` y `/openapi.json` por defecto. **No hay middleware de CORS**: el navegador no puede llamar al solver directamente, de ahí el proxy `apps/web/src/app/api/plan/route.ts`. App: `title="PlanEat Solver"`, `version="0.1.0"`.

### GET /health
200 siempre. Cuerpo `dict[str,str]` — **todos los valores son cadenas, incluido el número de recetas**:
```json
{"status":"ok","version":"0.1.0","catalogo":"6b4fe8f81196dd7e","recetas":"36","generador":"1.0.0"}
```

### POST /v1/plan/generate  (tags: ["plan"])
Petición: `SolicitudGeneracion` (schemas.py:69). Cuerpo:
```jsonc
{
  "objetivos": [ { "kcal": 2100, "toleranciaKcal": 0.03,
                   "proteinaG": {"min":120,"max":141},
                   "carbohidratoG": {"min":..,"max":..},
                   "grasaG": {"min":..,"max":..},
                   "fibraMinG": 29, "sodioMaxMg": null } ],   // 1 por día
  "restricciones": {
    "dieta": "omnivora",
    "alergenosExcluidos": [],
    "ingredientesExcluidos": [],          // ids de ALIMENTO, no de receta
    "slots": ["desayuno","comida","cena"],
    "minutosMaxPorSlot": {"comida": 30},  // o null
    "comensales": 1,
    "presupuestoSemanalCents": null,
    "despensaAlimentoIds": [],
    "recetasRecientes": []
  },
  "seed": null
}
```
El número de días = `len(objetivos)`. `slots` es común a todos los días.

**Códigos de estado y sus cuerpos (tres desenlaces, no dos):**

1. **200 · éxito.** `RespuestaOk.model_dump()` → `{"ok": true, "dias": DiaPlan[], "msTranscurridos": int}`. `msTranscurridos = max(1, int((perf_counter()-t0)*1000))` (`motor.py:318`). Cabeceras: `X-PlanEat-Seed`, `X-PlanEat-Catalogo`, `X-PlanEat-Generador` **y `X-PlanEat-Pool`** (tamaño del pool; sólo en éxito).

2. **200 · fallo diagnosticado.** `{"ok": false, "fallo": {restriccionCulpable, mensaje, recetasCandidatas, sugerencias[]}}` + las tres cabeceras (sin `X-PlanEat-Pool`). El docstring de `main.py:68-73` lo justifica explícitamente: *un fallo diagnosticado NO es un error de la petición*; devolverlo como 4xx obligaría a la web a tratarlo como excepción. `sugerencias` son siempre exactamente 3 (`N_SUGERENCIAS`). Se emite desde 4 puntos del motor: macros incompatibles, puertas del pool, candidatos por slot, y error residual > `UMBRAL_ERROR_ACEPTABLE` (0.12) tras reparar.

3. **422 · petición mal formada.** Aquí hay **dos cuerpos distintos**, y esto es una trampa real del contrato:
   - Si `motor.generar` lanza `ObjetivoInvalido` (rango invertido, kcal ≤ 0, tolerancia fuera de [0, 0.5], sin objetivos, sin slots — ver `_validar`, `motor.py:91-124`): cuerpo con forma `RespuestaError`, `restriccionCulpable: "objetivo_mal_formado"`, `mensaje = str(e)`, `recetasCandidatas: 0` y estas 3 sugerencias literales: *"Revisa que el mínimo de cada macro no supere su máximo"*, *"Comprueba que las kcal objetivo sean mayores que cero"*, *"Vuelve a calcular los objetivos desde tu perfil"*. **Sin cabeceras X-PlanEat-***.
   - Si falla la validación de pydantic antes de entrar al handler (tipo incorrecto, campo obligatorio ausente): FastAPI devuelve su forma por defecto `{"detail":[{"loc":[...],"msg":...,"type":...}]}`, que NO es `RespuestaError`. `apps/web/src/lib/solver.ts:120-132` lee `fallo?.mensaje` con `?? ""`, así que degrada sin romper, pero pierde el mensaje.

Detalle menor: el parámetro `respuesta: Response` del handler está declarado y **no se usa** (las cabeceras se ponen en el `JSONResponse`). Se puede borrar en el port.

### Mapeo a packages/shared/src/types.ts
`RespuestaGeneracion` (types.ts:228) es la unión discriminada exacta de `RespuestaOk` | `RespuestaError`. Coinciden campo a campo: `DiaPlan{fecha, comidas, totales, objetivo}`, `ComidaPlan{slot, items, totales}`, `ItemPlan{recetaId, factorRacion, bloqueado}`, `FalloGeneracion{restriccionCulpable, mensaje, recetasCandidatas, sugerencias}`, `Rango{min,max}`, `ObjetivoNutricional`. Los desajustes están en el hallazgo 5.

**Consecuencia para el port a navegador:** desaparecen las cabeceras HTTP, y con ellas los tres datos sin los cuales *"un plan guardado no se puede volver a construir"* (`main.py:76-80`). Hay que extender `RespuestaOk`/`RespuestaGeneracion` con `seed`, `versionCatalogo`, `versionGenerador` (y opcionalmente `pool`) en el payload. Es un cambio deliberado del contrato, no un descuido, y hay que hacerlo también en `schemas.py` si se quiere mantener la paridad para los tests.

Referencias: `services/solver/app/main.py:30-52`, `services/solver/app/main.py:55-111`, `services/solver/app/motor.py`, `services/solver/app/solver/motor.py:91-124`, `services/solver/app/solver/motor.py:300-320`, `packages/shared/src/types.ts:210-230`, `apps/web/src/lib/solver.ts:100-142`

## 3. Qué campos usa realmente el motor y cuáles sólo la UI

Conteo hecho por búsqueda de `cat.<campo>` / `pool.<campo>` sobre `app/` (excluyendo tests).

**Usados por el motor (15):**

| Campo | Dónde y para qué |
|---|---|
| `version` | clave de la caché de pool (`scoring.py:101`) + cabecera |
| `ids` | copia al pool; `str(pool.ids[fila])` es el `recetaId` de salida (`motor.py:181`); desempate determinista por id (`reparacion.py:287`) |
| `idx_por_id` | resolver `recetasRecientes` a filas (`scoring.py:245`) |
| `nutr` | LP de porcionado, totales del panel, término de ajuste |
| `conocido` | fibra fiable ≥80 % de las kcal y sodio: si no está todo conocido, se ignora `sodioMaxMg` (`reparacion.py:100-107`) |
| `v_macro` + `tiene_macro` | coseno de composición macro, término dominante de la etapa A |
| `escala_min` / `escala_max` | cotas de σ en el LP |
| `m_dieta` | filtro base del pool (`scoring.py:92`) y diagnóstico (`diagnostico.py:132`) |
| `m_alergeno` | filtro base (`scoring.py:95`) y diagnóstico (`diagnostico.py:135`) |
| `m_slot` | admisibilidad por slot |
| `minutos` | filtro por tope de tiempo (`scoring.py:96`, `diagnostico.py:143`) |
| `ingr_bits` | `ingredientesExcluidos`, solape con despensa (W_DESP), solape con la semana ya cerrada (W_SOL), y conteo de ingredientes únicos del recocido |
| `n_ingredientes` | término de "lista corta" del scoring |
| `coste_cents` / `coste_conocido` | término W_COST y presupuesto; el término se **apaga** si menos del 80 % de las filas del pool tienen precio (`scoring.py:261`, `FRACCION_MINIMA_PRECIOS`) |
| `n` | puerta 2 del diagnóstico (`motor.py:254`) y tamaño del mapa de filas |

**Compilado pero NO usado por el motor (peso muerto hoy):**
- `titulos` — 0 referencias en `app/solver/`. Es puramente UI.
- `ingr_perec_bits` — 0 referencias en `app/`, sólo en `tests/test_catalogo.py:208`. Está preparado para batch cooking / lista de la compra, no lo usa nadie.
- `alimento_id` y `n_alimentos` — 0 referencias; `semanal.py:239` se dimensiona con `pool.bits.shape[1]*64` en vez de con `cat.n_alimentos`.
- `alimento_idx` — sí se usa, pero sólo en `scoring.bits_de` (`scoring.py:126`) para traducir despensa e ingredientes excluidos.
- `racionesBase` y `revisadaPor` están en el jsonl y **ni se cargan** en `Catalogo`.

**Usados sólo por la UI** (vía `apps/web/src/lib/catalogo.ts`, que relee el jsonl por su cuenta y construye `RecetaResumen`): `titulo`, `minutos`, `slots`, `alergenos`, `ingredientes` (traducidos a nombres legibles con `ingredientes.json`), `nutr` + `conocido` completos (los 6, incluido `sodio`, que la ficha convierte a sal con `sodioMg*2.5/1000`, `panel-receta.tsx:179`), `costeCents`/`costeConocido`, `revisadaPor`, y el total de recetas del catálogo (contexto de la pantalla de sobre-restricción). La UI **no** usa `dietas`, `escalaMin/Max`, `v_macro`, los bitsets ni `ingredientesPerecederos`.

**Consecuencia para el port:** el catálogo del navegador necesita dos vistas del mismo fichero — la compilada (typed arrays, motor) y la de presentación (id → {titulo, minutos, slots, alergenos, nombres de ingredientes, panel, coste, revisadaPor}). Hoy son dos lecturas independientes del mismo jsonl en dos lenguajes; al portar conviene unificarlas en un único módulo para que no se desincronicen. `ingredientes.json` sigue haciendo falta **sólo** para el mapa id→nombre (2 KB, 951 B gzip); todo lo demás de ese fichero (paneles, formatos de compra) es entrada del build, no del runtime.

Referencias: `services/solver/app/solver/scoring.py:88-101`, `services/solver/app/solver/scoring.py:121-179`, `services/solver/app/solver/scoring.py:245`, `services/solver/app/solver/scoring.py:261`, `services/solver/app/solver/reparacion.py:100-107`, `services/solver/app/solver/semanal.py:239`, `services/solver/app/solver/diagnostico.py:132-146`, `apps/web/src/lib/catalogo.ts:98-130`, `apps/web/src/lib/tipos.ts:14-43`

## 4. Tamaño de los datos y estrategia de empaquetado

Medidas reales (`wc -c` y `gzip -9`), no estimaciones:

| Fichero | Crudo | Minificado | gzip -9 (del minificado) |
|---|---|---|---|
| `catalogo.jsonl` (36 recetas) | 21.463 B | — (ya es compacto) | **3.405 B** |
| `ingredientes.json` (73) | 28.077 B | 24.818 B | **3.711 B** |
| `recetas.json` (36) | 36.027 B | 30.102 B | **5.631 B** |
| **Los tres** | 85.567 B | ~76 KB | **~12,7 KB** |

Subconjuntos derivados:

| Payload | Minificado | gzip |
|---|---|---|
| Catálogo sólo con los 13 campos que lee el motor (sin `titulo`, `racionesBase`, `revisadaPor`) | 16.643 B | **2.732 B** |
| Catálogo completo como array JSON | 19.609 B | 3.349 B |
| Sólo mapa id→nombre de alimento (lo único que la UI necesita de ingredientes.json) | 2.065 B | **951 B** |
| Paneles+alérgenos+formatos de los alimentos (entrada del build, no runtime) | 19.356 B | 3.108 B |
| Detalle de recetas para lista de la compra (pasos + gramos por ingrediente) | 25.683 B | 4.670 B |
| Sólo los pasos | 7.900 B | 2.648 B |

**Recomendación: JSON embebido en el bundle, no fetch.** Razones concretas:

1. El payload de runtime que realmente hace falta es *catálogo compilado (≈3,3 KB gz) + nombres de alimentos (≈1 KB gz) ≈ 4,3 KB gzip*. Un fetch adicional cuesta un RTT completo contra `xblackflashx.github.io` — a 100 ms de latencia, más que descargar 4 KB. Y GitHub Pages ya sirve gzip/brotli automáticamente sobre el JS, así que el ahorro de un fichero aparte es nulo.
2. El motor no puede empezar sin el catálogo: no hay nada que renderizar mientras se espera. Un fetch sólo añade un estado de carga y un modo de fallo (404, offline) que hoy no existe.
3. GitHub Pages sirve bajo el subpath `/PlanEat`; un `fetch("/data/catalogo.json")` absoluto se rompería y habría que arrastrar `basePath` hasta la capa de datos. Embebido, ese problema desaparece.
4. Con export estático, un import de JSON es una constante que Next inlinea y que el CDN cachea con el hash del bundle — la versión del catálogo y la del código quedan atadas automáticamente, que es justo lo que el `version` sha256 intenta garantizar.

**Excepción razonable:** `recetas.json` (pasos + gramos por ingrediente, 4,7 KB gz) sólo hace falta cuando el usuario abre la ficha de una receta o pide la lista de la compra. Eso sí es un buen candidato a `import()` dinámico (que en export estático se resuelve como un chunk aparte, sin fetch manual ni problemas de basePath).

**Escalado al catálogo de producto** (README: ≈130 ingredientes, 60-80 recetas): multiplicando por ~2,2 el número de recetas, el catálogo compilado va a ~7,5 KB gzip y el mapa de nombres a ~1,7 KB. Las matrices en memoria pasan de 4,2 KB a ~10 KB (W32 sube de 3 a 5 palabras). Sigue siendo irrelevante frente a cualquier bundle de React. Lo que **no** escala igual es `recetas.json` con fotos: las `imagenUrl` de `Receta` (types.ts:140) tendrán que ser assets estáticos aparte, nunca data URIs en el bundle.

Referencias: `services/solver/data/catalogo.jsonl`, `services/solver/data/ingredientes.json`, `services/solver/data/recetas.json`, `services/solver/data/README.md:66-78`

## 5. Discrepancias entre schemas.py y types.ts

El docstring de `schemas.py:3-5` dice que los modelos son *espejo* de `types.ts` y que no hay generación automática. No lo son del todo. Ordenadas por gravedad.

**A. `PanelNutricional` tiene dos significados incompatibles con el mismo nombre.**
- `types.ts:65-74` lo documenta como *"Panel nutricional por 100 g de producto comestible"* y le da 8 campos: `kcal, proteinaG, carbohidratoG, grasaG, grasaSaturadaG?, azucaresG?, fibraG?, salG?`.
- `schemas.py:75-81` lo define con 5: `kcal, proteinaG, carbohidratoG, grasaG, fibraG|None`, y es el **total de una comida o de un día** (`motor._panel`), no un panel por 100 g.
- Y `types.ts` reutiliza ese mismo tipo en `ComidaPlan.totales` y `DiaPlan.totales`. Resultado: el tipo TS admite `salG`/`azucaresG` en un total que el solver nunca emite, y `bloque-nutricional.tsx:159` ya lee `totales.salG ?? null` — un campo que **siempre** será undefined viniendo del solver. Al portar hay que partirlo en dos tipos (`PanelPor100g` y `TotalesNutricionales`).
- Además el motor sí calcula **sodio** internamente (columna 5 de `nutr`, y `sodioMaxMg` es restricción del objetivo) pero **no lo emite en el panel de salida**. La UI se lo saca del catálogo por su cuenta y lo convierte a sal (`panel-receta.tsx:180`). Eso es una pérdida de información del contrato, no un desajuste de tipos.

**B. Opcionalidad divergente (7 campos).** Pydantic tiene defaults donde TS exige el campo; un cliente TS válido es más estricto que el servidor, y un cuerpo aceptado por el servidor puede no encajar en el tipo TS:

| Campo | schemas.py | types.ts |
|---|---|---|
| `ObjetivoNutricional.toleranciaKcal` | default `0.03` | requerido |
| `ObjetivoNutricional.fibraMinG` | default `0` | requerido |
| `RestriccionesGeneracion.dieta` | default `"omnivora"` | requerido |
| `alergenosExcluidos` | default `[]` | requerido |
| `ingredientesExcluidos` | default `[]` | requerido |
| `comensales` | default `1` | requerido |
| `ItemPlan.bloqueado` | default `False` | requerido |
| `despensaAlimentoIds` | default `[]` (siempre presente en la salida) | **opcional** `?` |
| `recetasRecientes` | default `[]` (siempre presente) | **opcional** `?` |

Los dos últimos van al revés: pydantic los serializa siempre, TS los declara opcionales.

**C. `minutosMaxPorSlot`.** `dict[SlotComida,int] | None` en pydantic vs `Partial<Record<SlotComida, number>>` (opcional, sin `null`) en TS. Un `null` explícito del servidor no encaja en el tipo TS; hay que aceptar `| null` o normalizar.

**D. Tipos TS sin contraparte en Python:** `PerfilFisico`, `NivelActividad`, `Objetivo`, `Sexo` (Python define `Sexo` pero **no lo usa en ningún schema** — es código muerto en `schemas.py:14`), `Alimento`, `FormatoCompra`, `FuenteNutricional`, `Ingrediente`, `Receta`, `Plan`. Ninguno viaja por el contrato HTTP.

**E. `Alimento` (types.ts:76-87) no describe `ingredientes.json`.** Divergencias campo a campo:
- `fuente: FuenteNutricional` = `"usda"|"ciqual"|"openfoodfacts"|"propia"`, pero el fichero trae `"USDA FDC"` y `"BEDCA"`. **BEDCA no está en la unión** y ninguno de los dos valores literales encaja.
- `fuenteRef: string` es **requerido** y no existe en el fichero.
- `panel` usa `salG?` mientras el fichero usa `sodioMg` (y es lo que el motor consume).
- `categoriaSupermercado?` vs `categoria` del fichero.
- El fichero tiene `estado` (`crudo|cocido|conserva|liquido|listo`) y `perecedero` (bool), que **no existen en el tipo TS** y sí son semánticamente importantes: el README avisa de que los gramos de las recetas deben ser coherentes con `estado`, y `perecedero` alimenta `ingredientesPerecederos`.

**F. `Receta` (types.ts:129-149) no describe `recetas.json`.**
- `dietas` y `alergenos` son requeridos en el tipo, pero `recetas.json` **no los declara a propósito** (los deriva el build; declararlos a mano es "una fuente de error silencioso", `recetas.json._meta.derivado`).
- `Ingrediente.escalable: boolean` es requerido y documentado ("si es falso, el escalado de raciones no altera esta cantidad, ej. sal"), pero **no aparece en ningún ingrediente de recetas.json y no está implementado en ninguna parte del motor**: `factorRacion` multiplica la fila nutricional entera de forma uniforme. Es una promesa del tipo que el sistema no cumple.
- `recetas.json` tiene `mediterranea: bool`, que no existe en el tipo TS.
- `revisadaPor?`, `revisadaEn?`, `imagenUrl?`, `batchGroupId?` no aparecen en los datos (el jsonl generado sí emite `revisadaPor: null`).

**G. No hay ningún tipo TS para la fila de `catalogo.jsonl`.** `apps/web/src/lib/catalogo.ts:35-48` declara su propio `FilaCatalogo` local, con `dietas`, `escalaMin/Max` e `ingredientesPerecederos` **ausentes**. Es una tercera definición del mismo esquema (junto a `catalogo.py` y `construir_catalogo.py`) que nadie mantiene sincronizada. Al portar, ese esquema debe vivir una sola vez en `packages/shared`.

Referencias: `services/solver/app/schemas.py:14`, `services/solver/app/schemas.py:47-97`, `packages/shared/src/types.ts:62-149`, `packages/shared/src/types.ts:195-230`, `apps/web/src/lib/catalogo.ts:35-48`, `apps/web/src/components/bloque-nutricional.tsx:159`, `apps/web/src/components/panel-receta.tsx:179-180`

## 6. Notas adicionales que afectan al port (no pedidas pero necesarias)

**No hay ninguna dependencia de HiGHS ni de numpy en `catalogo.py`.** El único uso de numpy es contenedor de datos (`np.zeros`, `np.full`, indexación) más `np.linalg.norm` y `np.stack` en el bloque de `v_macro`, todo trivialmente reemplazable por bucles. Este módulo es el más barato de portar de los ~2400 líneas.

**`nutricion.ts` ya está en TypeScript y no necesita port.** `calcularObjetivo` (Mifflin-St Jeor + factores de actividad + macros con holgura ±8 %/±12 %) produce directamente un `ObjetivoNutricional` del contrato. Su suelo de seguridad `KCAL_MINIMAS` (hombre 1500, mujer 1200) está **duplicado a mano** en `app/solver/__init__.py:155` con el comentario "espejo de packages/shared/src/nutricion.ts". Al unificar en TS ese espejo desaparece y hay una fuente única: es una de las pocas cosas que el port mejora en vez de empeorar.

**El motor es una función pura sobre (catálogo, petición).** `motor.py:2-5`: no toca disco, no consulta BD, no lee el reloj para decidir nada (la fecha entra sólo en `DiaPlan.fecha` vía el parámetro `hoy`). Eso es exactamente lo que hace viable ejecutarlo en el navegador, incluido en un Web Worker.

**La caché de pool (`scoring._cache_pool`) usa `threading.Lock` y `time.monotonic`.** En el navegador el lock sobra (un solo hilo por worker) y `performance.now()` sustituye a `time.monotonic()`. La política de evicción es "limpia todo al llegar a 256 entradas"; portable tal cual.

**`secrets.randbits(63)`** genera el seed cuando la petición no lo trae (`motor.py`). En el navegador: `crypto.getRandomValues` sobre un `BigUint64Array` y máscara a 63 bits, o directamente pedir siempre seed explícito desde la UI (mejor: hace el plan compartible por URL).

**El `X-PlanEat-Pool` y la `Traza` completa se pierden.** La traza hoy va al log del servidor (`log.info("generacion %s", asdict(traza))`, `main.py:101`) con 13 campos de instrumentación (ms por etapa, intentos de reparación, porcionados de emergencia, términos desactivados). En el navegador no hay log de servidor: o se descarta, o se expone en un modo diagnóstico de la UI. Para validar "el funcionamiento real", que es el objetivo declarado, exponerla en pantalla vale más que perderla.

Referencias: `services/solver/app/solver/motor.py:1-20`, `services/solver/app/solver/__init__.py:153-156`, `packages/shared/src/nutricion.ts:66-69`, `services/solver/app/solver/scoring.py:76-119`, `services/solver/app/main.py:101`

## Riesgos

- **[alta]** Divergencia de determinismo por precisión: nutr y v_macro son float32 en numpy y todo el scoring opera en float32; JS calcula en float64 por defecto. En un empate del softmax de la etapa A, el port puede elegir otra receta que Python, y los tests de determinismo cruzados fallarán sin que haya bug lógico.
  - Mitigación: Precalcular v_macro en el script de build (Python) y embeberlo ya cuantizado a float32; almacenar nutr en Float32Array; y en las operaciones intermedias del scoring aplicar Math.fround() en los mismos puntos donde numpy materializa un float32. Alternativa pragmática: aceptar la divergencia y cambiar el criterio de aceptación de los tests de 'plan idéntico' a 'error nutricional dentro de banda'.
- **[alta]** El vocabulario de alimentos se construye con sorted() sobre los ids presentes en el jsonl. Si el port lo reconstruye en el navegador y el catálogo de producto introduce ids con acentos o mayúsculas, sorted() de Python (code point) y sort() de JS (unidad UTF-16) pueden divergir, y todos los bitsets quedan desalineados en silencio: filtros de despensa e ingredientes excluidos empiezan a dar resultados equivocados sin error visible.
  - Mitigación: No reconstruir el vocabulario en el navegador: emitir alimento_id ya ordenado desde el build de Python y que el TS sólo lo consuma. Añadir además un test que verifique que los ids del catálogo son ASCII puros (hoy los 66 lo son) y que falle si entra uno que no lo sea.
- **[alta]** Los tres datos necesarios para reproducir un plan (seed, versión de catálogo, versión de generador) viajan hoy sólo en cabeceras HTTP X-PlanEat-*. Al eliminar el HTTP se pierden si nadie los mueve al payload, y un plan generado en Pages deja de ser reproducible, que es exactamente el fallo 'indepurable en soporte' contra el que avisa main.py:76-80.
  - Mitigación: Extender RespuestaOk (y schemas.py, para mantener la paridad) con seed, versionCatalogo, versionGenerador y opcionalmente pool. Codificar el seed en la URL del plan para que sea compartible y regenerable.
- **[media]** Existen tres definiciones independientes del esquema de catalogo.jsonl (catalogo.py, construir_catalogo.py y el FilaCatalogo local de apps/web/src/lib/catalogo.ts, este último ya incompleto: le faltan dietas, escalaMin/Max e ingredientesPerecederos). Al portar el motor a TS habrá una cuarta si no se unifica.
  - Mitigación: Definir el tipo de la fila del catálogo una sola vez en packages/shared y hacer que tanto el compilador del motor como la vista de UI lo importen. El script de build en Python valida contra ese mismo esquema (o pasa a emitirlo desde TS).
- **[media]** np.bitwise_count no tiene equivalente en JS y BigUint64Array es lento. Traducir los bitsets literalmente a BigInt degrada el scoring, que es la operación caliente, justo en el entorno más lento (navegador).
  - Mitigación: Usar Uint32Array con W32 = ceil(nAlimentos/32) palabras y popcount SWAR de 32 bits. Ajustar semanal.py:239, que dimensiona el contador con pool.bits.shape[1]*64, a *32.
- **[media]** catalogo.py no carga racionesBase ni revisadaPor, y la UI los necesita (revisadaPor para la trazabilidad de revisión por dietista; racionesBase para cualquier lista de la compra futura). Al fusionar las dos vistas del catálogo en un único módulo TS es fácil quedarse con la del motor y perder ambos campos.
  - Mitigación: Emitir desde el build dos vistas explícitas del mismo fichero (compilada para el motor, de presentación para la UI) y cubrir con un test que la vista de presentación conserva titulo, racionesBase, revisadaPor, slots, alergenos y los 6 nutrientes con sus flags de conocido.
- **[media]** types.ts describe Alimento y Receta de forma que no encaja con ingredientes.json ni recetas.json (fuente 'BEDCA' fuera de la unión FuenteNutricional, fuenteRef requerido e inexistente, salG vs sodioMg, escalable requerido y no implementado, dietas/alergenos requeridos pero deliberadamente derivados). Si el port empieza a tipar los ficheros de datos con esos tipos, o falla la compilación o se fuerzan casts que ocultan el desajuste.
  - Mitigación: Separar los tipos de fichero fuente (AlimentoFuente, RecetaFuente, fieles a los JSON reales) de los tipos de dominio de producto, y ampliar FuenteNutricional para incluir bedca. Decidir explícitamente si Ingrediente.escalable se implementa o se borra del tipo: hoy es una promesa que el motor no cumple.
- **[baja]** Hay dos cuerpos distintos de 422 (el de ObjetivoInvalido con forma RespuestaError y el de pydantic con forma {detail:[...]}). El cliente web sólo maneja bien el primero. Al portar, si la validación de entrada se replica en TS es fácil perder la distinción entre 'objetivo mal formado' (error nuestro, pantalla de avería) y 'sobre-restricción' (resultado del producto, pantalla propia), que la UI ya trata como cosas distintas.
  - Mitigación: Modelar el resultado del motor en TS como una unión de tres casos (ok / fallo diagnosticado / objetivo invalido) en vez de dos, y mapear los tres a los tres estados que ya existen en ResultadoPlan (ok, sobre_restriccion, sin_servicio).
- **[baja]** PanelNutricional se usa en types.ts con dos semánticas incompatibles (por 100 g y totales del día). bloque-nutricional.tsx ya lee totales.salG, un campo que el solver nunca emite y que por tanto siempre es undefined: hoy se ve como 'sin dato' y nadie lo nota.
  - Mitigación: Partir el tipo en PanelPor100g y TotalesNutricionales, y decidir si el sodio (que el motor sí calcula en la columna 5 de nutr) pasa a formar parte del panel de salida en vez de que la UI lo saque del catálogo por su cuenta.

---

# app-web

La app web es Next.js 16.3.1 + React 19.2.8 + Tailwind 4, con App Router y tres rutas (`/`, `/plan`, `/sistema`) más un route handler `POST /api/plan`. Hoy NADA de esto exporta estáticamente: hay un route handler con POST, una página con `searchParams` y `dynamic = "force-dynamic"`, y dos módulos marcados «sólo servidor» que usan `node:fs/promises`, `path`, `process.cwd()` y `process.env` para leer `services/solver/data/` y para hablar con FastAPI en `http://localhost:8000`. El `next.config.ts` no declara ni `output`, ni `basePath`, ni `trailingSlash`.
La buena noticia: casi toda la capa de presentación ya es cliente (10 de 17 componentes llevan `"use client"`), la lógica de dominio (`perfil.ts`, `nutricion-ui.ts`, `formato.ts`, `acciones-fallo.ts`) es pura y browser-safe, y el catálogo entero pesa ~50 KB (36 recetas) — se puede empaquetar en el bundle sin fetch. Sólo `plan/page.tsx` tiene que convertirse de verdad en cliente; el resto del árbol ya lo es por importación.
Bajo `basePath: '/PlanEat'` los `<Link>` se reescriben solos, pero hay tres rutas absolutas escritas a mano que se romperán: `fetch("/api/plan")` en dos ficheros y `action="/plan"` en el formulario. Y GitHub Pages exige `.nojekyll` porque Next emite todo bajo `_next/`.
El sistema de diseño de `globals.css` es sólido: 30 tokens de color más forma y movimiento, y **sí** implementa exactamente el patrón de tres estados descrito en `decisiones-de-diseno.md`. El defecto real está en la cascada: las reglas sin capa de `globals.css` ganan a todas las utilidades de Tailwind, y `:focus-visible { border-radius: var(--radius-sm) }` deforma las esquinas de cualquier elemento al enfocarlo con teclado, además de dibujar un contorno de marca alrededor de toda la zona de resultado pese al `outline-none`.
De los tres pendientes de diseño, la tipografía ya está decidida en `diseno-producto.md` §2.2 y sólo falta implementarla (Instrument Serif como voz); del estado de generación faltan los compases 1 y 3 de la coreografía; y la ficha de receta es la única pantalla que no sigue su propia especificación (§3.5): sin foto, sin serif, sin selector de raciones, sin dobles unidades y con un fallo de interacción en escritorio.

## 1. Inventario de bloqueos duros para `output: 'export'`

Cada punto es un error de build o un fallo en runtime con `output: 'export'`. Ordenados de más a menos grave.

### 1.1 Route handler con POST — `src/app/api/plan/route.ts`

Es el bloqueo número uno. La documentación de Next 16 (`node_modules/next/dist/docs/01-app/02-guides/static-exports.md`, sección *Unsupported Features*) es explícita: en export sólo se admite el verbo `GET`, y sólo si no lee nada de la `Request`. Este handler:

- `export async function POST(peticion: Request)` (línea 68) — verbo no admitido.
- `await peticion.json()` (línea 71) — lee el cuerpo de la petición entrante.
- `export const dynamic = "force-dynamic"` (línea 32) — incompatible por sí solo.
- Usa `NextResponse` de `next/server` (línea 18), que no existe en export.

**El fichero se borra entero.** Pero antes hay que replicar sus tres responsabilidades, documentadas en su propia cabecera (líneas 1–16), porque todas desaparecen al no haber servidor:

1. *No publicar la URL del solver* — deja de aplicar: no hay solver remoto.
2. *Adjuntar el catálogo de recetas* (línea 91–93 vía `generarPlan`) — pasa a hacerse en el navegador con el catálogo empaquetado.
3. *Calcular el objetivo en servidor para que nadie pida un objetivo arbitrario* — deja de aplicar: no hay nada que proteger en un binario que corre en el cliente. El saneado de `comoAjustes()` (líneas 49–66, con sus límites 800–6000 kcal y 20–400 g de proteína) **sí hay que conservarlo** y moverlo al motor TS: son los límites de seguridad del producto, no una defensa contra ataques.

### 1.2 Página con `searchParams` — `src/app/plan/page.tsx`

- Línea 35: `export const dynamic = "force-dynamic"` con el comentario «La query cambia en cada visita: esta página nunca se prerrenderiza». Es exactamente lo que el export prohíbe.
- Líneas 37–42: la página es `async` y recibe `searchParams: Promise<Record<string, string | string[] | undefined>>`. En export no hay petición de la que leer la query.
- Línea 42: `const crudos = await searchParams`.
- Línea 49: `await generarPlan(...)` — trabajo pesado en servidor, según su cabecera (líneas 24–27: «El trabajo pesado ocurre aquí, en el servidor... El cliente sólo recibe datos»).

**Reescritura obligatoria** (patrón exacto, porque `metadata` y `"use client"` no pueden convivir en el mismo fichero):

- `src/app/plan/page.tsx` se queda como Server Component: mantiene `export const metadata` (líneas 29–32), quita `dynamic`, quita `searchParams`, y renderiza `<Suspense fallback={...}><PlanCliente /></Suspense>`.
- `src/app/plan/plan-cliente.tsx` nuevo, con `"use client"`: usa `useSearchParams()` para leer el perfil de la query y llama al motor TS en un efecto. **El `<Suspense>` no es opcional**: `useSearchParams()` sin frontera de Suspense hace fallar el build en export.
- La cabecera y el pie de la página (líneas 52–108) pueden quedarse en el shell servidor; sólo el bloque que depende de la query baja al cliente.

### 1.3 Lectura del sistema de ficheros — `src/lib/catalogo.ts`

Módulo marcado «**Sólo servidor**» en su línea 2. Todo lo que lo hace imposible en navegador:

- Línea 18: `import { readFile } from "node:fs/promises"`.
- Línea 19: `import path from "node:path"`.
- Línea 61: `process.env.PLANEAT_DATOS_SOLVER`.
- Líneas 64–65: `path.resolve(process.cwd(), "../../services/solver/data", fichero)`.
- Línea 70–79: `leerPrimeroQueExista()` prueba rutas candidatas del disco.
- Ficheros que lee: `catalogo.jsonl` (línea 135) e `ingredientes.json` (línea 83).

**Datos reales medidos:** `services/solver/data/catalogo.jsonl` son 21 463 bytes / **36 líneas (36 recetas)**, e `ingredientes.json` 28 077 bytes. Total ~49 KB en crudo, bastante menos gzipeado. **Recomendación concreta: no servir el catálogo por HTTP, empaquetarlo.** Un script de build (`npm run catalogo:build`) que transforme el JSONL + el JSON de ingredientes en un único `src/datos/catalogo.generado.ts` con el `Record<string, RecetaResumen>` ya resuelto (aplicando `aResumen()` de las líneas 98–130, que ya mapea las seis columnas de `nutr`/`conocido` y resuelve los nombres de ingrediente). Ventajas: cero fetch, cero rutas absolutas que romper con `basePath`, cero estado `catalogoDisponible: false`. La interfaz de `RecetaResumen` (`src/lib/tipos.ts:14-43`) no cambia, así que ningún componente se entera.

OJO al efecto colateral: `catalogoDisponible` (usado en `vista-plan.tsx:190-196` y `plan-dia.tsx:296-300`) pasa a ser siempre `true`. Se puede conservar el tipo pero la rama muerta sobra.

### 1.4 Cliente HTTP del solver — `src/lib/solver.ts`

Módulo marcado «**Sólo servidor**» en su línea 2. Desaparece entero, sustituido por el motor TS portado.

- Línea 19: `const URL_POR_DEFECTO = "http://localhost:8000"`.
- Línea 29: `process.env.SOLVER_URL`.
- Línea 73: `fetch("${urlDelSolver()}/v1/plan/generate")`.
- Línea 78: `AbortSignal.timeout(MS_LIMITE_GENERACION)` con `MS_LIMITE_GENERACION = 20_000` (línea 26).

**Lo que hay que conservar del fichero aunque el transporte desaparezca:** la máquina de estados de `ResultadoPlan` (líneas 100–160) y su distinción entre los tres desenlaces. En el navegador se remapea así:

- `estado: "ok"` → el motor TS ha cuadrado el día.
- `estado: "sobre_restriccion"` → el motor devuelve `ok: false` con `FalloGeneracion`. Sigue teniendo pantalla propia; **no es un error**.
- `estado: "sin_servicio"` → cambia de significado. Ya no hay «no hay nadie escuchando»; los motivos que sobreviven son `error_solver` (excepción no controlada del motor TS) y `tiempo_agotado` (el motor supera `MS_LIMITE_GENERACION`, ahora medido con un presupuesto de tiempo dentro del propio bucle o con un Web Worker abortable). Los motivos `sin_conexion`, `motor_no_implementado` y `respuesta_ilegible` (`src/lib/tipos.ts:46-51`) quedan sin uso — pero **no los borres del tipo sin actualizar `sin-servicio.tsx:21-45`**, que tiene un `Record<MotivoSinServicio, ...>` exhaustivo y el compilador se quejará.
- `MS_LIMITE_GENERACION` se exporta a propósito (comentario líneas 21–25: «el mismo corte que la interfaz declara al usuario»). El nuevo motor debe seguir exportando ese contrato; `estado-generacion.tsx` usa el umbral de 6 s (`MS_ESPERA_LARGA`, línea 42) y el de 20 s vive aquí.

### 1.5 Rutas absolutas escritas a mano (rompen en export Y bajo basePath)

- `src/components/generador.tsx:106` — `fetch("/api/plan", {...})`. El endpoint no existirá.
- `src/components/vista-plan.tsx:84` — `fetch("/api/plan", {...})`. Ídem. Este es el que lleva `recetasRecientes` y `ajustes` acumulados (líneas 87–91), la política de reintento entera.
- `src/components/generador.tsx:157` — `<form method="get" action="/plan">`. Bajo `basePath` apunta a `https://xblackflashx.github.io/plan`, fuera del sitio.

### 1.6 Configuración ausente — `src/../next.config.ts`

El fichero completo son 11 líneas: sólo `transpilePackages: ["@planeat/shared"]` (línea 6) y `typedRoutes: true` (línea 8). Faltan `output`, `basePath`, `trailingSlash` y `images`. `typedRoutes: true` es compatible con export y con basePath, se puede dejar.

### 1.7 Lo que NO bloquea (verificado, para que nadie lo toque de más)

- `next/font/google` en `layout.tsx:2` — compatible con export: Next descarga y auto-aloja las fuentes **en tiempo de build**. Sólo exige red en el runner de CI.
- El script inline de tema en `layout.tsx:54` (`dangerouslySetInnerHTML`) — se serializa en el HTML estático, funciona igual.
- `viewport.themeColor` (`layout.tsx:24-29`) — metadata estática, se emite como `<meta>`.
- `src/app/favicon.ico` — ruta de metadatos del App Router; se copia a `out/favicon.ico` y Next le antepone el `basePath` en el `<link>`. **Verificar en el HTML generado**, es el punto donde más veces falla el basePath.
- No hay ni un solo `next/image`, ni `cookies()`, ni `headers()`, ni Server Actions, ni rutas dinámicas `[param]`, ni `rewrites`/`redirects`/`headers` en la config. Grep confirmado sobre todo `src/`.
- `@planeat/shared` es TypeScript puro sin imports de `node:` (`packages/shared/src/{index,nutricion,types}.ts`), se transpila y va al bundle sin problema.

Referencias: `apps/web/next.config.ts:1-11`, `apps/web/src/app/api/plan/route.ts:18`, `apps/web/src/app/api/plan/route.ts:32`, `apps/web/src/app/api/plan/route.ts:49-66`, `apps/web/src/app/api/plan/route.ts:68-105`, `apps/web/src/app/plan/page.tsx:29-32`, `apps/web/src/app/plan/page.tsx:35`, `apps/web/src/app/plan/page.tsx:37-49`, `apps/web/src/lib/catalogo.ts:18-19`, `apps/web/src/lib/catalogo.ts:60-79`, `apps/web/src/lib/catalogo.ts:98-155`, `apps/web/src/lib/solver.ts:19`, `apps/web/src/lib/solver.ts:26-30`, `apps/web/src/lib/solver.ts:67-160`, `apps/web/src/lib/tipos.ts:46-81`, `apps/web/src/components/generador.tsx:106`, `apps/web/src/components/generador.tsx:157`, `apps/web/src/components/vista-plan.tsx:84-92`, `apps/web/src/components/sin-servicio.tsx:21-45`, `apps/web/src/app/layout.tsx:2-13`, `apps/web/src/app/layout.tsx:54`

## 2. Qué cambiar para servir bajo basePath '/PlanEat' (y en GitHub Pages)

### 2.1 Configuración mínima

```ts
// apps/web/next.config.ts
const nextConfig: NextConfig = {
  transpilePackages: ["@planeat/shared"],
  typedRoutes: true,
  output: "export",
  basePath: "/PlanEat",
  trailingSlash: true,   // recomendado, ver 2.4
  images: { unoptimized: true },  // sólo si algún día se usa next/image
};
```

`assetPrefix` **no hace falta**: con `basePath` los assets de `_next/` ya salen bajo `/PlanEat/_next/`. Sólo se añadiría si los estáticos vivieran en un CDN distinto del HTML.

OJO al aviso de la doc de `basePath`: *«This value must be set at build time and cannot be changed without re-building as the value is inlined in the client-side bundles»*. Es decir: no se puede tener un build que sirva para `localhost:3000` y para Pages a la vez. Si molesta, condicionar por variable de entorno (`process.env.GITHUB_ACTIONS ? '/PlanEat' : ''`), pero eso implica que `next dev` y producción divergen — mi recomendación es fijarlo y aceptar que en local también se sirve bajo `/PlanEat`.

### 2.2 Lo que se reescribe solo (no tocar)

`next/link` antepone el `basePath` automáticamente. Están cubiertos:

- `src/app/page.tsx:44` — `<Link href="/sistema">`
- `src/app/plan/page.tsx:56` y `:79` — `<Link href="/">`
- `src/app/sistema/page.tsx:71` — `<Link href="/">`

Con `typedRoutes: true` estos `href` siguen tipándose sin el prefijo; el prefijo es cosa del runtime.

### 2.3 Lo que hay que tocar a mano

1. **`src/components/generador.tsx:157`** — `<form method="get" action="/plan">`. Bajo basePath apunta fuera del sitio. Dos salidas: (a) cambiar a `action="/PlanEat/plan/"` literal, o (b) —mejor— asumir que **el camino sin JavaScript ya no existe** y quitar `method`/`action`, dejando sólo `onSubmit`. Ver el riesgo asociado más abajo: la cabecera del componente (líneas 14–19) declara que funcionar sin JS es un requisito de producto, y el port lo mata.
2. **`src/components/generador.tsx:106` y `src/components/vista-plan.tsx:84`** — los dos `fetch("/api/plan")` desaparecen (llamada directa al motor TS). Si por lo que sea sobreviviera algún fetch a un asset propio, **debe construirse con el basePath**; lo limpio es exponer una constante `RUTA_BASE` en un módulo y no repetir el literal.
3. **CSS** — verificado: **no hay ni una sola URL absoluta en CSS**. Ni en `src/app/globals.css` (218 líneas, sólo tokens y reglas) ni en `src/components/planeat.module.css` (265 líneas). Cero `url(...)`, cero `@font-face` a mano, cero imágenes de fondo. Los degradados de `.filaEsqueleto` (líneas 37–47) usan tokens. **Aquí no hay nada que hacer.**
4. **Iconos** — todos son SVG inline en `src/components/iconos.tsx`, sin ficheros externos. Nada que prefijar.
5. **Favicon** — `src/app/favicon.ico`. Next lo prefija solo, pero es el punto clásico de fallo: comprobar en `out/index.html` que el `<link rel="icon">` dice `/PlanEat/favicon.ico`.
6. **`metadataBase`** — no está declarado en `layout.tsx:15-22`. Sin él, las URLs de Open Graph salen relativas. Añadir `metadataBase: new URL("https://xblackflashx.github.io/PlanEat")` si se quiere que compartir el enlace enseñe algo decente.

### 2.4 Específico de GitHub Pages (no de Next)

1. **`.nojekyll` es obligatorio.** GitHub Pages pasa el sitio por Jekyll, que **ignora todo directorio que empiece por guion bajo**. Next emite absolutamente todo el JS y el CSS bajo `_next/`. Sin un fichero vacío `out/.nojekyll` el sitio se sirve sin estilos y sin JavaScript. Es el fallo número uno de este despliegue.
2. **`trailingSlash: true`.** Con él, `/plan` se emite como `out/plan/index.html` en lugar de `out/plan.html`. Es la forma que GitHub Pages resuelve sin ambigüedad. Efecto secundario documentado: los enlaces pasan de `/me` a `/me/`.
3. **404.** `next build` con export genera `out/404.html`, que es justo el nombre que GitHub Pages usa. Sale gratis.
4. **No hay workflow de CI.** Verificado: el repositorio **no tiene directorio `.github/`**. Hay que crearlo entero: checkout, Node ≥ 20 (declarado en `package.json` raíz, `engines`), `npm ci`, generación del catálogo empaquetado, `npm run build --workspace @planeat/web`, `touch apps/web/out/.nojekyll`, `actions/upload-pages-artifact` sobre `apps/web/out`, `actions/deploy-pages`.
5. **El build necesita red** por `next/font/google` (descarga de Geist y Geist Mono en tiempo de build). En GitHub Actions no es problema, pero si alguna vez se compila en un runner aislado, hay que auto-alojar las fuentes con `next/font/local`. Es además la solución natural cuando se añada Instrument Serif (ver hallazgo 4).

Referencias: `apps/web/next.config.ts:1-11`, `apps/web/src/app/page.tsx:44`, `apps/web/src/app/plan/page.tsx:56`, `apps/web/src/app/plan/page.tsx:79`, `apps/web/src/app/sistema/page.tsx:71`, `apps/web/src/components/generador.tsx:106`, `apps/web/src/components/generador.tsx:157`, `apps/web/src/components/vista-plan.tsx:84`, `apps/web/src/app/layout.tsx:15-22`, `apps/web/src/app/globals.css:1-218`, `apps/web/src/components/planeat.module.css:1-265`, `package.json:1-30`

## 3. El sistema de diseño de globals.css: tokens, estrategia de tema y patrón de tres estados

### 3.1 Inventario completo de tokens

**Superficies (4)** — sesgo cálido deliberado, no gris puro (`decisiones-de-diseno.md` §Superficies):
`--bg` `#faf8f4` · `--surface` `#ffffff` · `--surface-2` `#f3efe8` · `--surface-3` `#e9e3d9`

**Texto (3):** `--text` `#1c1917` · `--text-2` `#494440` · `--text-3` `#79726b`

**Líneas (2):** `--line` `#e4ded4` · `--line-strong` `#cdc4b6`

**Marca — berenjena (5):** `--brand` `#6b3a5b` · `--brand-hover` `#572e4a` · `--brand-soft` `#f4ecf1` · `--brand-line` `#d9c3d0` · `--on-brand` `#ffffff`

**Macronutrientes — triada Okabe-Ito, con variante suave cada uno (6):**
`--protein` `#0072b2` / `--protein-soft` `#e4f0f8` · `--carb` `#e69f00` / `--carb-soft` `#fdf2dd` · `--fat` `#009e73` / `--fat-soft` `#dff2ec`

**Estados semánticos (4):** `--danger` `#b3261e` / `--danger-soft` `#fbeceb` · `--warning` `#8a6116` / `--warning-soft` `#fbf3e2`. Nótese la ausencia de un token de «éxito»: es intencionada y está documentada — el verde ya significa *grasa*.

**Forma (4):** `--radius` 10px · `--radius-sm` 7px · `--radius-lg` 14px · `--shadow-pop` (dos capas, la única sombra del sistema, reservada a flotantes).

**Movimiento (9):** `--dur` 150ms y `--ease` genéricos, más la tabla de §5.1 de `diseno-producto.md`: `--dur-rapida` 120ms (color, hover, foco), `--dur-media` 220ms (panel, hoja, crossfade), `--dur-lenta` 320ms (pantalla→resultado), `--dur-cuadre` 500ms (**sólo el compás 4**), y tres curvas `--ease-entrada` / `--ease-salida` / `--ease-suave`. Regla de asimetría declarada: la salida dura ≈65 % de la entrada.

**Velo (1):** `--scrim` `rgb(0 0 0 / 0.4)`, con el comentario de que es idéntico en ambos temas a propósito: «oscurece el fondo, no lo tiñe».

**Total: 30 tokens de color + 4 de forma + 9 de movimiento + 1 de velo.**

### 3.2 Puente a Tailwind

El bloque `@theme inline` (líneas 151–186) reexpone 22 de los tokens de color como utilidades (`bg-brand`, `text-text-2`, `border-line-strong`…), más `--font-sans`/`--font-mono` desde las variables de `next/font`, más `--radius-base`. **Los tokens de forma y movimiento NO están expuestos como utilidades**: por eso todo el código escribe `rounded-[var(--radius-lg)]` en vez de una clase corta. Es funcional pero verboso; se puede pulir exponiéndolos en `@theme inline` como `--radius-*`.

### 3.3 El patrón de tres estados: SÍ se sigue, exactamente

`decisiones-de-diseno.md` (líneas 94–104) describe tres estados y `globals.css` los implementa uno a uno:

1. **`:root`** (líneas 17–76) define la paleta clara **completa**. Ningún color tiene su única definición dentro de un bloque condicional. ✔
2. **`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`** (líneas 79–113) redefine, acotado, para que una elección explícita de claro gane sobre el sistema. ✔
3. **`:root[data-theme="dark"]`** (líneas 116–148) redefine otra vez para que el interruptor gane en la otra dirección. ✔

Y el script de `layout.tsx:35-40`/`:54` aplica el tema guardado **antes del primer pintado**, leyendo `localStorage.getItem("planeat-theme")` dentro de un `try/catch`, con `suppressHydrationWarning` en el `<html>` (línea 51). El toggle (`theme-toggle.tsx`) lee ese estado con `useSyncExternalStore` en vez de un `useEffect`, que es lo correcto para estado que vive fuera de React.

**Deuda real de este patrón:** los bloques 2 y 3 son **34 líneas duplicadas carácter a carácter** (79–113 vs 116–148). Cualquier cambio de token oscuro hay que hacerlo dos veces y nada lo verifica. Se resuelve con una sola lista de selectores: `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` y `:root[data-theme="dark"] { … }` compartiendo un bloque vía `:is()` no es posible dentro de una media query, pero sí se puede extraer a un fichero `tema-oscuro.css` importado dos veces, o —lo más limpio— usar `light-dark()` de CSS con `color-scheme`. Como mínimo, un comentario cruzado que diga «si tocas esto, toca también la línea N».

**Falta un token que el propio documento reclama:** no hay declaración de `color-scheme` en `:root`. Sin `color-scheme: dark`, los controles nativos (la rueda del `<select>` de `CampoElegir`, las barras de scroll, el autofill) se pintan en claro sobre un tema oscuro. Es visible justo en el generador, que es la primera pantalla.

### 3.4 Reglas globales fuera de tokens

- `body` (188–192): fondo, color y `font-family` con cadena de respaldo. Explícito, correcto para artefactos con tema del visor.
- `.tnum, table, [data-numeric]` (196–200): `font-variant-numeric: tabular-nums`. Tres vías de aplicación, tal como documenta `decisiones-de-diseno.md`.
- `:focus-visible` (202–206): contorno de 2 px en `--brand` con offset 2. **Contiene un bug, ver hallazgo 8.1.**
- `@media (prefers-reduced-motion: reduce)` (208–217): reset global a 0,01 ms. El propio `diseno-producto.md` §5.5 avisa de que este reset es una red de seguridad y no basta para bucles infinitos; `estado-generacion.tsx:49` y `memoria-plegado.ts:96-104` ya consultan la media query de verdad. Bien resuelto.

Referencias: `apps/web/src/app/globals.css:17-76`, `apps/web/src/app/globals.css:79-113`, `apps/web/src/app/globals.css:116-148`, `apps/web/src/app/globals.css:151-186`, `apps/web/src/app/globals.css:188-217`, `apps/web/src/app/layout.tsx:35-40`, `apps/web/src/app/layout.tsx:48-56`, `apps/web/src/components/theme-toggle.tsx:15-51`, `apps/web/src/lib/memoria-plegado.ts:88-104`, `docs/decisiones-de-diseno.md:88-111`

## 4. Pendiente (a) — Tipografía definitiva

### Qué hay hoy

`layout.tsx:5-13` carga **Geist** y **Geist Mono** vía `next/font/google` con `subsets: ["latin"]`, expuestas como `--font-geist-sans` y `--font-geist-mono` y conectadas a Tailwind en `globals.css:182-183`. `body` usa `var(--font-sans)` con respaldo a `ui-sans-serif, system-ui, sans-serif`.

**Geist Mono se carga y no se usa en ningún sitio del flujo.** Único uso en todo `src/`: `sistema/page.tsx:58`, un `<code className="font-mono">` de la página de referencia. Es una familia entera descargada para una etiqueta de muestra.

Los tamaños se escriben como valores arbitrarios repartidos por los componentes, sin escala: `text-[34px]` (`page.tsx:56`), `text-[17px]` (`page.tsx:59`, `sobre-restriccion.tsx:58`, `sin-servicio.tsx:74`), `text-[19px]` (`plan-dia.tsx:206`), `text-[16px]` (`plan-dia.tsx:284`), `text-[15px]` (siete sitios), `text-[13px]` (`barra-reparto.tsx:80`, `bloque-nutricional.tsx:74`), `text-[26px]` (`sobre-restriccion.tsx:52`). No existen tokens tipográficos.

### Qué falla

1. **No es que la decisión esté pendiente: es que ya está tomada y no está implementada.** `docs/diseno-producto.md` §2.2 (líneas 166–221) resuelve el pendiente de `decisiones-de-diseno.md` con una decisión firme y razonada — dos fuentes con reparto estricto: Geist para *trabajo* (toda la UI, todo el cuerpo, **todos los números**) e **Instrument Serif** 400 + itálica para *voz*, en exactamente cuatro sitios. Descarta Playfair («lee a boda»), Calistoga («cartel de food truck»), Söhne (de pago) y el «sólo Geist» («el producto queda correcto y sin memoria»). El código no refleja nada de esto.
2. Los cuatro sitios de la voz están hoy en Geist semibold: H1 de portada (`page.tsx:56-58`), título de ficha de receta (`panel-receta.tsx:77-79`), titular de sobre-restricción (`sobre-restriccion.tsx:52-54`) y la cifra héroe de sobre-restricción (`sobre-restriccion.tsx:62`, `text-5xl sm:text-6xl`).
3. La escala de 11 tokens de §2.2 (`voz-1`, `voz-2`, `t-1`, `t-2`, `t-3`, `cuerpo`, `cuerpo-sm`, `etiqueta`, `micro`, `cifra-heroe`, `cifra`) no existe en `globals.css`. Cada componente reinventa su tamaño con un valor arbitrario, y ya hay desviaciones respecto a la tabla: `sobre-restriccion.tsx:52` usa 26/30 px cuando `voz-2` pide 26/32; `plan-dia.tsx:89` usa `text-lg` (18 px) donde `t-1` pide 24/28.
4. La página `/sistema` enseña una «Escala tipográfica» (`sistema/page.tsx:105-129`) que **no es la escala del documento**: son cuatro clases genéricas de Tailwind (`text-4xl`, `text-xl`, `text-base`, `text-sm`). Es una referencia viva que documenta algo que no se usa.

### Propuesta concreta

1. **Cargar Instrument Serif** en `layout.tsx` junto a Geist:
   ```ts
   const instrumentSerif = Instrument_Serif({
     variable: "--font-voz", subsets: ["latin"],
     weight: "400", style: ["normal", "italic"],
   });
   ```
   y añadirla a `className` del `<html>`. Con export estático se auto-aloja en `_next/static/media`, sin petición a terceros. **Antes de nada, resolver el Anexo C.1 de `diseno-producto.md`: la licencia OFL figura en Google Fonts pero no se ha verificado en el repositorio oficial de la fuente; la sustituta directa es Newsreader.**
2. **Quitar Geist Mono** del layout, o dejarla sólo si la página `/sistema` la justifica. Hoy es peso muerto en la portada.
3. **Declarar los 11 tokens tipográficos en `globals.css`** y exponerlos en `@theme inline` como `--text-voz-1`, `--text-t-2`, etc., con su par tamaño/interlínea. Tailwind 4 admite `--text-*: <tamaño>` y `--text-*--line-height`. Así `text-voz-1` es una utilidad real y desaparecen los 15 valores arbitrarios.
4. **Aplicar la voz en los cuatro sitios y en ninguno más.** Añadir la restricción al fichero como comentario: nunca en UI, nunca en un número de dato, nunca por debajo de 24 px, nunca en negrita.
5. **Sustituir la sección de escala de `/sistema`** por una muestra de los 11 tokens reales, con su nombre al lado. Esa página existe para verificar tokens; si enseña otros, engaña.
6. Conservar `tabular-nums` incluso en `cifra-heroe`: la decisión está tomada en `decisiones-de-diseno.md` y §2.2 la reafirma explícitamente.

Referencias: `apps/web/src/app/layout.tsx:5-13`, `apps/web/src/app/layout.tsx:50`, `apps/web/src/app/globals.css:182-183`, `apps/web/src/app/page.tsx:56-59`, `apps/web/src/components/panel-receta.tsx:77-79`, `apps/web/src/components/sobre-restriccion.tsx:52-62`, `apps/web/src/components/plan-dia.tsx:89`, `apps/web/src/components/plan-dia.tsx:206`, `apps/web/src/components/plan-dia.tsx:284`, `apps/web/src/app/sistema/page.tsx:105-129`, `apps/web/src/app/sistema/page.tsx:58`, `docs/diseno-producto.md:166-221`, `docs/diseno-producto.md:1274-1281`

## 5. Pendiente (b) — Micro-interacción del estado de generación

### Qué hay hoy — `src/components/estado-generacion.tsx` (143 líneas)

Está bastante mejor de lo que sugiere el «pendiente». Ya implementado y correcto:

- **No es un esqueleto genérico**: una fila de 72 px por comida del layout del usuario, con el nombre real del slot ya escrito (`NOMBRE_SLOT[slot]`, líneas 68–86). Esto es el concepto «el día se pone la mesa» de §5.4.
- **Cero barra de porcentaje**. Cuatro pasos honestos atados al pipeline real (`PASOS`, líneas 35–40), con `role="status" aria-live="polite"` (línea 90) y marcas `sr-only` de «(hecho)» / «(en curso)» (líneas 128–129).
- **Umbral de 400 ms** antes de montar nada, gestionado por quien lo usa (`generador.tsx:100-103` y `vista-plan.tsx:78-81`, ambos con `MS_ANTES_DEL_ESQUELETO = 400`).
- **Aviso de espera larga a los 6 s** (`MS_ESPERA_LARGA`, líneas 42, 52–55, 135–139).
- **`prefers-reduced-motion` consultado de verdad** (línea 49, vía `useMovimientoReducido`) y la animación **no se monta**, no se acelera — con `planeat.module.css:58-63` como red de seguridad.
- **Compás 4 implementado y bien**: `barra-progreso-dia.tsx:64-73` monta con el reparto del objetivo y transiciona a los anchos reales con `--dur-cuadre`, usando el truco de dos `requestAnimationFrame` para que el navegador no agrupe los estilos.

### Qué falla

1. **Los pasos son mentira estática.** Líneas 93–94: `const hecho = indice === 0; const enCurso = indice === 1;`. Están cableados. El paso 2 aparece «en curso» desde el milisegundo 400 hasta el final, y los pasos 3 y 4 nunca cambian. Con el motor en el servidor no había alternativa; **con el motor en el navegador sí la hay, y es el argumento entero de esta pantalla**.
2. **Falta el compás 1.** §5.4 pide que la cinta superior dibuje los tres segmentos **en su color al 25 % de opacidad**, de izquierda a derecha, en 400 ms: es el objetivo, no el resultado. Lo que hay es un rectángulo liso `bg-surface-3` (línea 64). Se pierde la mitad del mensaje del compás 4, porque la barra no «viene» de ningún sitio: aparece de cero.
3. **Falta el compás 3, que el propio documento llama «el momento crítico del diseño»**. §5.4: los títulos reales deben aparecer de arriba abajo, 90 ms entre filas, opacidad 0→1 + `translateY(6px)→0`, **antes de que la barra cuadre**. «La espera termina cuando hay algo que leer, no cuando termina la animación». Lo que ocurre en el código es lo contrario: el esqueleto se desmonta entero de golpe (`vista-plan.tsx:168-171`) y el plan entra con un `.aparicion` (crossfade de opacidad, `planeat.module.css:88-96`). La escalera de `.entrada` de `plan-dia.tsx:123` (40 ms, máx. 6 elementos) es la entrada genérica de listas del §5.3, no el compás 3.
4. **Regla 2 de honestidad temporal sin implementar**: «si la respuesta llega a mitad del compás 2, el barrido termina su ciclo actual (máx. 300 ms más) y salta al 3». Hoy el barrido se corta a mitad, que es exactamente lo que el documento dice que «se ve como un fallo de renderizado».
5. **Doble región viva superpuesta**: `estado-generacion.tsx:90` monta `role="status"` y `vista-plan.tsx:145` monta otro `role="status"` permanente que anuncia «Montando tu día.». Un lector de pantalla oye las dos cosas.

### Propuesta concreta

El port a TypeScript es la oportunidad, no un obstáculo: **el motor pasa a correr en el mismo hilo de eventos que la interfaz, así que los cuatro pasos pueden ser reales por primera vez.**

1. **Cambiar la firma del componente** a `EstadoGeneracion({ slots, paso, titulosParciales })`, con `paso: 0|1|2|3` y un callback de progreso. Si el motor TS corre en un **Web Worker** (recomendable: 2400 líneas de LP no deben bloquear el hilo principal, y da un `terminate()` limpio para el corte de 20 s), que emita cuatro `postMessage` de progreso atados a las cuatro etapas reales de `spec.md` §4.2: objetivos calculados → pool de candidatas construido → porcionado → cuadre. Cada `postMessage` avanza `paso`. **El paso 4 sigue sin marcarse hasta que llega el resultado** (regla 4).
2. **Compás 1:** sustituir el `div` liso de la línea 64 por el reparto del objetivo — reutilizar `segmentos(repartoDelObjetivo(objetivo))` de `barra-progreso-dia.tsx:47-54`, pintado a `opacity: 0.25` con una entrada de 400 ms en `--ease-entrada`. El objetivo ya lo tiene el cliente antes de generar: `generador.tsx:70` calcula `objetivoPrevisto`. Cero coste, y el compás 4 pasa a tener origen.
3. **Compás 3:** que el motor emita los títulos en cuanto los tiene, y que las filas del esqueleto **se transformen en filas de item** en el sitio (misma altura de 72 px, ya reservada), escalonadas 90 ms. Es un cambio de contenido dentro del mismo nodo, no un desmontaje. Elimina el crossfade global y hace que el usuario empiece a leer antes.
4. **Regla 2:** al recibir el resultado durante el compás 2, esperar al final del ciclo de barrido en curso (máx. 300 ms) con un `animationiteration` listener antes de pasar al 3.
5. **Quitar la región viva duplicada**: dejar el `role="status"` de `vista-plan.tsx:145` como único punto de anuncio y bajar el de `estado-generacion.tsx:90` a un contenedor mudo.
6. Con `movimientoReducido`, todo lo anterior degrada según §5.5: la línea de estado **sigue cambiando de texto** (ahora con datos reales, que es una mejora también aquí), las filas quedan estáticas en `--surface-2`, los títulos son cambio instantáneo de contenido y la cinta se dibuja directa en su estado final.

Referencias: `apps/web/src/components/estado-generacion.tsx:35-42`, `apps/web/src/components/estado-generacion.tsx:48-64`, `apps/web/src/components/estado-generacion.tsx:90-133`, `apps/web/src/components/barra-progreso-dia.tsx:47-73`, `apps/web/src/components/vista-plan.tsx:145-166`, `apps/web/src/components/vista-plan.tsx:168-171`, `apps/web/src/components/plan-dia.tsx:118-139`, `apps/web/src/components/planeat.module.css:37-63`, `apps/web/src/components/planeat.module.css:65-102`, `docs/diseno-producto.md:889-935`, `docs/diseno-producto.md:936-963`

## 6. Pendiente (c) — Tratamiento visual de la ficha de receta

### Qué hay hoy — `src/components/panel-receta.tsx` (226 líneas)

Lo que está bien y hay que conservar:

- **`<dialog>` nativo con `showModal()`** (líneas 43–50): aporta trampa de foco, cierre con `Escape`, fondo inerte y devolución del foco al elemento que lo abrió, sin una línea de código propio.
- **Geometría responsive correcta** (`planeat.module.css:156-215`): hoja inferior a ancho completo con `max-height: 88dvh` en móvil, panel lateral de 400 px a altura completa desde `min-width: 1024px`, con animaciones distintas (`entradaHoja` desde abajo, `entradaPanel` desde la derecha) para que «vuelva por donde ha venido».
- **Las tres capas en su orden**: frase de conclusión (línea 106) → `BarraReparto` (línea 107) → tabla nutricional (líneas 143–191).
- **Honestidad de datos**: `receta.conocido.*` decide si cada fila lleva valor o `null`, y `tabla-nutricional.tsx:77` pinta «sin declarar» en vez de un cero. La conversión legal sal = sodio × 2,5 (Reg. UE 1169/2011) está anotada en la línea 178.

### Qué falla — es la pantalla que más se desvía de su propia especificación

`diseno-producto.md` §3.5 (líneas 529–570) especifica nueve elementos verticales. Están implementados 3 de 9.

1. **No hay foto.** §3.5 punto 1 pide foto 3:2 a sangre en móvil, con radio en escritorio, `fetchpriority="high"`, y §2.6 fija la densidad de esta pantalla en «Baja — la foto manda». La ficha abre directamente con un `<header>` de texto. La regla de oro de la pantalla («el primer segundo: la foto y el título») no se cumple porque no hay foto ni placeholder. `RecetaResumen` (`tipos.ts:14-43`) **ni siquiera tiene campo de imagen**.
2. **Título en Geist, no en la serif.** Línea 77: `text-xl font-semibold` = 20 px. §2.2 lo marca como uno de los cuatro sitios de `voz-2` (26/32 px, serif 400).
3. **No hay selector de raciones** (§3.5 punto 4). `factorRacion` llega como prop fija desde `plan-dia.tsx:130-133` y no se puede tocar. Sin él, la ficha no recalcula nada en vivo.
4. **Ingredientes sin doble unidad** (§3.5 punto 6). Líneas 110–120: lista de nombres a secas. Falta `2 cucharadas · 25 g`, la marca de no escalable y la unidad doméstica en peso 500. La línea 126–130 lo reconoce honestamente («las cantidades por ingrediente... todavía no las expone el servicio»), lo cual está bien, pero es una limitación del catálogo que el port puede levantar: `services/solver/data/recetas.json` (36 KB) probablemente sí las tiene y hoy no se lee.
5. **No hay pasos, ni Modo cocina** (§3.5 puntos 7–8).
6. **El banner de alérgeno excluido no existe** (§3.5, tabla de estados: `--danger-soft` con `role="alert"` arriba del todo, y la receta **no se oculta**). Causa raíz: la app **nunca recoge alérgenos a excluir** — `perfil.ts:371` envía `alergenosExcluidos: []` cableado y el formulario no tiene ese campo. Toda la maquinaria de `nombreAlergeno()` y los catorce nombres (`perfil.ts:97-116`) están construidos y sin usar.
7. **Bug de interacción en escritorio.** `planeat.module.css:194-197` pone `::backdrop { background: transparent }` «sin velo en escritorio: el plan sigue visible detrás, que es el punto». Pero se abre con `showModal()`, así que el fondo es **inerte**: el usuario ve el plan, intenta pulsar en él y no pasa nada — y como el backdrop es transparente, tampoco parece que haya un modal del que salir. Además un clic en el backdrop **no cierra un `<dialog>`** por defecto: no hay ningún handler. La única salida es `Escape` o el botón de cerrar. La intención del diseño (plan legible *y* usable detrás) exige `show()` en vez de `showModal()` en el breakpoint `lg`, o al menos un handler de clic en el backdrop.
8. **`id="titulo-ficha"` es un literal** (línea 77, referenciado en `aria-labelledby` línea 72). `vista-plan.tsx:172-188` mapea sobre `resultado.dias`, y cada `PlanDia` monta su propio `PanelReceta` (`plan-dia.tsx:170-175`). Con más de un día en el plan hay IDs duplicados en el documento. Hoy sólo se genera un día, pero es una bomba de relojería: usar `useId()`.
9. **Densidad demasiado alta para lo que pide §2.6.** Ocho bloques de texto seguidos con `mt-8` entre ellos y tres párrafos de descargo de responsabilidad (líneas 126–130, 138–141, y la nota de `TablaNutricional`). Es una ficha técnica, no algo que dé apetito.

### Propuesta concreta, en orden de coste creciente

1. **Barato y de gran efecto: la cabecera visual.** Añadir `imagenUrl?: string | null` a `RecetaResumen` y renderizar un bloque 3:2 al principio del panel con `aspect-ratio` declarado siempre (§2.5, «la causa número uno de CLS»). Mientras no haya fotos, usar el placeholder ya especificado y ya implementado en otro sitio: bloque `--surface-2` con la inicial del plato — es literalmente el patrón de `plan-dia.tsx:271-278`, extraerlo a un componente compartido. Con placeholder, «el título sube y ocupa más aire» (tabla de estados de §3.5).
2. **Título a `voz-2`** en cuanto exista el token del hallazgo 4.
3. **Selector de raciones**, limitado a 0,5×–4× como pide la tabla de estados. `factorRacion` pasa de prop a estado local con valor inicial el del plan; todo lo demás ya escala solo, porque `escalar()` (línea 56) está centralizado y la tabla y la barra ya lo consumen.
4. **Arreglar el modal de escritorio**: `show()` en `lg`, `showModal()` por debajo. Requiere reimplementar a mano lo que `showModal` regalaba (Escape y foco) sólo en ese breakpoint — es el precio de la decisión de diseño, y hay que pagarlo o cambiar la decisión.
5. **`useId()` para el `aria-labelledby`.**
6. **Aligerar**: fundir los tres descargos en uno solo al pie (§3.5 punto 9 pide el aviso de alérgenos «siempre, sin plegar», uno), y mandar la tabla nutricional a un `DetallePlegable` como ya se hace en `bloque-nutricional.tsx:97-104`. Sube el aire y baja la densidad sin perder ningún dato.
7. **Añadir el campo de alérgenos al formulario** y activar el banner. Desbloquea código ya escrito y es la única forma de que el filtro de alérgenos —que el pie de página promete en `page.tsx:89-93`— haga algo.

Referencias: `apps/web/src/components/panel-receta.tsx:43-53`, `apps/web/src/components/panel-receta.tsx:67-107`, `apps/web/src/components/panel-receta.tsx:109-141`, `apps/web/src/components/panel-receta.tsx:143-201`, `apps/web/src/components/planeat.module.css:156-215`, `apps/web/src/components/plan-dia.tsx:170-175`, `apps/web/src/components/plan-dia.tsx:271-278`, `apps/web/src/lib/tipos.ts:14-43`, `apps/web/src/lib/perfil.ts:97-116`, `apps/web/src/lib/perfil.ts:369-372`, `apps/web/src/components/tabla-nutricional.tsx:76-85`, `docs/diseno-producto.md:529-570`, `docs/diseno-producto.md:327-347`

## 7. Componentes que pasan a client component (y los que no)

### 7.1 Estado actual

**Ya son cliente (10):** `generador.tsx:1`, `vista-plan.tsx:1`, `plan-dia.tsx:1`, `panel-receta.tsx:1`, `estado-generacion.tsx:1`, `sobre-restriccion.tsx:1`, `sin-servicio.tsx:1`, `barra-progreso-dia.tsx:1`, `detalle-plegable.tsx:1`, `theme-toggle.tsx:1`. Más `lib/memoria-plegado.ts:1`.

**Sin `"use client"` (7):** `bloque-nutricional.tsx`, `barra-reparto.tsx`, `veredicto.tsx`, `tabla-nutricional.tsx`, `iconos.tsx`, `macro-bar.tsx` (marcado como obsoleto en su cabecera, sólo lo usa `/sistema`), y los cuatro ficheros de `app/`.

### 7.2 Qué cambia de verdad con la generación en el navegador

**Cambio obligatorio — uno solo:**

- **`src/app/plan/page.tsx`**. Hoy es un Server Component `async` que llama a `generarPlan()` (línea 49) y monta `VistaPlan` con datos ya resueltos. Se parte en dos (ver hallazgo 1.2): un shell servidor que conserva `export const metadata` (líneas 29–32), cabecera, pie y el `<Suspense>`; y un `plan-cliente.tsx` nuevo con `"use client"` que lee `useSearchParams()`, valida con `leerFormulario`/`validar` (ya puros) y llama al motor TS. El bloque de errores de validación (líneas 66–84) también baja al cliente, porque depende de la query.

**Cambio de módulo, no de componente:**

- **`src/lib/solver.ts`** — pierde el `// sólo servidor`, pierde `process.env` y el `fetch`, y pasa a ser la fachada del motor TS. Lo importan `generador.tsx` y `vista-plan.tsx` directamente en vez del `fetch("/api/plan")`. Recomendación fuerte: exponerlo como `async function generarPlan(solicitud): Promise<ResultadoPlan>` idéntica en firma, de forma que **ni `generador.tsx` ni `vista-plan.tsx` cambien más allá de sustituir el `fetch` por la llamada**. La `AbortSignal.timeout(20_000)` se sustituye por `worker.terminate()` con el mismo presupuesto.
- **`src/lib/catalogo.ts`** — pierde `node:fs` y pasa a reexportar el catálogo empaquetado. `cargarCatalogo(): Promise<Catalogo | null>` puede mantener la firma asíncrona para no tocar a nadie.

**No cambian, pero conviene saberlo:** `bloque-nutricional.tsx`, `barra-reparto.tsx`, `veredicto.tsx`, `tabla-nutricional.tsx` e `iconos.tsx` **no necesitan `"use client"`**. Ya viajan al navegador hoy, porque los importan componentes cliente y en el App Router eso los arrastra al bundle del cliente automáticamente. Añadirles la directiva no cambia nada funcional y ensucia. Déjalos como están.

**Se quedan en servidor (se prerenderizan en el build):** `layout.tsx` (incluido su script inline de tema, que se serializa tal cual), `app/page.tsx` (la portada sólo compone prosa estática y monta `<Generador/>`, que ya es cliente) y `app/sistema/page.tsx`.

### 7.3 Consecuencia de arquitectura que hay que decidir

Hoy el resultado del plan viaja por dos caminos distintos que convergen en `VistaPlan`: (a) la portada, sin cambiar de URL, con estado en React (`generador.tsx:99-146`), y (b) la URL `/plan?sexo=...&edad=...`, compartible, renderizada en servidor. El camino (b) sobrevive al export **sólo como ruta de cliente**: el HTML de `/plan/index.html` será idéntico para toda query, y el plan se calcula tras hidratar. Efectos: sin SEO del contenido del plan, y el primer pintado de `/plan` es un `<Suspense>` vacío. Es aceptable para el objetivo declarado (validar funcionamiento real), pero conviene que el fallback del `<Suspense>` sea `<EstadoGeneracion>` y no una pantalla en blanco.

Referencias: `apps/web/src/app/plan/page.tsx:29-49`, `apps/web/src/app/plan/page.tsx:66-95`, `apps/web/src/app/page.tsx:36-66`, `apps/web/src/app/sistema/page.tsx:66-78`, `apps/web/src/app/layout.tsx:42-58`, `apps/web/src/components/generador.tsx:99-146`, `apps/web/src/components/vista-plan.tsx:60-132`, `apps/web/src/lib/solver.ts:67-73`, `apps/web/src/lib/catalogo.ts:157-161`, `apps/web/src/components/bloque-nutricional.tsx:1-13`, `apps/web/src/components/macro-bar.tsx:1-28`

## 8. Otros defectos visuales y de accesibilidad detectados en el código

### 8.1 [Grave] `:focus-visible` deforma las esquinas de todo lo que se enfoca con teclado

`globals.css:202-206`:
```css
:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: var(--radius-sm); }
```

Esa regla está **fuera de toda `@layer`**. Tailwind 4 (`@import "tailwindcss"`, línea 1) mete todas las utilidades en `@layer utilities`, y en la cascada CSS **cualquier declaración sin capa gana a cualquier declaración en capa, con independencia de la especificidad**. Resultado: al enfocar con teclado, `border-radius: 7px` machaca la clase `rounded-*` del elemento. Se ve en:

- El botón principal `rounded-[var(--radius)]` (10 px) de `generador.tsx:277` → cambia a 7 px al tabular.
- `theme-toggle.tsx:59` `rounded-lg` (8 px) → 7 px.
- Cualquier elemento `rounded-full` enfocable — el más visible sería un chip o un avatar futuro, que pasaría de círculo a cuadrado redondeado.

**Arreglo:** quitar `border-radius` de esa regla (el `outline` ya sigue la forma del elemento en navegadores modernos), o encapsular las reglas base en `@layer base { ... }`.

### 8.2 [Grave] La zona de resultado se dibuja con un contorno de marca al enviar el formulario con teclado

`generador.tsx:307`: `<div ref={zonaResultado} tabIndex={-1} className="scroll-mt-6 outline-none">`, y `generador.tsx:133` le da el foco programáticamente tras generar.

Si el usuario ha enviado con `Enter` (última interacción de teclado), el navegador aplica `:focus-visible` al recibir el foco. `outline-none` es una utilidad **en capa** y, por lo mismo que en 8.1, **pierde** contra el `:focus-visible` sin capa. Resultado: un rectángulo berenjena de 2 px alrededor de todo el plan justo en el momento en que aparece. Arreglo: `[tabindex="-1"]:focus-visible { outline: none }` sin capa, o encapsular la regla base.

### 8.3 [Medio] `--text-3` sobre `--bg` en `/sistema` — incumple AA

El Anexo A.2 de `diseno-producto.md` mide `--text-3` en **4,47:1 sobre `--bg` en tema claro**, por debajo del 4,5 de AA, y fija la regla: `--text-3` sólo sobre `--surface`, o en texto ≥ 18,66 px. `app/page.tsx:94-96` lo respeta con un comentario ejemplar.

**`app/sistema/page.tsx` lo incumple cuatro veces**: líneas 47, 58, 107, 122, 135, 146, 154 — párrafos `text-sm text-text-3` que viven en `<main>` sobre `--bg`, sin superficie. Es la página cuya única razón de ser es verificar que los tokens funcionan. Cambiar a `text-text-2`.

### 8.4 [Medio] Falta `color-scheme`

Ni `globals.css` ni `layout.tsx` declaran `color-scheme: light dark` (o su valor sincronizado con `data-theme`). Consecuencia concreta y visible en la primera pantalla: los cinco `<select>` nativos de `CampoElegir` (`generador.tsx:412-424`) abren la rueda del sistema **en claro** sobre el tema oscuro, igual que las barras de scroll y el autofill. El comentario de la línea 388–394 defiende el `<select>` nativo precisamente porque «abre la rueda del sistema»: entonces hay que decirle al sistema de qué color es.

### 8.5 [Medio] Jerarquía tipográfica invertida en `/sistema`

`sistema/page.tsx:46`, `:106`, `:132`: `<h2 className="text-sm font-semibold">` — encabezados de sección a **14 px**, por debajo del texto de cuerpo que los sigue (16 px). El Anexo B pide «jerarquía de encabezados secuencial»; aquí es secuencial en el marcado pero invertida visualmente. Candidato natural al token `micro` (12 px, versalita, +0,04em) de §2.2, que además está declarado como «uso muy restringido: máximo dos por pantalla» — aquí hay tres.

### 8.6 [Medio] `disabled:opacity-60` sobre botón de marca

`generador.tsx:277`: el botón principal en fase «esperando» queda a 60 % de opacidad. `--on-brand` (blanco) sobre `--brand` da 8,31:1 a plena opacidad; al 60 % el texto compuesto cae aproximadamente a 3:1, por debajo de AA para texto de 17 px. Mismo patrón con `disabled:opacity-50` en `plan-dia.tsx:161`, `plan-dia.tsx:321`, `sobre-restriccion.tsx:112` y `sin-servicio.tsx:81`. Alternativa: un par de tokens `--brand-disabled` / `--on-brand-disabled` con contraste medido, en vez de opacidad.

### 8.7 [Menor] Área de toque de las acciones por item

`plan-dia.tsx:321`: el botón «Cambiar» es `hidden ... sm:grid`, es decir **no existe en móvil** — deliberado y explicado en el comentario de las líneas 312–315 (la acción vive dentro de la ficha). Correcto. Pero `planeat.module.css:17-31` revela `.acciones` con `opacity: 0` salvo hover/focus-within, y el `@media (hover: none)` que las deja siempre visibles **sólo aplica a un botón que en táctil está oculto por `hidden`**. La regla no hace daño, pero es código muerto que confunde: quien lea el CSS creerá que en móvil se ve.

### 8.8 [Menor] Doble región viva en el flujo de generación

Ya descrito en el hallazgo 5.5: `estado-generacion.tsx:90` y `vista-plan.tsx:145` montan dos `role="status" aria-live="polite"` simultáneos.

### 8.9 [Menor] Parpadeo del toggle de tema en export estático

`theme-toggle.tsx:34-36`: `getServerSnapshot()` devuelve siempre `"light"`. Con export, ese valor queda **congelado en el HTML del build**. Un usuario con tema oscuro ve el botón etiquetado «Oscuro» hasta que hidrata, y entonces cambia a «Claro». No es un error de hidratación (React resincroniza), pero es un parpadeo textual en la esquina superior. Se mitiga añadiendo al script de `layout.tsx:35-40` la escritura de un atributo que el botón lea en el primer render, o aceptándolo.

Relacionado: `viewport.themeColor` (`layout.tsx:24-29`) sólo reacciona a `prefers-color-scheme`. Si el usuario elige claro con el sistema en oscuro, el color del chrome del navegador se queda oscuro.

### 8.10 [Menor] `id` duplicado potencial en la ficha de receta

Ya descrito en el hallazgo 6.8: `panel-receta.tsx:72` y `:77` usan el literal `"titulo-ficha"`.

### 8.11 [Dato de producto, no de diseño] El catálogo tiene 36 recetas y el umbral de viabilidad es 40

`sobre-restriccion.tsx:27`: `const UMBRAL_VIABILIDAD = 40`. `services/solver/data/catalogo.jsonl` tiene **36 líneas**. Con el motor en el navegador y el catálogo empaquetado, la pantalla de sobre-restricción dirá literalmente «N recetas encajan con tus filtros, de 36 que tengo. Necesito unas 40 para montar variedad sin repetir», que se lee como que el producto nunca puede funcionar. Hay que ampliar el catálogo antes de publicar, o bajar el umbral y anotar por qué.

### 8.12 [Densidad en móvil] El generador conversacional

`generador.tsx:162`, `:205`, `:229`: tres párrafos a `text-xl leading-[2.1]` (20 px con 42 px de interlínea) más `sm:text-2xl sm:leading-[2.2]`. La interlínea enorme es necesaria porque los campos en línea miden 44 px de alto (`h-11`, `planeat.module.css:126-138`) y hay que darles sitio dentro de la prosa: está bien resuelto. Pero a 375 px las tres frases más el microcopy, los errores, el botón y el pie de estimación suman bastante scroll antes de ver «Ver mi día». §2.6 pide para la portada «el titular, la frase-formulario, un botón. Nada más» sin scroll. Merece una medición real a 375 px; es lo único de densidad que me parece dudoso, y no puedo verificarlo sin renderizar.

Referencias: `apps/web/src/app/globals.css:1`, `apps/web/src/app/globals.css:202-206`, `apps/web/src/components/generador.tsx:277`, `apps/web/src/components/generador.tsx:307`, `apps/web/src/components/generador.tsx:133`, `apps/web/src/components/generador.tsx:162`, `apps/web/src/components/generador.tsx:388-424`, `apps/web/src/components/theme-toggle.tsx:34-36`, `apps/web/src/components/theme-toggle.tsx:59`, `apps/web/src/app/sistema/page.tsx:46-58`, `apps/web/src/app/sistema/page.tsx:105-155`, `apps/web/src/app/page.tsx:94-96`, `apps/web/src/components/plan-dia.tsx:161`, `apps/web/src/components/plan-dia.tsx:312-321`, `apps/web/src/components/sobre-restriccion.tsx:27`, `apps/web/src/components/sobre-restriccion.tsx:112`, `apps/web/src/components/sin-servicio.tsx:81`, `apps/web/src/components/planeat.module.css:17-31`, `apps/web/src/components/panel-receta.tsx:72-77`, `apps/web/src/app/layout.tsx:24-29`, `docs/diseno-producto.md:1189-1226`

## 9. Lo que NO he podido verificar

Para que nadie lo dé por comprobado:

1. **No he ejecutado ningún build.** Todo lo del hallazgo 1 sale de leer el código y contrastarlo con `node_modules/next/dist/docs/01-app/02-guides/static-exports.md` de la versión instalada (Next 16.3.1). El orden en que Next reporta los errores puede diferir, y puede haber bloqueos adicionales que sólo aparecen al ejecutar `next build` con `output: 'export'`.
2. **No he renderizado nada.** Los defectos de contraste de 8.3 y 8.6 se apoyan en las mediciones del Anexo A.2 de `diseno-producto.md`, no en una medición mía. Las afirmaciones sobre densidad en móvil (8.12) son lectura de código, no captura a 375 px.
3. **El comportamiento de cascada de 8.1 y 8.2** (sin capa gana a en capa) es la especificación de CSS Cascade Layers y el modelo de capas de Tailwind 4, pero **no lo he confirmado en un navegador con este CSS concreto**. Es trivial de comprobar: tabular al botón «Ver mi día» y mirar las esquinas.
4. **No he leído el motor Python.** No sé si las cuatro etapas de `spec.md` §4.2 son separables en cuatro `postMessage` de progreso tal como propongo en el hallazgo 5, ni si `recetas.json` contiene las cantidades por ingrediente que la ficha necesita (hallazgo 6.4). Ambas cosas hay que confirmarlas contra `services/solver/`.
5. **No he mirado `packages/shared` más allá de comprobar que no importa nada de `node:`.** Doy por bueno que `calcularObjetivo`, `gastoTotal`, `AJUSTE_OBJETIVO`, `KCAL_MINIMAS` y `kcalPresentables` son puros porque los usa `generador.tsx` en el cliente hoy y funciona.
6. **La licencia de Instrument Serif** sigue sin verificar, tal como declara el Anexo C.1. No la he comprobado yo tampoco.

Referencias: `node_modules/next/dist/docs/01-app/02-guides/static-exports.md`, `docs/diseno-producto.md:1274-1315`, `apps/web/package.json:11-16`

## Riesgos

- **[alta]** Falta el fichero `.nojekyll` en la raíz publicada. GitHub Pages pasa el sitio por Jekyll, que ignora todo directorio que empiece por guion bajo, y Next emite absolutamente todo el JavaScript y el CSS bajo `_next/`. El sitio se sirve como HTML pelado, sin estilos y sin interactividad, con un 404 por cada asset.
  - Mitigación: Añadir `touch apps/web/out/.nojekyll` como paso del workflow, justo después de `next build` y antes de subir el artefacto. Verificar en el despliegue que `https://xblackflashx.github.io/PlanEat/_next/static/...` devuelve 200 y no 404.
- **[alta]** El formulario deja de funcionar sin JavaScript. `generador.tsx` (cabecera, líneas 14-19) declara como decisión de producto que «esto es un producto que se busca en Google: tiene que funcionar sin JS», y lo implementa con `<form method="get" action="/plan">`. En export estático `/plan` no puede renderizar en servidor a partir de la query, así que ese camino muere. Además el contenido del plan deja de ser indexable.
  - Mitigación: Aceptarlo explícitamente y anotarlo en `docs/decisiones-de-diseno.md` como decisión revertida por el despliegue estático, con la razón. Quitar `method`/`action` del `<form>` para no dejar un camino roto que envíe al usuario fuera del sitio. La portada, la prosa de venta y `/sistema` sí se prerenderizan y siguen siendo indexables.
- **[media]** El bloque de tema oscuro está duplicado carácter a carácter en `globals.css` (líneas 79-113 y 116-148, 34 líneas idénticas). Cualquier retoque de la paleta oscura hecho en un solo sitio produce una divergencia silenciosa entre «oscuro por sistema» y «oscuro por interruptor» que nadie detecta hasta que un usuario la ve.
  - Mitigación: Extraer la paleta oscura a un fichero importado dos veces, o migrar a `light-dark()` con `color-scheme`. Como mínimo inmediato, un comentario cruzado en ambos bloques y una comprobación manual en `/sistema` alternando el interruptor con el sistema en cada uno de sus dos estados.
- **[media]** Portar el motor y pulir el diseño a la vez. Los hallazgos 4, 5 y 6 tocan `layout.tsx`, `globals.css`, `estado-generacion.tsx`, `barra-progreso-dia.tsx` y `panel-receta.tsx`; el port toca `plan/page.tsx`, `solver.ts`, `catalogo.ts`, `generador.tsx` y `vista-plan.tsx`. Se solapan en el estado de generación, que es justo la pieza cuya mejora depende del port. Mezclarlo hace imposible saber si un fallo es del motor o del CSS.
  - Mitigación: Tres fases con verificación entre ellas. (1) Export estático + basePath + Pages con el motor todavía devolviendo `sin_servicio`: valida despliegue, assets, favicon y rutas de forma aislada. (2) Motor TS con la interfaz intacta y `generarPlan()` manteniendo su firma actual: valida el port sin ruido visual. (3) Pulido de diseño, con los cuatro compases ya conectados a un motor que emite progreso real.
- **[media]** El catálogo tiene 36 recetas y `UMBRAL_VIABILIDAD` está en 40 (`sobre-restriccion.tsx:27`). En cuanto la generación corra de verdad en el navegador, la pantalla de sobre-restricción puede decir «N recetas encajan, de 36 que tengo; necesito unas 40», que se lee como que el producto es inviable por construcción. Es el peor mensaje posible en una demo pensada para validar funcionamiento real.
  - Mitigación: Antes de publicar, ampliar `services/solver/data/catalogo.jsonl` por encima de 40 recetas, o bajar el umbral con una nota de por qué. Y probar la generación con cada una de las seis dietas de `DIETAS` (`perfil.ts:81-88`): con 36 recetas, `vegana` y `baja_en_carbohidratos` son las candidatas a caer siempre en sobre-restricción.
- **[media]** `basePath` se inlinea en el bundle en tiempo de build y no se puede cambiar sin recompilar (aviso explícito de la documentación de Next). Un build hecho para `localhost` desplegado en Pages, o al revés, produce un sitio con todos los enlaces y assets rotos y sin ningún error visible en el build.
  - Mitigación: Fijar `basePath: '/PlanEat'` incondicionalmente, de modo que `next dev` también sirva bajo `/PlanEat` y local y producción se comporten igual. Si se condiciona por variable de entorno, dejarlo escrito en el README y añadir al workflow una comprobación de que `out/index.html` contiene `/PlanEat/_next/`.
- **[media]** Ejecutar 2400 líneas de motor de generación en el hilo principal del navegador congela la interfaz durante toda la generación. El estado de generación —cuya razón de ser es informar mientras el usuario espera— no podría ni repintarse, y el corte de seguridad de 20 s (`MS_LIMITE_GENERACION`) sería imposible de aplicar porque no habría hilo libre para dispararlo.
  - Mitigación: Ejecutar el motor en un Web Worker desde el principio, no como optimización posterior. Da tres cosas de golpe: interfaz fluida, `terminate()` limpio para el corte de 20 s, y los cuatro `postMessage` de progreso que hacen honestos por primera vez los pasos de `estado-generacion.tsx`. Con `output: 'export'` el worker se empaqueta con `new Worker(new URL('./motor.worker.ts', import.meta.url))`, que Next resuelve en build; verificar que la URL resultante lleva el `basePath`.
- **[baja]** Las reglas sin capa de `globals.css` ganan a todas las utilidades de Tailwind. Hoy eso ya rompe `outline-none` y todos los `rounded-*` durante el foco de teclado (hallazgos 8.1 y 8.2). Cualquier regla base que se añada en el pulido —tipografía, `color-scheme`— heredará el mismo problema y machacará utilidades de forma silenciosa.
  - Mitigación: Envolver todas las reglas base de `globals.css` (`body`, `.tnum`, `:focus-visible`, y las que se añadan) en `@layer base { ... }`. Es un cambio de dos líneas que restaura el orden de cascada esperado y arregla los dos defectos de foco de paso. Comprobar después que el foco de teclado sigue dibujando el contorno berenjena en el botón principal.
