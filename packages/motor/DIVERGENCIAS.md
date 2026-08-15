# Divergencias conscientes respecto del solver Python

Este fichero es el registro de las diferencias **deliberadas** entre
`packages/motor` y `services/solver`. Cada entrada dice qué cambia, por qué, qué
se puede observar desde fuera y qué test la fija. Lo que no está aquí es un bug.

Es un fichero **compartido** por todos los módulos del port: cada agente añade
su sección y no toca las ajenas.

---

## D1 — Rejilla unificada anclada en 0

**Módulo:** `src/porciones.ts` (`rejilla`, `cuantizar`, `pulirUna`,
`resolverPorcionesRejilla`).
**Ordenada por:** `docs/port-typescript.md`, «Divergencias conscientes» (1).

En Python hay **dos** rejillas que no son la misma:

- `_cuantizar` ancla en 0: `round(σ/0,05)·0,05` y después clipa a `[lo, hi]`.
- `_rejilla` ancla en `lo`: `lo + 0,05·k`, más `hi` añadido al final.

Coinciden sólo si `lo` es múltiplo exacto de 0,05. Cuando no lo es, `_pulir_una`
—que recorre `_rejilla`— devuelve un σ que `_cuantizar` no puede producir jamás,
y el porcionado deja de ser cerrado sobre su propio conjunto de valores.

La spec del port lo describía como una bomba latente («hoy no se ve porque todo
el catálogo usa 0,6/1,8»). **No es latente: ya está explotada.** `escalaMin`
viaja en `float32`, y 0,6 almacenado en float32 vale 0,6000000238418579 en
float64, que no es múltiplo de 0,05. El volcado de paridad del propio solver
Python lo confirma: `sigmaFueraDeRejillaAnclada0` sale a `true` en 176 de las
2.171 instancias reales, el 8 %.

**Qué hace el port.** Una sola rejilla, anclada en 0:

> los múltiplos de 0,05 contenidos en `[lo, hi]`, más `lo` y `hi`, que son
> admisibles aunque no sean múltiplos. Sin duplicados y en orden ascendente
> estricto.

`cuantizar` no cambia (ya estaba anclada en 0 y su paridad con `np.round`
bancario es exacta en el volcado). `rejilla` sí.

**Qué se observa.**

- Con `lo`/`hi` múltiplos de 0,05, el conjunto de puntos es el mismo salvo dos
  detalles sin efecto: Python duplica `hi` al final (`np.append` incondicional)
  y sus puntos interiores arrastran el error de acumular desde `lo`
  (`0,6 + 0,05·12` = 1,2000000000000002) en vez de desde 0.
- Con `lo` no múltiplo —el caso real del float32— los conjuntos difieren en
  ~2,4·10⁻⁸ punto a punto. Medido sobre los 756 casos de `pulirUna` del volcado:
  160 devuelven un σ distinto del de Python, con |Δσ| máximo de 2,4·10⁻⁸; en
  ningún caso el óptimo salta a otro punto de la rejilla. El E resultante
  empeora en 24 casos, siempre por debajo de 2·10⁻⁹.
- Con `hi ≤ lo` (cotas degeneradas o cruzadas, que serían un bug de catálogo) el
  port devuelve `[hi]`, que es el único valor que `np.clip(x, lo, hi)` puede
  producir. Python devolvía `[lo, hi]` para `hi == lo` y `[hi]` para `hi < lo`.

**Tests que la fijan.** `pruebas/porciones.test.ts`:
«la rejilla unificada está anclada en 0, es ascendente estricta y contiene ambas
cotas», «la rejilla coincide con la de Python cuando las dos cotas son múltiplos
de 0,05» y «`pulirUna` coincide con Python salvo el desplazamiento de la rejilla
anclada en 0».

---

## D2 — `resolverPorciones` no es HiGHS: descenso coordinado sobre la rejilla

**Módulo:** `src/porciones.ts` (`resolverPorcionesRejilla`).
**Ordenada por:** `docs/port-typescript.md`, «Sustitución de HiGHS».

El port minimiza la misma función objetivo del LP,
J(σ) = W·E(σ) + EPS_REG·Σ|σᵢ − σrefᵢ|, pero **directamente sobre la rejilla**,
por descenso coordinado con vecindad de pares y multiarranque determinista, en
vez de resolver el LP continuo y cuantizar después.

No es una aproximación peor: Python tampoco es óptimo sobre el conjunto que
devuelve. Medido sobre las 2.171 instancias del volcado, E_ts ≤ E_py en el
97,6 % de los casos; el peor caso a favor de Python es +7,9·10⁻⁴ sobre un umbral
de aceptación de 0,04, y ninguna instancia cambia de bucket a peor.

