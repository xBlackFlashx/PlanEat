# Diseño de implementación del solver

> Documento de ingeniería. Convierte la arquitectura de `docs/spec.md` §6 en un
> diseño ejecutable: cada decisión que el pseudocódigo dejaba abierta está
> resuelta aquí con un número concreto y su justificación.
>
> **Ámbito:** `services/solver/`. El contrato HTTP (`app/schemas.py`) y el
> contrato TypeScript (`packages/shared/src/types.ts`) son la fuente de verdad y
> **no se modifican** salvo en los tres puntos marcados como
> `[CONTRATO — propuesta]`, que se implementan sin romper nada.
>
> **Qué NO cubre:** ingesta de datos nutricionales (§7 de la spec), UI, y la
> capa de persistencia. El solver es una función pura sobre catálogo + petición.
>
> **Estado de verificación:** las afirmaciones numéricas de este documento se han
> contrastado contra el entorno real (highspy 1.15.1, NumPy 2.5.2, el catálogo
> del repositorio). El detalle de qué se midió, qué salió y qué sigue siendo una
> estimación está en **§9**. Una de las comprobaciones destapó un fallo de diseño
> —el umbral de pool— que está corregido en §6.0.

---

## 0. Resumen ejecutable

| Etapa | Qué hace | Técnica | Coste (P=1.500) |
|---|---|---|---|
| 0 | Pool de candidatos | Máscaras booleanas + caché de dos niveles | ~8 ms (fallo) / 0,05 ms (acierto) |
| A | Selección por slot | Score vectorizado + softmax sobre z-scores en top-k | **50 µs / slot** ✔ |
| B | Porcionado | LP de goal programming L1 con banda muerta, HiGHS | **64 µs / LP** ✔ |
| C | Reparación | Sustitución del slot más culpable, ≤3 intentos | ×3 sobre A+B |
| D | Ensamblado semanal | Recocido simulado con conteo incremental de ingredientes | ~12 ms |
| — | Diagnóstico de fallo | Ablación *leave-one-out* + cotas de alcanzabilidad | ~2 ms |

Los valores marcados ✔ están **medidos** en este entorno (§9); el resto son
estimaciones a confirmar con el banco de pruebas de §7.4. Con los números
medidos y el desglose de §7.1, una semana completa sale en **≈ 73 ms** y un día
en **≈ 12 ms**, un solo hilo. El objetivo de la tarea (<2 s para un día) queda
con ~170× de margen, lo que permite no paralelizar nada (§7.3).

### Ficheros

```
services/solver/app/
  solver/__init__.py  TODOS los pesos y umbrales de este documento  [YA EXISTE]
  catalogo.py         Carga y precálculo del catálogo (§1)          [YA EXISTE]
  solver/pool.py         Etapa 0: filtros duros y caché
  solver/scoring.py      Etapa A: score vectorizado y muestreo
  solver/porcionado.py   Etapa B: LP con HiGHS
  solver/reparacion.py   Etapa C
  solver/semanal.py      Etapa D
  solver/diagnostico.py  §6: por qué no hay solución
  solver/generador.py    Orquestación: SolicitudGeneracion -> RespuestaGeneracion
```

Regla dura de implementación: **ningún número mágico fuera de
`app/solver/__init__.py`**. Cada constante lleva como comentario la sección de
este documento que la justifica. (Ese módulo hace de `constantes.py`; no importa
a ninguno de sus submódulos, así que no hay ciclo.)

---

## 1. Estructuras de datos

### 1.1 Qué se precalcula al cargar el catálogo

El catálogo se carga **una vez por proceso**, al arranque, y vive en memoria.
La generación nunca toca disco ni base de datos (spec §6.5, punto 2).

Fuente en MVP: `services/solver/data/catalogo.jsonl`, una receta por línea, con
los campos denormalizados de la spec §5.2. Se sustituirá por una consulta a
Postgres sin cambiar nada aguas abajo: `catalogo.py` expone
`cargar_catalogo(ruta) -> Catalogo` y el resto del código solo conoce `Catalogo`.

`catalogo_version = sha256(fichero)[:16]`. Entra en toda clave de caché y se
devuelve en la cabecera `X-PlanEat-Catalogo`. Sin esto, una recarga en caliente
del catálogo produce planes distintos con el mismo seed y el bug es indepurable.

Sea `N` el número de recetas publicadas y `M` el número de alimentos distintos
que aparecen en el catálogo. Todos los arrays están **alineados por índice de
fila**: la fila `i` es siempre la misma receta.

```python
@dataclass(frozen=True, slots=True)
class Catalogo:
    version: str                    # sha256 truncado
    ids: np.ndarray                 # (N,)   dtype=object, str  — recetaId
    idx_por_id: dict[str, int]      #        índice inverso
    titulos: np.ndarray             # (N,)   dtype=object

    # --- Nutrición por ración base (racionesBase = 1 ración de la receta) ---
    nutr: np.ndarray                # (N, 6) float32
    # Orden de columnas, FIJO en todo el servicio (app.solver.IDX_NUTRIENTE):
    #   0 kcal · 1 proteinaG · 2 carbohidratoG · 3 grasaG · 4 fibraG · 5 sodioMg
    conocido: np.ndarray            # (N, 6) bool — ¿el dato existe de verdad?

    # --- Composición macro normalizada (el término que decide la selección) ---
    v_macro: np.ndarray             # (N, 3) float32, norma L2 = 1
    tiene_macro: np.ndarray         # (N,)   bool — False si kcal_macro == 0

    # --- Escalado ---
    escala_min: np.ndarray          # (N,) float32, por defecto 0.6
    escala_max: np.ndarray          # (N,) float32, por defecto 1.8

    # --- Filtros duros (máscaras booleanas, no listas) ---
    m_dieta: np.ndarray             # (N, 6)  bool — orden de TipoDieta
    m_alergeno: np.ndarray          # (N, 14) bool — orden de Alergeno
    m_slot: np.ndarray              # (N, 5)  bool — orden de SlotComida
    minutos: np.ndarray             # (N,) int16 — prep + cocción

    # --- Ingredientes como bitsets (§1.3) ---
    ingr_bits: np.ndarray           # (N, W) uint64, W = ceil(M/64)
    ingr_perec_bits: np.ndarray     # (N, W) uint64 — solo perecederos
    n_ingredientes: np.ndarray      # (N,) int16 — popcount precalculado
    alimento_idx: dict[str, int]    # alimentoId -> bit
    alimento_id: list[str]          # bit -> alimentoId

    # --- Coste ---
    coste_cents: np.ndarray         # (N,) int32, por ración
    coste_conocido: np.ndarray      # (N,) bool
```

**Cálculo de `v_macro`.** Es el corazón de la etapa A y hay que ser exacto:

$$
k^{\text{macro}}_r = 4P_r + 4C_r + 9G_r, \qquad
\mathbf{f}_r = \frac{1}{k^{\text{macro}}_r}\,(4P_r,\; 4C_r,\; 9G_r), \qquad
\mathbf{v}_r = \frac{\mathbf{f}_r}{\lVert \mathbf{f}_r \rVert_2}
$$

Se usa la kcal derivada de Atwater, **no** la kcal declarada del panel. Motivo:
si el panel declara 320 kcal y los macros suman 298, la fracción calórica
calculada con 320 no suma 1 y el coseno se sesga. La kcal declarada se sigue
usando en todo lo demás (residuo, LP, totales); la derivada solo normaliza el
vector de composición. Si $k^{\text{macro}}_r = 0$ (café solo, infusión),
`tiene_macro[i] = False` y esa receta recibe un `fit` neutro (§2.2a).

**Nada de esto se recalcula por petición.** Coste de arranque estimado: ~1,2 s
para N = 5.000. Memoria: `nutr` 120 KB + `v_macro` 60 KB + bitsets
5.000 × 10 × 8 B = 400 KB + máscaras 125 KB ≈ **0,8 MB**. Irrelevante.

### 1.2 Qué se calcula por petición

| Dato | Forma | Coste |
|---|---|---|
| `idx_pool` | `(P,) int32` — filas del catálogo que pasan los filtros duros | 8 ms (fallo de caché) |
| Vistas compactas del pool | `nutr_p (P,6)`, `v_macro_p (P,3)`, `bits_p (P,W)`, … | copia de ~90 KB, 40 µs |
| `bits_despensa` | `(W,) uint64` | 20 µs |
| `pen_repeticion` | `(P,) float32` a partir de `recetasRecientes` | 30 µs |
| `bits_semana` | `(W,) uint64` acumulador de la etapa D | incremental |

Se materializan vistas compactas del pool en lugar de indexar el catálogo
completo en cada slot: `nutr[idx_pool]` copia 90 KB una vez y luego cada slot
hace productos matriz-vector contiguos. Indexar con *fancy indexing* en cada
slot cuesta 5 veces más y rompe la localidad de caché.

### 1.3 Bitsets de ingredientes

Los tres términos que producen listas de la compra cortas (despensa, solape
semanal, ingredientes únicos) son operaciones de conjuntos sobre ~600 alimentos.
Con `set` de Python cuestan milisegundos; con bitsets `uint64` y
`np.bitwise_count` (disponible desde NumPy 2.0, y el proyecto ya exige
`numpy>=2.1`) cuestan microsegundos y se vectorizan sobre todo el pool:

```python
# Ingredientes de cada receta del pool que YA están comprometidos esta semana
inter = np.bitwise_count(bits_p & bits_semana).sum(axis=1)   # (P,) int
cobertura = inter / np.maximum(1, n_ingr_p)                  # (P,) float
```

No se usa `scipy.sparse`: scipy no es dependencia del proyecto y para
`M ≈ 600` los bitsets son más rápidos y no añaden superficie.

### 1.4 Caché de dos niveles

El pseudocódigo de la spec cachea el pool por hash de todas las restricciones.
Eso tiene un problema real: `ingredientesExcluidos` es de altísima cardinalidad
(cada usuario tiene su lista) y hunde la tasa de aciertos. Solución:

- **Nivel 1 — caché.** Clave: `(catalogo_version, dieta, alergenos_ordenados,
  minutos_max_global)`. Baja cardinalidad: la mayoría de usuarios comparten
  configuración. `LRU(256)`, TTL 3600 s, invalidación por recarga de catálogo.
  Devuelve `idx_pool_base` y sus vistas compactas.
- **Nivel 2 — por petición, sin cachear.** Máscara de
  `ingredientesExcluidos` (un `bitwise_count(bits & bits_excluidos) == 0`
  sobre P filas: ~50 µs) y máscara de `minutosMaxPorSlot`.

**`minutosMaxPorSlot` es por slot, no global.** Va en el nivel 2 aplicado dentro
de la etapa A, no en el filtro del pool. En el nivel 1 se usa
`max(minutosMaxPorSlot.values())` como cota superior laxa, que solo poda lo que
ningún slot admitiría. Confundir esto es el bug clásico: filtrar el pool entero
por el límite del desayuno y quedarse sin cenas.

