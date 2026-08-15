# Qué plan se puede volver a construir, y cuál no

Un plan de PlanEat es el resultado de un proceso con aleatoriedad: la etapa A
muestrea recetas de una distribución softmax y la etapa D recorre el espacio de
combinaciones con recocido simulado. Sin una promesa explícita de
reproducibilidad, un usuario que dice «ayer me salió un plan mejor» no tiene
nada que enseñar, y un bug reportado desde soporte no se puede depurar.

Este documento dice exactamente qué se promete. Es la referencia cuando alguien
pregunte «¿por qué no me sale el mismo plan?».

## La promesa

> **Mismo `seed` + mismo `versionCatalogo` + misma `versionGenerador` + mismo
> motor JavaScript → el mismo plan, byte a byte del JSON de respuesta.**

Los tres primeros datos viajan **dentro** de `RespuestaOk`, no en cabeceras.
En el solver Python iban en `X-PlanEat-Seed`, `X-PlanEat-Catalogo` y
`X-PlanEat-Generador`, pero en un sitio estático no hay respuesta HTTP que
leer: el motor corre en el navegador y devuelve un objeto. Sin los tres, un
plan guardado es irreproducible.

La semilla viaja además en la query de `/plan`, y por eso un enlace es
compartible: quien lo abra ve el mismo día, con las mismas recetas y las mismas
raciones.

Está verificado con un test que ejecuta la misma solicitud **200 veces** y exige
JSON idéntico. Se excluye `msTranscurridos`, que mide reloj de pared y varía por
definición; el `test_determinismo.py` del solver Python hace lo mismo.

## Lo que NO se promete

### 1. Que un plan del Python se reproduzca en el navegador, ni al revés

Es la limitación importante y es **deliberada**. El motor portado sustituye dos
piezas que no existen en un navegador, y ninguna de las dos sustituciones puede
ser idéntica:

- **El árbol de aleatoriedad.** Python usa `numpy.random.SeedSequence` con
  `spawn_key` sobre `PCG64`. Reproducirlo exigiría reimplementar cuatro
  algoritmos no documentados —la mezcla de entropía de `SeedSequence`, `PCG64`,
  el muestreo de Lemire con rechazo, y el buffer de media palabra de 32 bits del
  generador—. El port usa SplitMix64 + xoshiro256++ con la **misma estructura de
  rutas**, que es lo que de verdad importa: nodos distintos dan flujos
  independientes, y el flujo de un nodo no depende de cuántos números consuman
  los demás.
- **El porcionador.** Python resuelve el LP continuo con HiGHS y luego cuantiza
  a la rejilla de 0,05. El port optimiza directamente sobre la rejilla. Son dos
  heurísticas distintas sobre el mismo conjunto finito.

Y aunque se replicaran ambas, los planes seguirían divergiendo: `Math.exp` y
`Math.acos` de V8 no están obligados a coincidir a 1 ULP con la libm de CPython,
y una diferencia de 1 ULP voltea la comparación `random() < exp(-Δ/t)` del
recocido o el orden del top-K. A partir de ahí el plan es otro.

Por eso `VERSION_GENERADOR` sube a `2.0.0-ts`: es un salto de mayor, no de
parche. Un plan con `versionGenerador: "1.0.0"` sólo se puede reconstruir con el
solver Python.

**Consecuencia práctica:** los golden tests del port se **regeneran** contra la
implementación TypeScript. No se traducen los de Python. Cualquier test del tipo
«el mismo plan que Python» es incorrecto por construcción y se rechaza.

Lo que sí se compara entre los dos motores está en el README y en la batería de
`pruebas/porciones.test.ts`: las funciones portadas literalmente, bit a bit; el
porcionador, por calidad de la solución. Eso es lo que garantiza que los dos
motores siguen implementando el mismo algoritmo aunque den planes distintos.

### 2. Que dos motores JavaScript distintos den el mismo plan

Por la misma razón: `Math.exp` y `Math.acos` no están especificados a 1 ULP en
ECMAScript, así que V8 y SpiderMonkey pueden diferir en el último bit. Dentro de
un mismo motor el resultado es estable, y ese es el caso real de un usuario que
recarga su enlace.

Si alguna vez hiciera falta reproducibilidad entre navegadores, la salida es
implementar `exp` y `acos` propias en punto fijo, no ajustar tolerancias.

### 3. Que el plan sobreviva a un cambio de catálogo

`versionCatalogo` son los 16 primeros caracteres del sha256 del fichero fuente.
Añadir una receta cambia la versión, cambia el pool, y el mismo seed da otro
plan. Es correcto: el plan es una función del catálogo, no sólo de la semilla.

Por eso `cargarCatalogo` **lanza** si el vocabulario del catálogo compilado no
coincide con el de `constantes.ts`. Un catálogo con las columnas en otro orden no
daría un error: daría planes con los alérgenos equivocados.

## La semilla es de 63 bits, y eso importa

No cabe en un `Number` de JavaScript (2^53−1). Un round-trip por JSON, por la
query de la URL o por un `parseInt` perdería precisión **en silencio**, y el plan
dejaría de ser reproducible sin que nada fallara — exactamente el bug que toda
esta disciplina intenta evitar, y ahora sin backend donde depurarlo.

Por eso:

- Internamente es `bigint`.
- En el contrato, en la query y en `localStorage` es una **cadena decimal**.
- `semillaDesdeTexto` lanza si el texto no es un entero decimal en [0, 2^63).
- Hay un test de round-trip `seed → JSON → URL → seed → mismo plan`.

**Nunca tipes `seed` como `number`** en ningún punto del monorepo.

## Si cambias una constante

`src/constantes.ts` lo dice y se repite aquí porque es la regla que más fácil se
olvida: **cambiar cualquier constante del motor obliga a subir
`VERSION_GENERADOR`**. Sin eso, un plan guardado deja de ser reproducible y el
bug es indepurable en soporte — el plan y el código dicen ser la misma versión y
no lo son.

Lo mismo vale para reordenar cualquiera de las cuatro tuplas de vocabulario, que
además obliga a recompilar el catálogo.