**Qué se observa.** σ ya no es comparable componente a componente con el de
Python, ni el vértice, ni u⁺/u⁻. El criterio de aceptación del port es
E_ts ≤ E_py + holgura y la concordancia de bucket. Lo dice la estrategia de
pruebas (nivel 1) y lo comprueba `pruebas/porciones.test.ts`.

### D2.a — El barrido de pares se ejecuta siempre, no sólo con E > 0,04

Decisión tomada **fuera de la spec**, con el número delante. La spec pedía
activar la vecindad de pares «cuando el descenso simple se estanca con
E > UMBRAL_ERROR_OK». Medido sobre el corpus completo:

| variante | p95(E_ts − E_py) | máx | E_ts ≤ E_py | coste |
|---|---|---|---|---|
| pares sólo si E > 0,04 | 0,0019 | 0,0151 | 89,9 % | 0,18 ms/inst |
| pares siempre | **0** | **0,0008** | **97,6 %** | 0,32 ms/inst |

Cortar en cuanto E ≤ 0,04 se conforma con la primera solución *aceptable* en vez
de con la mejor, y eso deja el 10 % de los días peor que Python sin necesidad.
El sobrecoste son ~100 ms por plan en un Web Worker con un corte de seguridad de
20 s: se paga.

### D2.b — `emergencia` deja de dispararse por límite de tiempo

En Python, `emergencia = true` significaba «HiGHS no devolvió `kOptimal`», y en
la práctica lo disparaba un `time_limit` acumulativo mal puesto. Aquí no hay
solver ni reloj: `porcionadoDeEmergencia` sólo se usa para R = 0 o para una `a`
no finita. El contador de la traza pierde su significado original y se sustituye
por «nº de instancias que terminaron con E > 0,12» y «nº de veces que hizo falta
el barrido de pares», como pide la spec.

---

## D3 — Tolerancias del porcionador fuera de `constantes.ts`

`TOL_PASOS_REJILLA`, `MAX_PASADAS_DESCENSO` y `MAX_RONDAS_PARES` viven en
`src/porciones.ts` y no en `constantes.ts`, que es donde manda la regla del
repositorio. Motivo operativo, no técnico: `constantes.ts` es de otro agente del
port y editarlo en paralelo es cómo se pierden ediciones. Las tres son
tolerancias numéricas del algoritmo, no parámetros de producto, y ninguna
aparece en `DISENO.md`. **Pendiente de trasladar** cuando el port se cierre.

---

## D4 — `diagnosticarPool` recibe los slots FLOJOS, no el recuento completo

**Módulo:** `src/diagnostico.ts` (`diagnosticarPool`).
**Ordenada por:** `docs/port-typescript.md`, «Divergencias conscientes» (3).
**Arreglada también en Python:** `services/solver/app/solver/motor.py:296-310`.

El sexto argumento de `diagnosticar_pool` es el dict de slots por debajo de
`min_por_slot`. `motor.py` lo llamaba dos veces y sólo la primera (la puerta 1
de §6.0) pasaba el dict filtrado; la segunda —la que se dispara cuando el
ensamblado deja algún día sin candidatos— pasaba `por_slot` COMPLETO. Ese dict
nunca está vacío, así que la rama de `slot_sin_candidatos` se disparaba
**siempre** por ese camino.

**Qué veía el usuario.** Con el catálogo semilla y cinco comidas, el recuento
por slot es `{desayuno: 11, almuerzo: 8, comida: 21, merienda: 9, cena: 22}` y
el mínimo semanal es 8. El diagnóstico elegía el slot con menos candidatos y
escribía «Sólo encuentro 8 recetas para el almuerzo con tus filtros, y necesito
al menos 8 para armar el plan sin repetir» — 8 ≥ 8, o sea, un mensaje que se
contradice a sí mismo y que además culpa al slot equivocado, tapando el eje que
la ablación sí sabía señalar. Con 36 recetas este camino se ve constantemente.

**Qué hace el port.** Nada especial: el contrato del argumento se respeta y se
documenta en la firma. En el punto donde ocurría el bug, `flojos` está vacío por
construcción (se ha pasado la puerta 1), así que el diagnóstico cae donde debe,
en el culpable de la ablación.

**Test que la fija.** `pruebas/diagnostico.test.ts`: «un dict de slots flojos
VACÍO no dispara la rama de slot_sin_candidatos», que comprueba las dos llamadas
sobre el mismo escenario y congela el mensaje incoherente como el resultado de
la llamada equivocada.