La caché es un `dict` de proceso con bloqueo. Nada de Redis en MVP: el pool es
un objeto NumPy y serializarlo cuesta más que recalcularlo.

---

## 2. Etapa A — Selección estocástica

### 2.1 Reparto calórico por slot

El contrato solo trae `slots: SlotComida[]`. La cuota calórica se deriva de una
tabla fija, renormalizada al subconjunto pedido:

```python
PESO_SLOT = {"desayuno": 0.22, "almuerzo": 0.10, "comida": 0.35,
             "merienda": 0.10, "cena": 0.28}
cuota[s] = PESO_SLOT[s] / sum(PESO_SLOT[t] for t in slots_pedidos)
```

Estos pesos son una convención de producto (patrón de comidas mediterráneo, con
la comida como ingesta principal), no un dato nutricional. Solo influyen en el
orden de selección y en el término `escala`; el cuadre real de macros lo hace el
LP a nivel de día, así que un reparto imperfecto no degrada la precisión.

**Orden de recorrido:** slots por cuota descendente, desempatando por el orden
canónico de `SlotComida`. Determinista y además correcto: los slots grandes
consumen la mayor parte del presupuesto nutricional y deben elegir primero.

### 2.2 Función de score

Para el slot $s$ con residuo $\mathbf{d}$ (lo que falta del día tras los slots ya
resueltos), cada receta $r$ del pool admisible recibe:

$$
S(r,s) = 4{,}0\,\phi_{\text{fit}} + 2{,}0\,\phi_{\text{esc}}
       + 1{,}5\,\phi_{\text{desp}} + 1{,}2\,\phi_{\text{sol}}
       + 0{,}8\,\phi_{\text{afin}}
       - 1{,}5\,\phi_{\text{cost}} - 2{,}0\,\phi_{\text{rep}}
$$

Los pesos son los de la spec §6.4. **Todos los términos $\phi$ están
normalizados a $[0,1]$**, lo que la spec dejaba abierto y es la diferencia entre
un score interpretable y uno donde un término domina por accidente de escala.
Rango de $S$: $[-3{,}5,\; 9{,}5]$.

**(a) Encaje composicional $\phi_{\text{fit}}$.**

$$
c_r = \frac{\mathbf{v}_r \cdot \mathbf{v}_{\mathbf{d}}}{\lVert\mathbf{v}_r\rVert \lVert\mathbf{v}_{\mathbf{d}}\rVert},
\qquad
\phi_{\text{fit}} = 1 - \frac{2}{\pi}\arccos\big(\mathrm{clip}(c_r, -1, 1)\big)
$$

donde $\mathbf{v}_{\mathbf{d}}$ es el vector de fracciones calóricas del residuo,
normalizado igual que en §1.1.

**Por qué distancia angular y no el coseno crudo.** Los dos vectores viven en el
octante no negativo de $\mathbb{R}^3$ y sus componentes suman ~1 antes de
normalizar, así que el coseno se comprime contra 1 y casi no discrimina.

Medido sobre el catálogo real (36 recetas, objetivo 30/40/30 % de kcal, §9):

| | mín | p05 | mediana | máx | desv. típica |
|---|---|---|---|---|---|
| $c_r$ (coseno) | 0,769 | 0,782 | **0,946** | 0,996 | 0,064 |
| $\phi_{\text{fit}}$ (angular) | 0,559 | 0,572 | **0,789** | 0,941 | **0,106** |

La transformación angular **multiplica la dispersión por 1,66×** y descomprime
la mediana del 0,95 al 0,79. Como el softmax de §2.4 estandariza por la
desviación típica, ese factor no cambia las probabilidades por sí solo — lo que
cambia es la *forma*: `arccos` es aproximadamente lineal justo donde el coseno
es plano, así que las diferencias entre las recetas del top-k dejan de estar
aplastadas en el tercer decimal y el ordenamiento deja de depender del ruido de
`float32`. Coste: una `arccos` sobre P elementos, ~20 µs.

Si `tiene_macro[r]` es falso, $\phi_{\text{fit}} = 0{,}5$ (neutro): una infusión
no encaja ni desencaja composicionalmente. Si el residuo tiene todos los macros
≤ 0 (día ya cubierto), $\phi_{\text{fit}} = 0{,}5$ para todos y decide el resto.

**(b) Encaje de escala $\phi_{\text{esc}}$.** ¿El factor de ración necesario cae
dentro de las cotas de la receta?

$$
\eta_r = \frac{d_{\text{kcal}}\cdot \text{cuota}_s}{k_r},
\qquad
\phi_{\text{esc}} =
\begin{cases}
1 & \ell_r \le \eta_r \le u_r\\[4pt]
\eta_r/\ell_r & \eta_r < \ell_r\\[4pt]
u_r/\eta_r & \eta_r > u_r
\end{cases}
$$

Se cambia deliberadamente la fórmula de la spec (`1 - |clamp - needed|`), que
mezcla unidades: restar factores de ración da un número sin escala común y
penaliza brutalmente a las recetas de pocas calorías. El **cociente** es
invariante a escala, cae siempre en $(0,1]$ y penaliza igual "necesito la mitad"
que "necesito el doble", que es la simetría correcta.

**(c) Despensa $\phi_{\text{desp}}$.**

$$
\phi_{\text{desp}} = \frac{|\,I_r \cap \Pi\,|}{\max(1, |I_r|)}
$$

El contrato solo trae `despensaAlimentoIds` (ids, sin cantidad ni caducidad),
así que la ponderación por urgencia de la spec **no es computable hoy**: no se
inventa. Queda como gancho: cuando `despensa` traiga `expiresOn`, se sustituye
el numerador por $\sum_{i \in I_r \cap \Pi} \mathrm{urg}(i)$ con
$\mathrm{urg}(i) = \mathrm{clip}(1 - \text{dias\_a\_caducar}/7,\; 0{,}2,\; 1)$.

**(d) Solape con la semana $\phi_{\text{sol}}$.**

$$
\phi_{\text{sol}} = \frac{|\,I_r \cap I_{\text{semana}}\,|}{\max(1,|I_r|)}
$$