**Nota sobre los fixtures.** `services/solver/data/fixtures/diagnostico.json`
NO cambia al arreglar el bug: sus tres casos de `slot_sin_candidatos` entran por
la puerta 1, que siempre pasó el dict correcto. El camino roto sólo se alcanzaba
tras generar y ensamblar, y ningún caso de la batería llegaba tan lejos. Es
justamente por eso que el bug sobrevivió: no había fixture ni test que lo viera.

---

## D5 — `tres` garantiza tres sugerencias DISTINTAS

**Módulo:** `src/diagnostico.ts` (`tres`, `RELLENO_GENERICO`).
**Ordenada por:** `docs/port-typescript.md`, «Divergencias conscientes» (4).

El bucle de `_tres` deduplica, pero el `while` final que rellena hasta tres
añade **siempre la misma frase**. Cuando el diagnóstico tiene una sola
sugerencia cuantificada, el usuario ve dos botones idénticos.

**No es hipotético.** `diagnosticar_objetivo` con dos slots, sin plan alcanzado
y por la rama genérica devuelve hoy en Python:

```
["Elegir otras comidas del día (+11 recetas)",
 "Escríbenos y ampliamos el catálogo con lo que te falta.",
 "Escríbenos y ampliamos el catálogo con lo que te falta."]
```

`test_siempre_exactamente_tres_sugerencias` exige `len(set(...)) == 3` y pasa
sólo porque ninguno de sus tres casos llega a necesitar dos rellenos.

**Qué hace el port.** Tres rellenos genéricos distintos, en orden de uso:

1. «Escríbenos y ampliamos el catálogo con lo que te falta.» (la de Python)
2. «Quitar un filtro cada vez y volver a pedir plan, para ver cuál aprieta»
3. «Empezar con un plan de menos días y ampliarlo después»

Tres es exactamente lo que hace falta y no una elección estética: si `salida` ya
tiene *k* elementos, como mucho *k* de los rellenos colisionan con ellos, así que
siempre quedan al menos 3 − *k* disponibles. La longitud está congelada por el
tipo (`readonly [string, string, string]`).

Los dos rellenos nuevos están escritos bajo las mismas dos reglas que el resto:
no nombran ningún alérgeno y no prometen ningún número, porque a esas alturas del
diagnóstico no queda ninguno que sea cierto.

**Tests que la fijan.** `pruebas/diagnostico.test.ts`: «siempre exactamente tres
sugerencias, y las tres distintas» (batería de ~120 fallos) y «las tres
sugerencias son distintas incluso cuando no hay nada que sugerir».

---

## D6 — Ninguna sugerencia cita una cifra de kcal por debajo del suelo de seguridad

**Módulo:** `src/diagnostico.ts` (`diagnosticarObjetivo`, rama
`kcal_insuficientes_para_slots`).
**Decisión tomada FUERA de la spec**, con el número delante. No arreglada en
Python: es una decisión de producto y merece que alguien la confirme.

Spec §11.3 dice que el producto no propone jamás bajar de
`KCAL_MINIMAS_ABSOLUTO` (1.200). Python lo cumple en las dos sugerencias que
fijan un objetivo (`_kcal_segura` las clampa) y **no** en la primera sugerencia
de la rama `kcal_insuficientes_para_slots`, que cita el suelo del pool sin
filtrar:

```
Quitar el almuerzo: el mínimo baja a 571 kcal
```

Es reproducible de extremo a extremo con el escenario exacto de
`test_cinco_comidas_pocas_kcal` (5 comidas, 400 kcal). El test de seguridad
`test_nunca_sugiere_bajar_de_kcal_minimas` no lo detecta porque su objetivo
—que deja los macros por defecto— lo intercepta antes `macros_incompatibles`, y
la comprobación nunca llega a esta rama.

Se puede discutir que 571 es un hecho sobre el catálogo y no un objetivo. Pero
es un botón, y pulsarlo orienta al usuario hacia un día de 571 kcal. La regla no
distingue, y en un producto de nutrición el coste de equivocarse aquí no es
simétrico.

**Qué hace el port.** Se cuantifica igual que Python cuando el suelo que
quedaría es seguro; cuando no lo es, la sugerencia dice lo que sí es cierto sin
citar la cifra:

```
Quitar el almuerzo: es la comida que menos calorías aporta
```

La otra sugerencia de la rama ya lleva el objetivo seguro («Subir a 1200 kcal al
día»), así que el usuario no se queda sin una salida cuantificada.