Se descarta el Jaccard de la spec. Jaccard divide por la unión, que crece con
los días ya planificados: el mismo solape puntúa cada vez menos y hacia el
viernes el término se apaga solo. La **cobertura** ("qué fracción de esta receta
ya está comprada") mide exactamente lo que queremos maximizar: recetas que no
añaden líneas nuevas a la lista. Es 0 el primer día y no distorsiona.

**(e) Coste $\phi_{\text{cost}}$.**

$$
b = \frac{B}{D \cdot |S| \cdot n_{\text{comensales}}}, \qquad
\phi_{\text{cost}} = \mathrm{clip}\!\left(\frac{\max(0,\; c_r - b)}{b},\; 0,\; 1\right)
$$

Si `presupuestoSemanalCents` es `None`, o si más del 20 % del pool tiene
`coste_conocido = False`, **el término se desactiva** (peso 0) y se registra en
la traza. Puntuar con precios inventados es peor que no puntuar.

**(f) Repetición $\phi_{\text{rep}}$.** `recetasRecientes` es una lista de ids
sin fecha. Se define por contrato que **viene ordenada de más reciente a más
antigua** (hay que documentarlo en `types.ts`; es una nota, no un cambio de
tipo). Con $|S|$ slots por día, la posición $p_r$ estima los días transcurridos:

$$
\phi_{\text{rep}} = 0{,}85^{\,\lfloor p_r / |S| \rfloor}
$$

Fuera de la lista, $\phi_{\text{rep}} = 0$. Decaimiento 0,85/día ≈ 3 % de
penalización residual a 21 días, que es la ventana de la spec.

**(g) Afinidad $\phi_{\text{afin}}$.** No existe en el contrato (`food_preference`
es v1). **Peso efectivo 0 en MVP.** Se deja el término en el código con su peso
en `app/solver/__init__.py` para que activarlo sea una línea.

### 2.3 Cálculo vectorizado

Todo el score es un puñado de operaciones sobre arrays `(P,)`. Nada de bucles
sobre recetas:

```python
def score_slot(pool, slot, residuo, ctx) -> np.ndarray:      # -> (P,) float32
    admisible = pool.m_slot[:, IDX_SLOT[slot]]
    admisible &= pool.minutos <= ctx.minutos_max(slot)        # límite POR slot
    admisible &= ~ctx.ya_elegidas_hoy                         # sin repetir en el día

    cos = pool.v_macro @ v_residuo                            # (P,) — 1 matvec
    fit = 1.0 - (2.0 / np.pi) * np.arccos(np.clip(cos, -1.0, 1.0))
    fit = np.where(pool.tiene_macro, fit, 0.5)

    eta = (residuo[KCAL] * slot.cuota) / pool.nutr[:, KCAL]
    esc = np.where(eta < pool.escala_min, eta / pool.escala_min,
          np.where(eta > pool.escala_max, pool.escala_max / eta, 1.0))
    ...
    s = (W_FIT*fit + W_ESC*esc + W_DESP*desp + W_SOL*sol
         + W_AFIN*afin - W_COST*cost - W_REP*rep)
    return np.where(admisible, s, -np.inf)
```

Coste medido a ojo para P = 1.500: ~150 µs por slot. En bucle Python serían
~40 ms (spec §6.5, punto 3).

### 2.4 Muestreo: softmax con temperatura sobre z-scores del top-k

Tres decisiones, y las tres importan:

**1. Top-k con k = 25.** Recorta la cola larga de recetas que solo aportan ruido
y hace el coste del softmax independiente de P. Se implementa con
`np.argpartition(-s, k)` seguido de un **orden estable por `(-score, id)`**. El
orden explícito es obligatorio: `argpartition` no garantiza el orden de los
empates y sin desempate por id el mismo seed produce planes distintos entre
versiones de NumPy. Es el fallo de reproducibilidad más fácil de introducir.

**2. Estandarización antes del softmax.** Sobre el top-k:

$$
z_j = \frac{S_j - \bar{S}}{\max(\mathrm{sd}(S),\ 10^{-3})},
\qquad
p_j = \frac{e^{z_j/\tau}}{\sum_{l} e^{z_l/\tau}}
$$

Sin estandarizar, la dispersión de $S$ cambia con el residuo y con el tamaño del
pool, así que la misma $\tau$ significa "casi determinista" en un slot y "casi
uniforme" en otro. Estandarizando, **$\tau$ tiene un significado estable** y se
puede exponer al usuario como el control de "variedad" que la spec §6.3 pide.
Implementación: restar el máximo de $z/\tau$ antes de exponenciar (estabilidad
numérica).

**3. Mapeo del control de variedad.** Con $v \in [0,100]$:

$$
\tau(v) = 0{,}12 \cdot \left(\tfrac{1{,}5}{0{,}12}\right)^{v/100}
$$

Por defecto $v = 45 \Rightarrow \tau = 0{,}37$. Geométrico porque la percepción
de "más variado" es multiplicativa, no aditiva. $\tau \le 0{,}12$ es
prácticamente argmax; $\tau = 1{,}5$ es casi uniforme sobre el top-25.

Se descarta muestreo por rangos (Boltzmann sobre posición) porque descarta la
magnitud de la diferencia de score, y se descarta el argmax puro porque el
re-roll dejaría de funcionar (spec §6.2, punto 3).

### 2.5 Actualización del residuo

Tras elegir $r$ para el slot $s$:

$$
\mathbf{d} \leftarrow \mathbf{d} - \hat{\sigma}_r \cdot \mathbf{a}_r,
\qquad
\hat{\sigma}_r = \mathrm{clip}(\eta_r,\ \ell_r,\ u_r)
$$

La spec restaba `nutrients_per_serving` (escala 1,0). Usar $\hat{\sigma}$ es
gratis y mucho mejor: si el desayuno necesita 1,6 raciones, restar 1,0 deja un
residuo inflado y los slots siguientes se eligen contra un objetivo falso.
$\hat{\sigma}_r$ además se guarda: es el $\sigma^{\text{ref}}$ que el LP usará
como referencia de desempate (§3.3).

### 2.6 Reproducibilidad: disciplina de semillas

Regla: **nunca un único `Generator` compartido y consumido en orden.** Con un
generador secuencial, cualquier cambio en el número de llamadas (un slot más, un
reintento más, ejecución en paralelo) desplaza todo el flujo y el plan cambia.

Se usa el árbol de `SeedSequence` de NumPy, con clave estructural:

```python
def rng_de(seed: int, *ruta: int) -> np.random.Generator:
    """Generador independiente y reproducible para un punto del árbol.

    La ruta identifica el nodo: (dia, candidato_k, intento, slot). Dos nodos
    distintos nunca comparten flujo, y el flujo de un nodo no depende de
    cuántos números hayan consumido los demás. Esto es lo que hace que el
    resultado sea idéntico en serie y en paralelo.
    """
    return np.random.Generator(np.random.PCG64(
        np.random.SeedSequence(entropy=seed, spawn_key=ruta)))
```

Rutas reservadas (`app.solver.RUTA_*`): `(0, dia, k, intento, slot)` para la
etapa A, `(1,)` para el recocido de la etapa D, `(2, …)` para desempates.

**`seed` ausente.** El contrato lo permite (`seed: int | None`) pero
`RespuestaOk` no tiene dónde devolverlo, y un plan que no se puede reproducir no
se puede depurar en soporte. Resolución sin romper el contrato:

`[CONTRATO — propuesta 1]` si `seed` es `None`, el solver genera
`secrets.randbits(63)`, lo usa, y lo devuelve en la cabecera HTTP
**`X-PlanEat-Seed`**. La app web debe persistirlo junto al plan. Recomendación
para la fase 1: que la web genere siempre el seed y lo envíe, y que
`RespuestaOk` incorpore `seed` y `versionGenerador` en la siguiente revisión del
contrato.

**Otras fuentes de no-determinismo, todas cerradas explícitamente:**

| Fuente | Cierre |
|---|---|
| Orden de `set`/`dict` de Python | Prohibido iterar `set` sin `sorted()`; en el código caliente, arrays |
| `PYTHONHASHSEED` | Irrelevante si se cumple lo anterior; aun así se fija en el `Dockerfile` |
| Empates en `argpartition`/`argsort` | Orden explícito por `(-score, id)` |
| Hilos de BLAS/HiGHS | `OMP_NUM_THREADS=1`, `h.setOptionValue("threads", 1)` |
| Reducciones en paralelo (float) | Todas las sumas sobre arrays de forma fija; sin `ProcessPool` en MVP |
| Reloj / fecha | Solo entra en `DiaPlan.fecha`, nunca en decisiones |

---

## 3. Etapa B — Porcionado por programación lineal

### 3.1 El punto que la spec deja abierto: los objetivos son rangos

`ObjetivoNutricional` no da puntos, da **intervalos**: `proteinaG: {min, max}`,
`toleranciaKcal` sobre `kcal`, `fibraMinG` (solo mínimo), `sodioMaxMg` (solo
máximo). El goal programming clásico de la spec (`Σ σ a − u⁺ + u⁻ = T`) fuerza
un punto y penaliza cualquier desviación, incluida la que el producto declara
aceptable. Eso produce planes peores: el LP gasta su libertad en clavar el
centro del rango en vez de en cuadrar el resto.

**Formulación correcta: banda muerta (interval goal programming).** Para cada
nutriente $n$ se define su intervalo objetivo $[L_n, U_n]$:

| $n$ | $L_n$ | $U_n$ | $w_n^+$ (exceso) | $w_n^-$ (defecto) |
|---|---|---|---|---|
| kcal | $T(1-\text{tol})$ | $T(1+\text{tol})$ | 3,0 | 3,0 |
| proteína | `proteinaG.min` | `proteinaG.max` | 1,0 | **2,5** |
| carbohidrato | `carbohidratoG.min` | `carbohidratoG.max` | 1,0 | 1,0 |
| grasa | `grasaG.min` | `grasaG.max` | 1,0 | 1,0 |
| fibra | `fibraMinG` | $+\infty$ | — | 0,5 |
| sodio | $-\infty$ | `sodioMaxMg` | 0,3 | — |

La asimetría de la proteína (2,5 por defecto, 1,0 por exceso) es una decisión de
producto respaldada por la spec §9: pasarse de proteína no daña el objetivo del
usuario, quedarse corto sí. La spec usaba un peso simétrico de 2,5; se afina
aquí y se documenta.

### 3.2 Formulación exacta

Sea $R$ el conjunto de recetas ya seleccionadas para el día (3–5 típicamente),
$a_{n,i}$ el nutriente $n$ por ración base de la receta $i$, y $\sigma_i$ su
factor de ración.

$$
\begin{aligned}
\min_{\sigma, u^+, u^-, t}\quad
& \sum_{n \in N} \frac{w_n^+ u_n^+ + w_n^- u_n^-}{e_n}
\;+\; \varepsilon \sum_{i \in R} t_i \\[6pt]
\text{s.a.}\quad
& L_n \;\le\; \sum_{i \in R} a_{n,i}\,\sigma_i \;-\; u_n^+ \;+\; u_n^-
  \;\le\; U_n && \forall n \in N \\[4pt]
& t_i \;\ge\; \sigma_i - \sigma_i^{\text{ref}},\qquad
  t_i \;\ge\; \sigma_i^{\text{ref}} - \sigma_i && \forall i \in R \\[4pt]
& \ell_i \le \sigma_i \le u_i,\qquad u_n^+,\,u_n^-,\,t_i \ge 0
\end{aligned}
$$

**Una sola fila por nutriente.** La formulación clásica necesita dos
restricciones por nutriente para modelar una banda muerta. Aquí basta una: con
$L_n \le \sum a\sigma - u^+ + u^- \le U_n$ y costes positivos sobre $u^\pm$, el
óptimo da $u^+ = \max(0, A_n - U_n)$, $u^- = \max(0, L_n - A_n)$ y $u^+=u^-=0$
dentro de la banda. Se comprueba caso por caso; es exacto, no una aproximación.
Resultado: **6 filas de nutriente en lugar de 12**.

**Normalizador $e_n$.** $e_n = \max(\tfrac{L_n+U_n}{2},\ \epsilon)$ para los
nutrientes con banda finita; $e_n = \max(L_n, \epsilon)$ para fibra y
$e_n = \max(U_n, \epsilon)$ para sodio, con $\epsilon = 1$. Convierte gramos y
miligramos en desviaciones **relativas**, que es lo único comparable entre
nutrientes: 10 g de desviación en carbohidrato y 10 mg en sodio no son la misma
falta.

**Término regularizador $\varepsilon \sum t_i$, con $\varepsilon = 10^{-3}$.**
Éste es el detalle que la spec omite y que sin él el solver es inutilizable en
producción. El LP de goal programming es masivamente degenerado: en cuanto los
objetivos son alcanzables, **toda una cara del politopo es óptima** y HiGHS
devuelve el vértice al que llegue el símplex, no el sensato. Penalizar la
distancia L1 a $\sigma^{\text{ref}}$ (el $\hat\sigma$ que la etapa A ya
consideró sensato, §2.5) rompe el empate hacia la solución equilibrada, y con
$\varepsilon = 10^{-3}$ nunca compite con el término nutricional (cuyos
coeficientes son ~$10^{0}$).

**Verificado, y el resultado es más matizado de lo que parecía** (§9, caso 2).
Con 4 recetas nutricionalmente idénticas y todos los objetivos alcanzables:

| | $\sigma$ devuelto | ¿estable entre ejecuciones? |
|---|---|---|
| sin regularizador | `(0,60 · 0,60 · 1,00 · 1,80)` | sí, 50/50 iguales |
| con regularizador | `(1,00 · 1,00 · 1,00 · 1,00)` | sí, 200/200 iguales |

Es decir: **la patología existe y es exactamente la predicha** — media ración de
dos platos y 1,8 raciones de otro, con el mismo error nutricional cero que el
reparto equilibrado. Pero HiGHS *sí* es determinista entre ejecuciones con el
mismo build. Corrección honesta del argumento: el regularizador no está para
arreglar un no-determinismo run-to-run que no existe, sino por dos razones
reales — (1) **calidad**: el vértice arbitrario es incocinable y el usuario lo
lee como un fallo del producto; (2) **estabilidad entre versiones**: el vértice
elegido depende del pivoteo del símplex, luego una actualización de HiGHS
cambiaría todos los planes guardados sin cambiar `VERSION_GENERADOR`. Con el
regularizador el óptimo es único y no depende del solver.

**El LP es siempre factible, por construcción.** $u^+$ y $u^-$ no tienen cota
superior y $\sigma$ vive en una caja no vacía, así que siempre existe solución
admisible. Esto es una **garantía de diseño**, no una casualidad: significa que
la pregunta "¿qué hacer si el LP es infactible?" se responde con "no puede
serlo", y que la insatisfacibilidad real se manifiesta como **error residual
alto**, que es un número interpretable y accionable (§4 y §6) en vez de un
estado de excepción. Es exactamente por esto que se elige goal programming en
lugar de un LP con restricciones duras de macro.

Los únicos estados anómalos posibles son operativos y se tratan en §3.5.

### 3.3 Error reportado

El valor objetivo **no** sirve como métrica de error porque incluye el
regularizador. Se calcula aparte:

$$
E \;=\; \frac{\displaystyle\sum_{n} w_n^{\pm}\,\frac{u_n^+ + u_n^-}{e_n}}
{\displaystyle\sum_{n} w_n^{\max}}
$$

$E$ es la **desviación relativa media ponderada fuera de banda**. $E = 0$
significa "todos los nutrientes dentro de sus rangos". $E = 0{,}05$ ≈ "un 5 % de
media fuera". Umbrales:

| $E$ | Significado | Acción |
|---|---|---|
| $\le 0{,}04$ | Objetivo alcanzado | Aceptar, no reparar |
| $(0{,}04,\ 0{,}12]$ | Aceptable | Aceptar tras agotar reparaciones |
| $> 0{,}12$ | No alcanzado | Diagnóstico §6, `ok: false` |

`[CONTRATO — propuesta 2]` No hay campo de aviso en `RespuestaOk` para la banda
intermedia. **No hace falta añadirlo en MVP**: `DiaPlan` lleva a la vez
`totales` y `objetivo`, así que la web puede calcular y mostrar el delta real
sin que el solver mienta. Recomendación para la siguiente revisión:
`RespuestaOk.avisos: string[]`.

### 3.4 Traducción a HiGHS vía highspy

Se construye el modelo a bajo nivel (`HighsLp` + CSC explícito) en vez de con la
API de expresiones. Motivo: para un modelo de ~20 columnas, construir
expresiones Python cuesta más que resolver, y el orden de recorrido de las
expresiones puede variar. El CSC explícito es determinista y su construcción es
puro NumPy.

> **Verificado** contra `highspy` **1.15.1** (el instalado en
> `services/solver/.venv`), ejecutando el código de esta sección tal cual (§9).
> Existen y funcionan: `HighsLp` con `num_col_`, `num_row_`, `sense_`,
> `col_cost_`, `col_lower_`, `col_upper_`, `row_lower_`, `row_upper_`,
> `a_matrix_` (`format_`, `start_`, `index_`, `value_`); `MatrixFormat.kColwise`;
> `ObjSense.kMinimize`; `HighsModelStatus.{kOptimal, kInfeasible, kUnbounded,
> kTimeLimit, kIterationLimit}`; `Highs.getSolution().col_value`. Asignar los
> arrays NumPy directamente a los campos `col_cost_` etc. funciona sin conversión
> explícita. **El único cuidado real:** `a_matrix_.start_` e `index_` deben ser
> `int32` y `value_` `float64`; con otros dtypes la conversión de pybind11 es
> silenciosa pero costosa.

**Disposición del modelo.** Con $R$ recetas y $N$ nutrientes activos:

*Columnas* (total $2R + 2N$):

| Rango | Variable | Coste | Cota inf. | Cota sup. |
|---|---|---|---|---|
| $[0, R)$ | $\sigma_i$ | 0 | $\ell_i$ | $u_i$ |
| $[R,\ R{+}2N)$ | $u_n^+$ (par), $u_n^-$ (impar) | $w_n^\pm/e_n$ | 0 | $\infty$, o **0** si ese lado está suprimido |
| $[R{+}2N,\ 2R{+}2N)$ | $t_i$ | $\varepsilon$ | 0 | $\infty$ |

Suprimir un lado con cota superior 0 (en vez de eliminar la columna) mantiene la
disposición fija: es lo que permite reutilizar el mismo buffer entre días.

*Filas* (total $N + 2R$):

| Fila | Contenido | Cota inf. | Cota sup. |
|---|---|---|---|
| $n$ | $\sum_i a_{n,i}\sigma_i - u_n^+ + u_n^-$ | $L_n$ | $U_n$ |
| $N + 2i$ | $t_i - \sigma_i$ | $-\sigma_i^{\text{ref}}$ | $\infty$ |
| $N + 2i + 1$ | $t_i + \sigma_i$ | $\sigma_i^{\text{ref}}$ | $\infty$ |

No nulos: $N(R + 2) + 4R$. Para $R=5$, $N=6$: 62. El modelo entero cabe en la
caché L1.

```python
"""Etapa B — porcionado óptimo. Ver DISENO.md §3."""
from highspy import Highs, HighsLp, HighsModelStatus, MatrixFormat, ObjSense
import numpy as np

INF = 1.0e30          # infinito de HiGHS
EPS_REG = 1e-3        # regularizador de desempate (§3.2)


def construir_lp(a, lo, hi, sigma_ref, L, U, w_mas, w_menos, e):
    """Monta el LP en formato columna (CSC).

    a          (N, R) nutrientes por ración base de cada receta elegida
    lo, hi     (R,)   cotas del factor de ración
    sigma_ref  (R,)   factor sugerido por la etapa A, ancla del desempate
    L, U       (N,)   banda muerta por nutriente (±INF para lados abiertos)
    w_mas/menos(N,)   pesos asimétricos; 0 = ese lado no se penaliza
    e          (N,)   normalizador relativo por nutriente
    """
    n_nutr, n_rec = a.shape
    n_col = 2 * n_rec + 2 * n_nutr
    n_fil = n_nutr + 2 * n_rec

    coste = np.zeros(n_col)
    col_lo = np.zeros(n_col)
    col_hi = np.full(n_col, INF)

    coste[n_rec:n_rec + 2 * n_nutr:2] = w_mas / e     # u+
    coste[n_rec + 1:n_rec + 2 * n_nutr:2] = w_menos / e   # u-
    coste[n_rec + 2 * n_nutr:] = EPS_REG              # t
    col_lo[:n_rec], col_hi[:n_rec] = lo, hi
    # Lado suprimido (peso 0): la variable de holgura se fija en 0.
    col_hi[n_rec:n_rec + 2 * n_nutr:2][w_mas == 0] = 0.0
    col_hi[n_rec + 1:n_rec + 2 * n_nutr:2][w_menos == 0] = 0.0

    fil_lo = np.concatenate([L, np.empty(2 * n_rec)])
    fil_hi = np.concatenate([U, np.full(2 * n_rec, INF)])
    fil_lo[n_nutr::2] = -sigma_ref     # t_i - sigma_i >= -ref
    fil_lo[n_nutr + 1::2] = sigma_ref  # t_i + sigma_i >=  ref

    # --- CSC: una columna cada vez, en orden ---
    inicio, indice, valor = [0], [], []
    for i in range(n_rec):                     # sigma_i
        indice += list(range(n_nutr)) + [n_nutr + 2 * i, n_nutr + 2 * i + 1]
        valor += list(a[:, i]) + [-1.0, 1.0]
        inicio.append(len(indice))
    for n in range(n_nutr):                    # u_n+, u_n-
        indice += [n];  valor += [-1.0];  inicio.append(len(indice))
        indice += [n];  valor += [+1.0];  inicio.append(len(indice))
    for i in range(n_rec):                     # t_i
        indice += [n_nutr + 2 * i, n_nutr + 2 * i + 1]
        valor += [1.0, 1.0]
        inicio.append(len(indice))

    lp = HighsLp()
    lp.num_col_, lp.num_row_ = n_col, n_fil
    lp.sense_ = ObjSense.kMinimize
    lp.col_cost_, lp.col_lower_, lp.col_upper_ = coste, col_lo, col_hi
    lp.row_lower_, lp.row_upper_ = fil_lo, fil_hi
    lp.a_matrix_.format_ = MatrixFormat.kColwise
    lp.a_matrix_.start_ = np.asarray(inicio, dtype=np.int32)
    lp.a_matrix_.index_ = np.asarray(indice, dtype=np.int32)
    lp.a_matrix_.value_ = np.asarray(valor, dtype=np.float64)
    return lp


_h = Highs()   # se reutiliza en todo el proceso: construir Highs cuesta ~1 ms


def resolver_porciones(a, lo, hi, sigma_ref, L, U, w_mas, w_menos, e):
    """Devuelve (sigma, error_relativo_medio, desviaciones)."""
    _h.clear()
    _h.setOptionValue("output_flag", False)
    _h.setOptionValue("threads", 1)          # determinismo (§2.6)
    _h.setOptionValue("solver", "simplex")   # dual simplex: reproducible
    _h.setOptionValue("time_limit", 0.05)    # 50 ms: 100x el tiempo esperado
    _h.passModel(construir_lp(a, lo, hi, sigma_ref, L, U, w_mas, w_menos, e))
    _h.run()

    if _h.getModelStatus() != HighsModelStatus.kOptimal:
        return _porcionado_de_emergencia(a, lo, hi, L, U, w_mas, w_menos, e)

    x = np.asarray(_h.getSolution().col_value)
    n_nutr, n_rec = a.shape
    sigma = x[:n_rec]
    u_mas = x[n_rec:n_rec + 2 * n_nutr:2]
    u_menos = x[n_rec + 1:n_rec + 2 * n_nutr:2]
    error = float((w_mas * u_mas / e + w_menos * u_menos / e).sum()
                  / np.maximum(w_mas, w_menos).sum())
    return sigma, error, (u_mas, u_menos)
```

**Cuantización del factor de ración.** Un $\sigma = 1{,}2837$ no es presentable
ni cocinable. Tras el LP:

1. Cuantizar todos los $\sigma_i$ al múltiplo de $q = 0{,}05$ más cercano,
   respetando las cotas (`clip` después de redondear).
2. Recalcular los totales reales con los $\sigma$ cuantizados — **los totales
   que se devuelven son siempre los de los $\sigma$ finales**, nunca los del LP
   continuo. Mentir aquí es el bug que hace que la suma de la UI no cuadre.
3. Si la cuantización sacó las kcal de su banda, se libera la receta con mayor
   contribución calórica $j = \arg\max_i a_{\text{kcal},i}\sigma_i$ y se
   reoptimiza **solo** $\sigma_j$ con los demás fijos. Es un problema
   unidimensional lineal a trozos: el óptimo está en uno de los $\le 2N+2$
   puntos de ruptura (los $L_n, U_n$ despejados más las cotas $\ell_j, u_j$); se
   evalúan todos y se toma el mejor. Coste: ~30 µs, exacto, sin volver a HiGHS.

### 3.5 Estados anómalos de HiGHS

| Estado | Causa plausible | Respuesta |
|---|---|---|
| `kOptimal` | — | Camino normal |
| `kTimeLimit` / `kIterationLimit` | Patología numérica inesperada | Porcionado de emergencia (abajo) + log `WARN` con el modelo serializado |
| `kInfeasible` | **Bug**: cotas cruzadas ($\ell_i > u_i$) o `L_n > U_n` por un objetivo con `min > max` | Log `ERROR` + validación previa (§8) |
| `kUnbounded` | **Bug**: un peso negativo llegó al coste | Log `ERROR`, imposible con la validación |

**Porcionado de emergencia** (`_porcionado_de_emergencia`): escala uniforme
$\sigma_i = \mathrm{clip}(s^\*, \ell_i, u_i)$ con
$s^\* = T_{\text{kcal}} / \sum_i a_{\text{kcal},i}$, y $E$ calculado de la forma
habitual sobre el resultado. Nunca es óptimo, pero siempre existe y mantiene el
servicio en pie. Se instrumenta con un contador: si aparece en producción, es un
bug que hay que perseguir, no un modo de operación.

Validación previa obligatoria en `schemas.py` (`[CONTRATO — propuesta 3]`,
aditiva y sin romper nada): un `field_validator` en `Rango` que exija
`min <= max` y `min >= 0`, y otro en `ObjetivoNutricional` que exija
`kcal > 0` y `0 <= toleranciaKcal <= 0.5`. Convierte un `kInfeasible`
indepurable en un `422` claro.

---

## 4. Etapa C — Reparación

### 4.1 Detección del candidato culpable

La spec dice "la receta con mayor distancia composicional al residuo". Eso es
una heurística ciega al resultado del LP, teniendo el LP toda la información.
Criterio mejor y igual de barato: **culpar a quien empuja en la dirección
equivocada**.

Del LP se obtiene el vector de desviación con signo. Se define la "dirección de
necesidad" $g \in \mathbb{R}^N$:

$$
g_n = \frac{w_n^-\,u_n^- - w_n^+\,u_n^+}{e_n}
$$

$g_n > 0$: falta ese nutriente. $g_n < 0$: sobra. $g_n = 0$: en banda.

Culpabilidad de la receta $i$ (no bloqueada):

$$
\kappa_i = -\sum_{n} g_n \cdot \frac{a_{n,i}\,\sigma_i}{e_n}
$$

Es el producto escalar, con signo cambiado, entre lo que la receta **aporta** y
lo que al día le **falta**. $\kappa_i$ alto = esta receta aporta mucho de lo que
sobra y poco de lo que falta. Se sustituye $\arg\max_i \kappa_i$, desempatando
por índice de slot ascendente (determinista).

Nótese que el criterio es correcto también cuando el problema es la magnitud y
no la composición: si sobran kcal, $g_{\text{kcal}} < 0$ y la receta más calórica
—que ya está en su $\ell_i$— es la más culpable. Es lo que queremos.

### 4.2 Criterio de sustitución

Se sustituye **solo el slot culpable**, no el día entero (la spec reseleccionaba
todo). Razones: (a) los otros slots pueden estar bien y rehacerlos es tirar
trabajo; (b) el coste por intento baja de ~1,2 ms a ~0,3 ms; (c) la búsqueda es
monótona en el sentido práctico — se guarda siempre el mejor candidato visto, así
que un intento peor nunca empeora el resultado final.

Procedimiento del intento $k$ (con $k = 1, 2, 3$):

1. `vetadas ← vetadas ∪ {receta_culpable}` (veto local al día, no global).
2. Recalcular el residuo del slot culpable como
   $\mathbf{d}_s = \mathbf{T} - \sum_{j \ne s} \sigma_j \mathbf{a}_j$ con los
   $\sigma_j$ del LP. Este residuo es mucho mejor que el de la primera pasada:
   ya sabemos exactamente qué hueco hay que llenar.
3. Reseleccionar con `rng_de(seed, RUTA_A, dia, k_cand, k, idx_slot)` y
   temperatura $\tau_k = \tau \cdot (1 + 0{,}25k)$. Subir la temperatura en cada
   reintento amplía la exploración: si el primer intento falló, el argmax local
   no era la respuesta.
4. Resolver el LP. Guardar si $E$ mejora.
5. Cortar si $E \le 0{,}04$.

**Máximo 3 intentos.** Es el número de la spec y es defendible: cada intento
cuesta ~0,3 ms, el rendimiento no es la razón. La razón es que la tasa de mejora
cae rápido — si tres sustituciones dirigidas no bajan el error, el problema no es
la selección sino el objetivo o el catálogo, y seguir intentando solo retrasa el
diagnóstico honesto, que es la respuesta correcta. Si tras los 3 intentos
$E > 0{,}12$, el día se marca como fallido y se dispara §6.

Si el slot culpable está bloqueado (`ItemPlan.bloqueado = true`), se pasa al
siguiente $\kappa$ más alto. Si todos están bloqueados, no hay reparación
posible: se va directo a diagnóstico con culpable `items_bloqueados`.

---

## 5. Etapa D — Ensamblado semanal

### 5.1 Objetivo global

Se generan $K = 6$ candidatos por día (independientes) y se busca la combinación
$\mathbf{c} = (c_1,\dots,c_D)$ que minimiza:

$$
\mathcal{C}(\mathbf{c}) =
\underbrace{\sum_{d} E_d}_{\text{nutrición}}
+ \lambda \underbrace{\Big|\bigcup_d I(c_d)\Big|}_{\text{ingredientes únicos}}
+ \mu \underbrace{\frac{\max(0,\ \text{coste} - B)}{B}}_{\text{presupuesto}}
+ \nu \underbrace{\rho(\mathbf{c})}_{\text{repetición}}
$$

**Calibración de $\lambda$ (esto es lo que la spec no fija y decide si la
funcionalidad existe o no).** Los términos deben ser conmensurables. $E_d$ vive
en $[0,\ 0{,}12]$ y la unión de ingredientes en $[40,\ 130]$. Se fija
$\lambda = 0{,}006$ razonando desde el producto: **quitar 10 ingredientes de la
lista vale lo mismo que empeorar un día en 6 puntos porcentuales de desviación
nutricional** — es decir, casi todo el presupuesto de error de un día. Eso deja
la nutrición como término dominante (correcto: es el propósito del producto) pero
con capacidad real de mover la solución cuando hay empate nutricional, que es lo
habitual entre 6 candidatos generados con el mismo objetivo.

$\mu = 0{,}30$: rebasar el presupuesto un 20 % cuesta 0,06, equivalente a
degradar un día entero. $\nu = 0{,}05$ por repetición.

**Repetición $\rho$.** Blanda y dura a la vez:

- Blanda: $\rho(\mathbf{c}) = \sum_r \max(0,\ \text{usos}(r) - 1)$.
- Dura (movimiento rechazado, no penalizado): ninguna receta más de **2 veces
  por semana**, y ninguna receta en el **mismo slot dos días consecutivos**. Es
  la variedad que el usuario percibe; codificarla como penalización blanda deja
  que un buen término de ingredientes la compre, y eso se lee como un fallo.

Hueco previsto: el batch cooking (spec §6.6) desactivará la restricción dura
dentro de un `batchGroupId`.

### 5.2 Ingredientes únicos, incrementalmente

Recalcular la unión en cada iteración cuesta $D \times W$ operaciones. Se
mantiene en su lugar un contador:

```python
# uso[b] = cuántos días de la combinación actual usan el alimento del bit b
uso = np.zeros(M, dtype=np.int16)
n_unicos = int((uso > 0).sum())

def intercambiar(dia, viejo, nuevo):
    """Actualiza el conteo en O(|I(viejo)| + |I(nuevo)|), no en O(D·M)."""
    global n_unicos
    for b in viejo.ingredientes:          # arrays de índices, precalculados
        uso[b] -= 1
        if uso[b] == 0: n_unicos -= 1
    for b in nuevo.ingredientes:
        if uso[b] == 0: n_unicos += 1
        uso[b] += 1
```

~40 operaciones por movimiento en vez de ~500. Con 400 iteraciones la etapa D
baja de ~40 ms a ~12 ms.

### 5.3 Recocido simulado

```
combo   ← argmin por día de E_d            (arranque voraz)
mejor   ← combo ; coste_mejor ← C(combo)
T₀ = 0,05 ;  α = 0,994 ;  400 iteraciones  (T_final ≈ 0,005)

repetir 400 veces:
    d   ← rng.integers(D)                  # flujo (1,) — un único generador
    alt ← rng.integers(K)
    si el movimiento viola una restricción dura → contar iteración y seguir
    Δ = C(combo con d←alt) − C(combo)
    si Δ < 0 o rng.random() < exp(−Δ/T):   aceptar
    si C(combo) < coste_mejor:             mejor ← combo    # ¡imprescindible!
    T ← T·α
devolver mejor
```

Tres decisiones:

- **Se devuelve el mejor visto, no el último.** El recocido termina en un estado
  arbitrario; sin memoria del mejor se puede devolver algo peor que el arranque
  voraz. Es el error de implementación más común de SA.
- **$T_0 = 0{,}05$** es del orden de un $\Delta\mathcal{C}$ típico (cambiar un día
  mueve $E_d$ en ~0,02 y la unión en ~5 ingredientes → 0,03), así que al inicio
  se acepta ~50 % de los empeoramientos. $\alpha = 0{,}994$ lleva a
  $T_{400} \approx 0{,}005$, donde solo se aceptan mejoras. Programa geométrico,
  el estándar; no hay motivo para nada más sofisticado con un espacio de
  $6^7 = 280.000$ estados.
- **Un solo flujo aleatorio** para todo el recocido (`rng_de(seed, RUTA_D)`).
  Aquí sí es correcto y deseable: el bucle es estrictamente secuencial y su
  número de extracciones no depende de nada externo.

### 5.4 Diversidad de los K candidatos

Sin cuidado, los 6 candidatos de un día salen casi idénticos (mismo objetivo,
misma temperatura) y la etapa D no tiene nada que combinar. Regla: los
candidatos se deduplican por `frozenset` de ids de receta; si un candidato
duplica a otro, se regenera con `rng_de(seed, RUTA_A, d, k + K, 0, ·)`, hasta
$2K$ intentos. Si al final hay menos de 3 distintos, se sigue con los que haya y
se anota en la traza (síntoma de pool pobre, no de bug).

### 5.5 Acoplamiento con la etapa A

El término $\phi_{\text{sol}}$ (§2.2d) necesita `bits_semana`. En la generación
semanal los días se producen **en orden** y `bits_semana` acumula la unión de los
días ya cerrados. Consecuencia asumida: la generación semanal es secuencial. Es
un intercambio consciente — la alternativa (días independientes y toda la
optimización de lista en la etapa D) daría candidatos peores para empezar. Como
el presupuesto de tiempo sobra con dos órdenes de magnitud (§7), gana la calidad.

---

## 6. Fallo honesto: qué restricción ata

Esto es producto, no ingeniería. La salida obligatoria es un `FalloGeneracion`
con **exactamente tres sugerencias concretas y cuantificadas**, cada una
accionable con un botón (spec §9.4, "Estado de sobre-restricción").

Dos fases, en este orden.

### 6.0 Cuándo se dispara: el umbral de pool, bien definido

Un umbral absoluto `|P| < MIN_POOL = 40` **es incorrecto tal cual**, y el
catálogo semilla del repositorio lo demuestra: tiene **36 recetas** (medido, §9),
así que un solo número haría que el servicio rechazara *todas* las peticiones
con un diagnóstico que culpa al usuario de restricciones que no ha puesto.
Distinguir las dos causas es justamente el trabajo de esta sección.

Tres puertas, en este orden:

| Puerta | Condición | Significado | Respuesta |
|---|---|---|---|
| **1. Viabilidad (dura)** | algún slot pedido con $\lvert P_s\rvert < $ `MIN_CANDIDATOS_SLOT` | no se puede ni llenar el plan | `ok: false`, ablación §6.1 |
| **2. Atribución** | $\lvert P\rvert <$ `MIN_POOL` **y** $\lvert P\rvert < 0{,}5\,N$ | los filtros del usuario son la causa | `ok: false`, ablación §6.1 |
| **3. Catálogo corto** | $\lvert P\rvert <$ `MIN_POOL` **y** $\lvert P\rvert \ge 0{,}5\,N$ | los filtros apenas podan: el corto es el catálogo | **se genera igual**, `catalogo_estrecho` en la traza |

`MIN_CANDIDATOS_SLOT` depende del horizonte, y el número sale de la restricción
dura de §5.1 (ninguna receta más de `MAX_USOS_RECETA_SEMANA = 2` veces por
semana):

$$
\text{MIN\_CANDIDATOS\_SLOT} =
\begin{cases}
3 & \text{un día (elegir + 2 reparaciones)}\\[2pt]
\left\lceil \dfrac{D}{\text{MAX\_USOS\_RECETA\_SEMANA}} \right\rceil + 4 = 8
& \text{semana } (D=7)
\end{cases}
$$

Los 4 de holgura son para que la etapa D tenga algo que intercambiar; con
exactamente $\lceil D/2 \rceil$ la combinación está forzada y el recocido no
sirve de nada.

La puerta 3 es la que hace utilizable el catálogo semilla: sus mínimos por slot
son `desayuno 11 · almuerzo 8 · comida 21 · merienda 9 · cena 22` (medido, §9),
todos ≥ 8, así que genera semanas correctas aunque $\lvert P\rvert = 36 < 40$.
El día que el catálogo llegue a las 350-450 recetas de la spec §7.4, la puerta 3
deja de activarse sola y `MIN_POOL` recupera su papel de umbral de calidad.

**Por qué no se sube simplemente `MIN_POOL` a 0 en desarrollo:** porque entonces
el diagnóstico de sobre-restricción —que es la funcionalidad de producto más
diferencial de §6— no se ejercitaría nunca en local, y se descubriría roto en
producción. Con las tres puertas, se ejercita el camino real con el catálogo
real.

### 6.1 Fase 1 — El pool es demasiado pequeño (ablación *leave-one-out*)

Se dispara por las puertas 1 y 2 de §6.0.

Se construye la máscara de cada restricción por separado y se mide **cuántas
recetas devolvería el pool si se quitara esa restricción y solo esa**:

```python
mascaras = {
    "dieta":                 m_dieta[:, idx_dieta],
    "alergeno:lacteos":      ~m_alergeno[:, IDX_ALERGENO["lacteos"]],   # una por alérgeno
    ...
    "ingredientes_excluidos": sin_ingredientes_excluidos,
    "tiempo:desayuno":       minutos <= tope["desayuno"],               # una por slot
    ...
}
p0 = np.logical_and.reduce(list(mascaras.values())).sum()
for nombre in mascaras:
    resto = [m for k, m in mascaras.items() if k != nombre]
    ganancia[nombre] = int(np.logical_and.reduce(resto).sum()) - p0
```

Coste: ~20 reducciones AND sobre $N$ booleanos = **~2 ms**. Culpable =
`argmax(ganancia)`, desempatando por el orden fijo de `mascaras` (determinista).

**Regla de seguridad, no negociable (spec §11.3): jamás se sugiere relajar una
exclusión de alérgeno.** Aunque un alérgeno sea el que más ata, el campo
`restriccionCulpable` lo nombra —el usuario merece saber por qué su pool es
pequeño— pero las tres `sugerencias` se toman de los siguientes ejes por
ganancia. Nunca aparece "prueba a permitir lácteos". Por el mismo criterio,
nunca se sugiere bajar de `KCAL_MINIMAS` (1.500 hombre / 1.200 mujer, ver
`packages/shared/src/nutricion.ts`).

Plantillas (`diagnostico.PLANTILLAS`), todas con el número medido dentro:

| Culpable | Mensaje | Las tres salidas |
|---|---|---|
| `tiempo:<slot>` | «Con {t} min para el {slot} solo quedan {p0} recetas.» | subir a {t+10} min (+{g} recetas) · quitar el límite de ese slot (+{g'}) · mover ese slot a otro momento |
| `ingredientes_excluidos` | «Tus {k} ingredientes excluidos dejan fuera {g} recetas.» | reactivar {ingrediente más caro} (+{g₁}) · reactivarlo solo en {slot} · añadir más recetas al catálogo (enlace) |
| `dieta` | «La dieta {d} deja {p0} recetas para {n} comidas al día.» | reducir a {n−1} comidas · permitir {dieta contigua} · seguir con menos variedad (acepta repetición) |
| `alergeno:<a>` | «Excluir {a} deja {p0} recetas. Mantenemos la exclusión.» | *(nunca tocar el alérgeno)* reducir comidas · ampliar tiempo · avisar cuando haya más recetas sin {a} |
| `pool_insuficiente` | «Tu combinación deja {p0} recetas; necesitamos {MIN_POOL}.» | las 3 de mayor ganancia, excluidos alérgenos |

### 6.2 Fase 2 — El pool basta pero el objetivo es inalcanzable

Éste es el caso del ejemplo de la spec §4.2 ("no consigo 180 g de proteína con
1.600 kcal"). Se dispara cuando $E > 0{,}12$ tras la etapa C.

La clave es no adivinar: **se calculan cotas superiores/inferiores demostrables**
sobre lo alcanzable con este pool, y si el objetivo cae fuera, la imposibilidad
está *probada*, no estimada. Es lo que permite escribir un mensaje afirmativo sin
mentir.

**Cota superior de proteína dada la energía.** Para cada slot $s$, sea
$\rho_s^\* = \max_{r \in P_s} \frac{P_r}{k_r}$ (máxima proteína por kcal
admisible en ese slot). Entonces, para cualquier plan con $T_{\text{kcal}}$
repartidas según las cuotas:

$$
P_{\max} \;=\; T_{\text{kcal}} \sum_{s \in S} \text{cuota}_s \cdot \rho_s^\*
\;\;\ge\;\; P(\text{cualquier plan factible})
$$

Es cota superior válida porque asigna a cada slot la mejor densidad proteica
existente e ignora las cotas de $\sigma$ (que solo pueden empeorarlo). Si
$T_P^{\min} > P_{\max}$: **imposible, demostrado**. Y las salidas salen del mismo
cálculo:

- (a) subir kcal a $\lceil T_P^{\min} / \sum_s \text{cuota}_s\rho_s^\* \rceil$
  — solo se ofrece si respeta `KCAL_MINIMAS` y no supera el TDEE en más del 25 %.
- (b) bajar la proteína a $\lfloor P_{\max} \rfloor$ g.
- (c) el eje estructural: ampliar el pool (quitar el filtro con más ganancia de
  la fase 1) o reducir el número de comidas.

**Cota inferior de energía por número de comidas.** El fallo más común en la
práctica no es la proteína, es pedir 5 comidas con 1.300 kcal:

$$
K_{\min} = \sum_{s \in S} \min_{r \in P_s} \big(k_r \cdot \ell_r\big)
$$

Si $T_{\text{kcal}}(1+\text{tol}) < K_{\min}$, culpable
`kcal_insuficientes_para_slots`, y la primera salida es «quita la merienda»
(cuantificada: «pasar de 5 a 4 comidas baja el mínimo a {K'} kcal»).

Análogamente: $F_{\max}$ para fibra (mismo esquema con $\frac{F_r}{k_r}$) y
$Na_{\min} = \sum_s \min_r (Na_r \cdot \ell_r)$ para sodio.

**Orden de prioridad del culpable** (fijo y determinista, por gravedad
percibida): `kcal_insuficientes_para_slots` → `proteina_vs_kcal` →
`fibra_inalcanzable` → `sodio_inalcanzable` → `macros_incompatibles` (los rangos
de P/C/G no pueden sumar las kcal pedidas: comprobación algebraica directa,
$4P^{\min}+4C^{\min}+9G^{\min} > T(1+\text{tol})$ o
$4P^{\max}+4C^{\max}+9G^{\max} < T(1-\text{tol})$ — se comprueba **antes de
generar nada**, cuesta 1 µs y ahorra 300 ms de trabajo inútil) →
`objetivo_inalcanzable_generico`.

### 6.3 Contrato de salida

```python
FalloGeneracion(
    restriccionCulpable="proteina_vs_kcal",   # clave estable, legible por máquina
    mensaje=("No llego a 180 g de proteína con 1.600 kcal y las 22 recetas "
             "que quedan tras tus filtros."),
    recetasCandidatas=22,                     # |P| real, no una estimación
    sugerencias=[                             # SIEMPRE exactamente 3
        "Subir a 1.750 kcal al día",
        "Bajar la proteína a 155 g",
        "Permitir recetas con lácteos en el desayuno (+41 recetas)",
    ],
)
```

`restriccionCulpable` es una **clave estable**, no prosa: la web la mapea a
botones y la analítica la agrega. Toda la prosa va en `mensaje` y `sugerencias`.
Requisito de calidad verificable por test: **cada sugerencia debe ser cierta** —
re-ejecutar la petición aplicando la sugerencia (a) tiene que devolver
`ok: true` (test `test_sugerencia_a_funciona`, §8).

---

## 7. Rendimiento

### 7.1 Dónde está el coste

Medido en este entorno salvo donde diga *(est.)* — ver §9 para el método. El
recuento de veces es el peor caso: 7 días × 6 candidatos × 4 pasadas (1 inicial +
3 reparaciones) × 5 slots. Es pesimista a propósito: la reparación solo
re-puntúa **un** slot (§4.2), no los cinco.

| Operación | Coste unitario | Veces (semana) | Total |
|---|---|---|---|
| Carga de catálogo | 1,0 ms para N=36 → ~0,14 s para N=5.000 *(extrapolado)* | 0 (arranque) | — |
| Pool nivel 1 (fallo) | 8 ms *(est.)* | 0–1 | ≤ 8 ms |
| Pool nivel 2 (exclusiones) | 50 µs *(est.)* | 1 | 0,05 ms |
| Score de un slot, P=1.500 | **50 µs** | 7×6×4×5 = 840 | **42 ms** |
| Score de un slot, P=5.000 | **114 µs** | 840 | 96 ms |
| Top-k + softmax | incluido arriba (`argpartition` medido dentro) | 840 | — |
| LP (construir + resolver) | **64 µs** | 7×6×4 = 168 | **11 ms** |
| Cuantización + reparación 1-D | 30 µs *(est.)* | 168 | 5 ms |
| Recocido (400 iteraciones) | 30 µs *(est.)* | 1 | 12 ms |
| Serialización de la respuesta | — | 1 | ~3 ms |
| **Total semana (P=1.500)** | | | **≈ 73 ms** |
| **Total semana (P=5.000)** | | | **≈ 127 ms** |
| **Total un día (P=1.500)** | | | **≈ 12 ms** |

Las estimaciones a ojo del borrador anterior eran pesimistas por un factor de
3-10 (se estimaban 150 µs de scoring y 600 µs de LP). Se dejan aquí las medidas,
no las estimaciones, porque un presupuesto inflado invita a optimizaciones
prematuras: con estos números **no hay ninguna** justificada.

El coste está dominado por el scoring vectorizado (≈4× el LP), y crece
sublinealmente con P. Ambos son irreductibles sin cambiar el algoritmo.
**Objetivo de la tarea: <2 s para un día → ~170× de margen.** Ese margen no es un
lujo: absorbe una máquina de CI lenta, un pool de 5.000 recetas en vez de 1.500,
un intérprete en frío y el `float64` de HiGHS.

### 7.2 Qué se vectoriza

Todo lo que recorra el pool. Regla de implementación: **si un bucle `for` de
Python itera sobre recetas, es un bug de rendimiento.** Los únicos bucles
legítimos son sobre slots (≤5), días (≤7), candidatos (≤6) e intentos (≤3).

Micro-optimizaciones que sí valen la pena y por qué:

1. **Reutilizar la instancia `Highs`** con `clear()` + `passModel()`. Construir
   `Highs()` cuesta ~1 ms, más que resolver 3 LP.
2. **Buffers preasignados** para el CSC. La disposición del modelo es fija salvo
   $R$ (3–5); se preasigna para $R = 8$ y se rellena en su sitio.
3. **`float32` en el catálogo, `float64` en el LP.** El scoring no necesita doble
   precisión (la mitad de tráfico de memoria); el símplex sí (HiGHS lo exige).
4. **No indexar el catálogo completo por slot.** Vistas compactas del pool
   materializadas una vez (§1.2).

### 7.3 Paralelismo: no, en MVP

Los $K \times D = 42$ candidatos de día son independientes y la spec sugiere
`ProcessPoolExecutor`. **Decisión: no paralelizar en MVP.** Tres razones:

1. El presupuesto se cumple con dos órdenes de magnitud de sobra en un hilo
   (§7.1, medido). Paralelizar es complejidad sin beneficio de producto.
2. El coste de arranque de procesos y de serializar el pool NumPy (~90 KB por
   tarea × 42) es del orden del trabajo total.
3. Multiproceso complica la reproducibilidad. El árbol de `SeedSequence` (§2.6)
   la preserva, pero las trazas y el diagnóstico se vuelven mucho más difíciles
   de leer, y el diagnóstico honesto es una funcionalidad de producto.

Además, la etapa D es intrínsecamente secuencial por `bits_semana` (§5.5).

**Cuándo revisarlo:** si el banco de pruebas mide p95 > 700 ms para una semana.
Entonces: `fork` + catálogo en memoria del módulo (copy-on-write, sin
serializar), workers fijados con `OMP_NUM_THREADS=1`, y recolección **ordenada
por índice de día** antes de la etapa D.

Sí se aplica desde el día 1: **la generación semanal va en cola asíncrona**
(spec §6.5, punto 7) y la diaria es síncrona. Es una decisión de arquitectura de
producto, no de rendimiento.

### 7.4 Instrumentación

`generador.py` acumula un `TrazaGeneracion` con: ms por etapa, `|P|`, aciertos
de caché, intentos de reparación por día, $E$ final por día, términos
desactivados por falta de datos (coste, sodio, fibra) y número de candidatos
duplicados descartados. Se registra en `INFO` y se resume en `msTranscurridos`.

Banco de pruebas: `tests/bench_solver.py` (marcado `@pytest.mark.bench`, fuera
de la ejecución por defecto), con catálogos sintéticos de 500 / 1.500 / 5.000
recetas, 200 repeticiones, reportando p50/p95 por etapa.

---

## 8. Tests que deben existir

Convención: `tests/test_<modulo>.py`, nombres en español, `pytest`. Fixture
central `tests/factoria.py::catalogo_sintetico(n, semilla)` que genera un
catálogo determinista con cobertura controlada de alérgenos, dietas, slots,
densidades de macro y huecos de datos (recetas sin sodio, sin coste, sin fibra).
Nada de datos nutricionales inventados en los tests que se presenten como
reales: el catálogo sintético se llama sintético y no sale del directorio de
tests.

### 8.1 Determinismo y reproducibilidad

| Test | Qué comprueba |
|---|---|
| `test_mismo_seed_mismo_plan` | Dos llamadas con el mismo seed → JSON canónico idéntico byte a byte |
| `test_seeds_distintos_planes_distintos` | 20 seeds sobre un pool de 300 recetas → ≥18 planes distintos |
| `test_orden_de_slots_no_afecta` | `["cena","desayuno"]` y `["desayuno","cena"]` → el mismo plan |
| `test_determinismo_independiente_de_pythonhashseed` | Subproceso con `PYTHONHASHSEED=0` y otro con `=1` → mismo plan |
| `test_planes_dorados` | Fichero `tests/dorados/*.json` con seed + versión fijos; regresión ante cualquier cambio de algoritmo. Regenerable con `pytest --actualizar-dorados` |
| `test_reparacion_reproducible` | Un caso que necesita los 3 intentos: reproducible |

### 8.2 Etapa B (LP) — casos con solución conocida a mano

| Test | Qué comprueba |
|---|---|
| `test_lp_optimo_analitico_dos_recetas` | Dos recetas, objetivo alcanzable exactamente; $\sigma$ óptimos calculados a mano, tolerancia 1e-6 |
| `test_lp_banda_muerta_no_mueve_sigma` | Si $\sigma^{\text{ref}}$ ya cae dentro de todas las bandas, el LP devuelve exactamente $\sigma^{\text{ref}}$ (verifica el regularizador) |
| `test_lp_error_cero_dentro_de_rango` | $E = 0$ cuando todo está en banda, aunque no se clave el centro |
| `test_lp_cotas_activas` | Objetivo inalcanzable dentro de $[\ell,u]$: $\sigma$ en la cota y $E$ igual al valor calculado a mano |
| `test_lp_asimetria_proteina` | Con la misma magnitud de desviación, el defecto de proteína penaliza 2,5× el exceso |
| `test_lp_sodio_solo_penaliza_exceso` | Quedarse muy por debajo del sodio máximo no cuesta nada |
| `test_lp_fibra_solo_penaliza_defecto` | Simétrico del anterior |
| `test_lp_degenerado_es_estable` | 4 recetas nutricionalmente intercambiables → misma solución en 100 ejecuciones (sin regularizador este test falla; es su razón de ser) |
| `test_cuantizacion_conserva_banda` | Tras cuantizar a 0,05 las kcal siguen en banda, o la reparación 1-D las devuelve |
| `test_totales_coinciden_con_items` | Invariante: `ComidaPlan.totales == Σ σ_i · nutrientes_i`, tolerancia 1e-6. El bug más caro posible |
| `test_item_bloqueado_no_cambia` | `bloqueado: true` → `factorRacion` y `recetaId` intactos |

### 8.3 Etapa A y filtros

| Test | Qué comprueba |
|---|---|
| `test_fit_uno_para_composicion_identica` | Receta con la composición exacta del residuo → $\phi_{\text{fit}} = 1$ |
| `test_temperatura_baja_tiende_a_argmax` | $\tau = 0{,}01$, 200 muestras → ≥95 % la mejor del top-k |
| `test_temperatura_alta_tiende_a_uniforme` | $\tau = 1{,}5$ → entropía ≥ 0,9·log(25) |
| `test_entropia_monotona_en_temperatura` | Entropía del muestreo creciente para $\tau \in \{0{,}12, 0{,}37, 0{,}8, 1{,}5\}$ |
| `test_empates_desempatan_por_id` | Pool con scores idénticos → selección estable e independiente de la versión de NumPy |
| **`test_alergeno_excluido_nunca_aparece`** | **Crítico (§11.3).** 14 alérgenos × 50 seeds; ninguna receta con el alérgeno en ningún plan. Si este test falla, el servicio no se despliega |
| `test_dieta_vegana_sin_lacteos_ni_carne` | Filtro de dieta |
| `test_ingredientes_excluidos_respetados` | Ninguna receta del plan contiene un `alimentoId` excluido |
| `test_minutos_max_es_por_slot` | Límite estricto en desayuno, laxo en cena → hay cenas largas y no hay desayunos largos. Cubre el bug de §1.4 |
| `test_sin_repeticion_de_receta_en_el_dia` | Ninguna receta dos veces el mismo día |

### 8.4 Adversos: cuando no hay solución

| Test | Qué comprueba |
|---|---|
| `test_catalogo_insuficiente_devuelve_diagnostico` | Catálogo de 20 recetas → `ok: false`, `recetasCandidatas == 20`, culpable identificado, **exactamente 3 sugerencias** |
| `test_proteina_imposible_identifica_culpable` | 1.600 kcal / 180 g proteína con pool pobre → `restriccionCulpable == "proteina_vs_kcal"` |
| **`test_sugerencia_a_funciona`** | Se aplica la sugerencia (a) a la petición y se reenvía → `ok: true`. Es lo que separa un diagnóstico honesto de uno decorativo |
| `test_cinco_comidas_pocas_kcal` | 1.200 kcal con 5 slots → `kcal_insuficientes_para_slots`; la primera sugerencia reduce comidas |
| `test_macros_incompatibles_falla_pronto` | $4P^{\min}+4C^{\min}+9G^{\min} > T(1+\text{tol})$ → falla en <5 ms, sin generar |
| **`test_nunca_sugiere_relajar_alergeno`** | Alérgeno como restricción más atadora → ninguna sugerencia menciona relajarlo. Test de seguridad |
| `test_nunca_sugiere_bajar_de_kcal_minimas` | Ninguna sugerencia baja de 1.500/1.200 kcal |
| `test_objetivo_extremo_alto` | 6.000 kcal, 3 slots → o plan con $\sigma$ en cota superior, o fallo honesto; nunca un plan silenciosamente incorrecto |
| `test_todos_los_items_bloqueados` | Culpable `items_bloqueados`, sin excepción |
| `test_rango_invertido_es_422` | `proteinaG: {min: 200, max: 100}` → error de validación, no `kInfeasible` |
| `test_pool_vacio_no_revienta` | Cero recetas admisibles → `FalloGeneracion`, nunca traza de excepción |
| **`test_catalogo_semilla_genera_semana`** | Con `data/catalogo.jsonl` tal cual (36 recetas < `MIN_POOL`) y sin exclusiones → `ok: true`. Es el test de la puerta 3 de §6.0: cubre el bug de rechazar todo por un umbral absoluto |
| `test_pool_corto_por_filtros_si_falla` | Mismo catálogo, pero excluyendo lácteos+gluten+huevos hasta dejar `|P| < 0,5·N` → `ok: false` con culpable atribuido a un filtro, no al catálogo |
| `test_slot_sin_candidatos_falla_antes_de_generar` | Un slot con 0 recetas admisibles → puerta 1, fallo en <5 ms |

### 8.5 Honestidad con los datos

| Test | Qué comprueba |
|---|---|
| `test_sin_datos_de_sodio_no_se_inventa` | Catálogo sin sodio → la restricción se ignora y el campo no aparece en los totales |
| `test_sin_precios_no_se_puntua_coste` | >20 % del pool sin precio → término de coste desactivado, registrado en la traza |
| `test_fibra_parcial_se_omite` | <80 % de las kcal del día con fibra conocida → `PanelNutricional.fibraG is None` |

### 8.6 Etapa D (semanal)

| Test | Qué comprueba |
|---|---|
| `test_ensamblado_no_empeora_el_voraz` | $\mathcal{C}(\text{final}) \le \mathcal{C}(\text{arranque voraz})$, siempre. Cubre el "devolver el mejor, no el último" |
| `test_lista_mas_corta_que_el_voraz` | Sobre 30 seeds, la mediana de ingredientes únicos baja ≥8 % |
| `test_receta_maximo_dos_veces_por_semana` | Restricción dura |
| `test_sin_misma_receta_en_slot_consecutivo` | Restricción dura |
| `test_despensa_aumenta_su_uso` | 100 seeds con y sin despensa: la cobertura media de despensa sube de forma significativa |
| `test_presupuesto_reduce_coste` | Con presupuesto ajustado, el coste estimado baja frente al control |
| `test_recetas_recientes_se_penalizan` | Las recetas recientes aparecen menos que el control (100 seeds) |

### 8.7 Rendimiento y contrato

| Test | Qué comprueba |
|---|---|
| `test_dia_bajo_presupuesto` | p95 de 50 generaciones de un día < 600 ms (×13 de margen sobre lo estimado, para CI lento) |
| `test_semana_bajo_presupuesto` | p95 de 20 semanas < 2 s |
| `test_respuesta_valida_contra_el_esquema` | La respuesta valida contra `RespuestaOk`; `msTranscurridos > 0` |
| `test_cabecera_seed_presente` | Petición sin seed → cabecera `X-PlanEat-Seed` con un entero reutilizable que reproduce el plan |
| `test_health_sigue_ok` | El test existente no se rompe |

---

## 9. Verificación empírica de este documento

Todo lo que este documento afirma como **medido** se obtuvo ejecutando el código
del propio documento contra el entorno real del repositorio
(`services/solver/.venv`, macOS/arm64, Python 3.12, **NumPy 2.5.2**, **highspy
1.15.1**). No hay ningún número medido que no salga de aquí, y lo que no se pudo
medir se deja marcado como *(est.)*.

**Qué se comprobó y qué salió:**

| # | Afirmación del documento | Resultado |
|---|---|---|
| 1 | `np.bitwise_count` existe (§1.3) | ✔ NumPy 2.5.2; `pyproject` ya exige `numpy>=2.1` |
| 2 | Nombres de la API de highspy (§3.4) | ✔ todos correctos en 1.15.1; ver la nota de dtypes |
| 3 | El LP de §3.4 compila y resuelve tal como está escrito | ✔ `kOptimal`, $E=0$ con objetivo alcanzable |
| 4 | Una sola fila por nutriente reproduce la banda muerta (§3.2) | ✔ $u^+=u^-=0$ dentro de banda; $E=0{,}169$ con proteína imposible, y $u^-_{\text{prot}}=171$ g identifica el nutriente que ata |
| 5 | El LP es degenerado sin regularizador (§3.2) | ✔ patología reproducida exactamente; matiz importante corregido en §3.2 |
| 6 | El coseno se satura (§2.2a) | ✔ pero el rango real es $[0{,}77,\ 1{,}00]$, no $[0{,}85,\ 1{,}00]$; tabla corregida |
| 7 | Presupuestos de tiempo (§7.1) | ✔ el diseño es 3-10× **más rápido** de lo estimado |
| 8 | `MIN_POOL = 40` sobre el catálogo real | ✘ **fallo de diseño**: el catálogo tiene 36 recetas. Corregido en §6.0 |

Lo importante del punto 8: el error no se habría visto revisando el documento,
solo cargando los datos que hay. Es la razón de que esta sección exista.

**Cómo reproducirlo.** Los dos guiones de verificación son deliberadamente
independientes del código del solver (que aún no existe) y deben convertirse en
`tests/bench_solver.py` (§7.4) al implementar:

```bash
cd services/solver
./.venv/bin/python - <<'PY'
import numpy as np, highspy
from app.catalogo import cargar_catalogo
cat = cargar_catalogo()
obj = np.array([.30,.40,.30]); obj /= np.linalg.norm(obj)
cos = cat.v_macro[cat.tiene_macro] @ obj.astype(np.float32)
fit = 1 - (2/np.pi)*np.arccos(np.clip(cos,-1,1))
print(cat.n, cos.min(), np.median(cos), cos.std(), fit.std())   # §2.2a
PY
```

**Qué queda sin medir** (y por qué no se inventa un número): el coste del pool
de nivel 1 y 2, la cuantización, el recocido y la serialización. Los tres
primeros dependen de código que todavía no existe; el último, del tamaño real de
la respuesta. Están marcados *(est.)* en §7.1 y son los primeros que el banco de
pruebas debe cubrir.

---

## Apéndice A — Constantes, todas juntas

```python
# services/solver/app/solver/__init__.py — cada valor cita su sección

IDX_NUTRIENTE = {"kcal": 0, "proteina": 1, "carbohidrato": 2,
                 "grasa": 3, "fibra": 4, "sodio": 5}                    # §1.1

PESO_SLOT = {"desayuno": 0.22, "almuerzo": 0.10, "comida": 0.35,
             "merienda": 0.10, "cena": 0.28}                            # §2.1

W_FIT, W_ESC, W_DESP, W_SOL, W_AFIN = 4.0, 2.0, 1.5, 1.2, 0.0           # §2.2
W_COST, W_REP = 1.5, 2.0                                                # §2.2
DECAIMIENTO_REPETICION = 0.85                                           # §2.2f
FRACCION_MINIMA_PRECIOS = 0.80                                          # §2.2e

TOP_K = 25                                                              # §2.4
TAU_MIN, TAU_MAX, VARIEDAD_POR_DEFECTO = 0.12, 1.5, 45                  # §2.4

PESOS_LP = {  # (exceso, defecto)                                       # §3.1
    "kcal": (3.0, 3.0), "proteina": (1.0, 2.5), "carbohidrato": (1.0, 1.0),
    "grasa": (1.0, 1.0), "fibra": (0.0, 0.5), "sodio": (0.3, 0.0),
}
EPS_REG = 1e-3                                                          # §3.2
UMBRAL_ERROR_OK, UMBRAL_ERROR_ACEPTABLE = 0.04, 0.12                    # §3.3
PASO_RACION = 0.05                                                      # §3.4
ESCALA_MIN_POR_DEFECTO, ESCALA_MAX_POR_DEFECTO = 0.6, 1.8               # §1.1

MAX_INTENTOS_REPARACION = 3                                             # §4.2
FACTOR_TEMPERATURA_REINTENTO = 0.25                                     # §4.2

K_CANDIDATOS_DIA = 6                                                    # §5
LAMBDA_INGREDIENTES, MU_PRESUPUESTO, NU_REPETICION = 0.006, 0.30, 0.05  # §5.1
MAX_USOS_RECETA_SEMANA = 2                                              # §5.1
SA_T0, SA_ALFA, SA_ITERACIONES = 0.05, 0.994, 400                       # §5.3

MIN_POOL = 40                                                           # §6.0
MIN_CANDIDATOS_SLOT_DIA = 3          # elegir + 2 reparaciones           # §6.0
MIN_CANDIDATOS_SLOT_SEMANA = 8       # ceil(D/MAX_USOS_RECETA_SEMANA)+4  # §6.0
FRACCION_POOL_ATRIBUIBLE = 0.5       # puerta 2 vs. puerta 3             # §6.0
TTL_CACHE_POOL_S, TAM_CACHE_POOL = 3600, 256                            # §1.4

VERSION_GENERADOR = "1.0.0"   # cambia con cualquier alteración de resultados
```

> **Cambio pendiente de aplicar en `app/solver/__init__.py`.** Ese módulo ya
> existe y hoy declara `MIN_POOL, MIN_CANDIDATOS_POR_SLOT = 40, 8`. Con las tres
> puertas de §6.0 hay que sustituirlo por las cuatro constantes de arriba
> (`MIN_POOL`, `MIN_CANDIDATOS_SLOT_DIA`, `MIN_CANDIDATOS_SLOT_SEMANA`,
> `FRACCION_POOL_ATRIBUIBLE`). Es el único punto donde este documento pide tocar
> código ya escrito, y sin él el servicio rechaza todas las peticiones contra el
> catálogo actual.

`VERSION_GENERADOR` se persiste con cada plan. Sin él no se puede hacer A/B de
versiones del algoritmo ni reproducir un plan antiguo (spec §6.5, punto 8), por
mucho que se guarde el seed.

## Apéndice B — Resumen de decisiones tomadas frente a la spec

| # | La spec decía | Aquí se hace | Por qué |
|---|---|---|---|
| 1 | Objetivos como punto, restricción de igualdad | Banda muerta sobre los rangos del contrato | El contrato da rangos; penalizar dentro del rango desperdicia la libertad del LP (§3.1) |
| 2 | Dos restricciones por nutriente | Una fila por nutriente | Equivalente y exacto; la mitad de modelo (§3.2) |
| 3 | (no lo menciona) | Regularizador $\varepsilon\sum t_i$ | Sin él el LP degenerado devuelve vértices arbitrarios y no es reproducible (§3.2) |
| 4 | `cosine_similarity` cruda | Distancia angular reescalada | El coseno se satura en $[0{,}85, 1]$ y el softmax no discrimina (§2.2a) |
| 5 | `1 - |clamp - needed|` | Cociente $\eta/\ell$ o $u/\eta$ | La resta mezcla unidades y castiga a las recetas ligeras (§2.2b) |
| 6 | Jaccard para el solape | Cobertura sobre la receta | Jaccard se apaga solo según avanza la semana (§2.2d) |
| 7 | `softmax(scores, T)` | Softmax sobre z-scores del top-k | Da a $\tau$ un significado estable, exponible como "variedad" (§2.4) |
| 8 | `residual -= nutrients` (σ=1) | `residual -= clip(η,ℓ,u)·nutrients` | Aproximación gratis y mucho mejor (§2.5) |
| 9 | Reparación por distancia composicional | Culpabilidad $\kappa_i$ desde las holguras del LP | El LP ya sabe qué falta y qué sobra; no hay que adivinarlo (§4.1) |
| 10 | Reseleccionar el día entero | Solo el slot culpable | 4× más barato y no tira los slots buenos (§4.2) |
| 11 | `Random(seed)` secuencial | Árbol de `SeedSequence` con clave estructural | Reproducibilidad estable ante cambios de flujo y paralelismo (§2.6) |
| 12 | Caché de pool por todas las restricciones | Caché de dos niveles | `ingredientesExcluidos` es de alta cardinalidad y hunde los aciertos (§1.4) |
| 13 | `ProcessPoolExecutor` para los candidatos | Un solo hilo en MVP | El presupuesto sobra ~170× (medido); multiproceso complica la reproducibilidad (§7.3) |
| 14 | Diagnóstico genérico | Ablación + cotas demostrables + veto sobre alérgenos | Permite afirmar la imposibilidad sin mentir, y no pone en riesgo a nadie (§6) |
| 15 | `MIN_POOL` como umbral absoluto | Tres puertas (viabilidad / atribución / catálogo corto) | Un umbral único culpa al usuario de que el catálogo sea corto, y con el catálogo semilla (36 recetas) rechazaría todas las peticiones (§6.0) |