**Test que la fija.** `pruebas/diagnostico.test.ts`: «nunca sugiere bajar de las
kcal mínimas», que recorre la batería completa en vez de un solo escenario —es
el cambio de forma del test lo que destapó el caso—, y «cinco comidas para muy
pocas kcal culpan al reparto, no a la proteína», que congela el texto nuevo.

---

## D7 — Números del diagnóstico fuera de `constantes.ts`

Misma excepción operativa que D3, y por el mismo motivo: `constantes.ts` es de
otro agente del port. Los diez números de `src/diagnostico.ts`
(`PASO_KCAL_SUGERENCIA`, `MINUTOS_EXTRA_SUGERENCIA`, los tres factores de
Atwater, `EPS_KCAL_RECETA`, `EPS_DENSIDAD`, `FACTOR_MAX_SUBIDA_KCAL`,
`MARGEN_SODIO_INALCANZABLE`, `PASO_SODIO_SUGERENCIA`,
`TOLERANCIA_MINIMA_SUGERIDA` y `PUNTOS_EXTRA_TOLERANCIA`) viven en un bloque
nombrado y comentado en la cabecera del módulo. En Python están sueltos e
inline dentro de `diagnostico.py`, que es el problema que la regla quiere
evitar. **Pendiente de trasladar** cuando el port se cierre.

---

## D8 — Números del orquestador fuera de `constantes.ts`

Misma excepción operativa que D3 y D7, y por el mismo motivo: `constantes.ts` es
de otro agente del port y editarlo en paralelo es cómo se pierden ediciones. Los
siete números de `src/motor.ts` (`KCAL_MINIMAS_SOLICITUD`,
`KCAL_MAXIMAS_SOLICITUD`, `PROTEINA_MINIMA_SOLICITUD_G`,
`PROTEINA_MAXIMA_SOLICITUD_G`, `DECIMALES_TOTALES`, `DECIMALES_RACION`,
`DECIMALES_ERROR_TRAZA` y `MS_POR_DIA`) viven en un bloque nombrado y comentado
en la cabecera del módulo. Los cuatro primeros no vienen de Python sino del
saneado que hoy hace `apps/web/src/app/api/plan/route.ts:52-58`: son límites de
producto, no defensa contra ataques, y al desaparecer el servidor de Pages
desaparecerían con él si no viajaran aquí. **Pendiente de trasladar** cuando el
port se cierre.

---

## D9 — El orquestador ordena los slots de la petición antes de usarlos

`generar` reordena `restricciones.slots` al orden canónico de `SLOTS` (sin
deduplicar) y pasa esa copia a todo lo que viene detrás. Python usa la lista tal
y como llega.

**Por qué.** `ordenDeSlots` deriva el orden de SELECCIÓN de la cuota, así que la
etapa A ya era indiferente al orden de la petición; pero `cuotasDe` normaliza
dividiendo por `Σ PESO_SLOT[s]` sumado **en el orden de la lista**, y la suma en
coma flotante no es asociativa. Con los cinco slots, al derecho y al revés, el
total difiere en 2 ULP (1,0499999999999998 frente a 1,0500000000000000), cada
cuota difiere en 1 ULP, `sigmaSugerido` hereda la diferencia y el descenso
coordinado aterriza en OTRO óptimo de la rejilla: mismo E, mismas recetas,
σ distintos. Medido: `almuerzo` 0,60 → 0,65 y `cena` 0,95 → 1,00 con el mismo
seed. Es decir, dos peticiones equivalentes daban planes distintos, que es
exactamente lo que la promesa de reproducibilidad dice que no pasa
(port-typescript.md, Nivel 3: «el orden de los slots en la petición no altera el
plan»).

Python tiene el mismo agujero (`sum(PESO_SLOT[s] for s in slots)`) y nunca se
notó porque el cliente siempre manda los slots en orden cronológico. Por eso, y
esto importa: para cualquier petición en orden cronológico —todas las reales y
todos los fixtures— el plan es **idéntico** con y sin esta divergencia. Sólo
cambia lo que antes estaba mal definido.

Se cierra en la frontera (`motor.ts`) y no en `cuotasDe` por dos razones: es el
único sitio por el que entra la lista del usuario, y `cuotasDe` es una función
pura que el arnés de paridad compara contra el volcado de Python entrada a
entrada. Y no deduplica: `cuotasDe` cuenta cada aparición, y quitar duplicados
cambiaría planes por la puerta de atrás.

**Test que la fija.** `pruebas/motor.test.ts`: «el orden de los slots en la
petición no altera el plan», que pide los cinco slots al derecho y al revés con
el mismo seed y exige la misma huella.
