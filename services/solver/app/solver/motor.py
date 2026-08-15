"""Orquestador del motor. `SolicitudGeneracion` -> `RespuestaGeneracion`.

El solver es una **función pura sobre catálogo + petición**: no toca disco, no
consulta la base de datos y no lee el reloj para decidir nada. La fecha entra
sólo en `DiaPlan.fecha`, jamás en una decisión (§2.6): por eso el mismo seed con
la misma entrada produce el mismo plan.

Orden de las comprobaciones, y por qué es ése:

1. Validación del objetivo — un rango invertido es un error del cliente, no un
   plan imposible; devolverlo como `kInfeasible` sería indepurable.
2. Macros incompatibles — comprobación algebraica de 1 µs que ahorra cientos de
   milisegundos de trabajo inútil.
3. Puertas del pool (§6.0) — distinguir "tus filtros aprietan" de "nuestro
   catálogo es corto" es el trabajo de producto más diferencial del servicio.
4. Generación A→B→C→D.
5. Umbral de error — si tras reparar sigue fuera de banda, diagnóstico honesto
   en vez de un plan silenciosamente incorrecto.
"""

from __future__ import annotations

import math
import secrets
import time
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np

from ..schemas import (
    ComidaPlan,
    DiaPlan,
    FalloGeneracion,
    ItemPlan,
    RespuestaError,
    RespuestaOk,
    SolicitudGeneracion,
    TotalesNutricionales,
)
from . import (
    FRACCION_POOL_ATRIBUIBLE,
    IDX_CARB,
    IDX_FIBRA,
    IDX_GRASA,
    IDX_KCAL,
    IDX_PROT,
    IDX_SLOT,
    IDX_SODIO,
    MAX_USOS_RECETA_SEMANA,
    MIN_CANDIDATOS_SLOT_DIA,
    MIN_CANDIDATOS_SLOT_SEMANA,
    MIN_POOL,
    UMBRAL_ERROR_ACEPTABLE,
    VARIEDAD_POR_DEFECTO,
    VERSION_GENERADOR,
    temperatura,
)
from .diagnostico import (
    Fallo,
    candidatos_por_slot,
    diagnosticar_objetivo,
    diagnosticar_pool,
    macros_incompatibles,
)
from .reparacion import CandidatoDia
from .scoring import construir_pool, contexto_de, cuotas_de
from .semanal import ensamblar, generar_candidatos, reparar_duras


@dataclass(slots=True)
class Traza:
    """Instrumentación de una generación. Se resume en el log, no en la respuesta."""

    ms_total: int = 0
    ms_pool: int = 0
    ms_generacion: int = 0
    ms_ensamblado: int = 0
    pool: int = 0
    catalogo_estrecho: bool = False
    duplicados: int = 0
    intentos_reparacion: int = 0
    errores_por_dia: list[float] = field(default_factory=list)
    porcionados_de_emergencia: int = 0
    reparaciones_duras: int = 0
    terminos_desactivados: list[str] = field(default_factory=list)
    seed: int = 0


class ObjetivoInvalido(ValueError):  # noqa: N818 — el proyecto nombra en español
    """Error del cliente, no del solver. Se traduce a 422 en la capa HTTP."""


def _validar(solicitud: SolicitudGeneracion) -> None:
    """Convierte un `kInfeasible` indepurable en un mensaje claro. §3.5

    El contrato no lleva estos validadores (`schemas.py` es la fuente de verdad
    compartida con la web y no se toca aquí), así que se comprueban en la
    frontera del motor.
    """
    if not solicitud.objetivos:
        raise ObjetivoInvalido("Hace falta al menos un objetivo diario.")
    if not solicitud.restricciones.slots:
        raise ObjetivoInvalido("Hace falta al menos una comida al día.")
    for i, obj in enumerate(solicitud.objetivos, start=1):
        if obj.kcal <= 0:
            raise ObjetivoInvalido(
                f"Día {i}: las kcal objetivo deben ser mayores que cero."
            )
        if not 0 <= obj.toleranciaKcal <= 0.5:
            raise ObjetivoInvalido(
                f"Día {i}: la tolerancia de kcal debe estar entre 0 y 0,5."
            )
        for nombre, rango in (
            ("proteína", obj.proteinaG),
            ("carbohidrato", obj.carbohidratoG),
            ("grasa", obj.grasaG),
        ):
            if rango.min < 0 or rango.max < 0:
                raise ObjetivoInvalido(
                    f"Día {i}: el rango de {nombre} no puede ser negativo."
                )
            if rango.min > rango.max:
                raise ObjetivoInvalido(
                    f"Día {i}: el rango de {nombre} está invertido "
                    f"(mín {rango.min:g} > máx {rango.max:g})."
                )


def _min_candidatos_slot(n_dias: int) -> int:
    """Cuántas recetas hacen falta por slot para que el plan sea armable. §6.0

    Sale de la restricción dura de repetición, no de un número a ojo: con
    `MAX_USOS_RECETA_SEMANA` usos y D días hacen falta al menos ceil(D/2)
    recetas distintas por slot, más 4 de holgura para que el recocido tenga
    algo que intercambiar. Un umbral derivado se recalcula solo cuando cambia
    el horizonte; uno inventado exige acordarse de tocarlo.
    """
    if n_dias <= 1:
        return MIN_CANDIDATOS_SLOT_DIA  # elegir + 2 reparaciones
    holgura = MIN_CANDIDATOS_SLOT_SEMANA - math.ceil(7 / MAX_USOS_RECETA_SEMANA)
    return min(
        MIN_CANDIDATOS_SLOT_SEMANA,
        math.ceil(n_dias / MAX_USOS_RECETA_SEMANA) + holgura,
    )


def _panel(
    totales: np.ndarray, fibra_fiable: bool, sodio_fiable: bool
) -> TotalesNutricionales:
    """Traduce el vector de 6 nutrientes a los totales del contrato.

    `fibraG` va a `None` cuando menos del 80 % de las kcal del día tienen fibra
    conocida: un total parcial se lee como total y miente. §8.5

    `sodioMg` sale de la columna 5, que el motor ya calculaba y este serializador
    tiraba. Su criterio de fiabilidad es más estricto que el de la fibra —basta
    con que UN item no declare sodio para anularlo— y no es una incoherencia:
    el sodio es la única columna donde el interés del usuario es un techo, y un
    techo estimado por defecto invita a pasarse creyendo que no. Ojo al portar:
    esto NO es lo mismo que `nutrientes_activos`, que decide si el sodio entra en
    la función objetivo y para eso mira además si hay `sodioMaxMg`.
    """
    return TotalesNutricionales(
        kcal=round(float(totales[IDX_KCAL]), 1),
        proteinaG=round(float(totales[IDX_PROT]), 1),
        carbohidratoG=round(float(totales[IDX_CARB]), 1),
        grasaG=round(float(totales[IDX_GRASA]), 1),
        fibraG=round(float(totales[IDX_FIBRA]), 1) if fibra_fiable else None,
        sodioMg=round(float(totales[IDX_SODIO]), 1) if sodio_fiable else None,
    )


def _dia_a_contrato(pool, cand: CandidatoDia, fecha: str, objetivo) -> DiaPlan:
    """Serializa un candidato. Los totales SIEMPRE se recalculan desde los items.

    Devolver los totales del LP continuo mientras los items llevan los σ
    cuantizados es el bug más caro posible: la suma de la UI no cuadraría con lo
    que la propia UI muestra por comida.
    """
    orden = sorted(range(len(cand.slots)), key=lambda p: IDX_SLOT[cand.slots[p]])
    comidas: list[ComidaPlan] = []
    acumulado = np.zeros(6, dtype=np.float64)
    # El sodio del día sólo es fiable si lo es el de TODAS sus comidas: una suma
    # a la que le falta un sumando no es una cota superior de nada.
    sodio_dia = all(bool(pool.conocido[f][IDX_SODIO]) for f in cand.filas)
    for p in orden:
        fila, sigma = cand.filas[p], float(cand.sigma[p])
        totales = pool.nutr[fila].astype(np.float64) * sigma
        acumulado += totales
        comidas.append(
            ComidaPlan(
                slot=cand.slots[p],
                items=[
                    ItemPlan(
                        recetaId=str(pool.ids[fila]),
                        factorRacion=round(sigma, 2),
                        bloqueado=False,
                    )
                ],
                totales=_panel(
                    totales, cand.fibra_fiable, bool(pool.conocido[fila][IDX_SODIO])
                ),
            )
        )
    return DiaPlan(
        fecha=fecha,
        comidas=comidas,
        totales=_panel(acumulado, cand.fibra_fiable, sodio_dia),
        objetivo=objetivo,
    )


def _a_contrato(fallo: Fallo) -> FalloGeneracion:
    return FalloGeneracion(
        restriccionCulpable=fallo.restriccionCulpable,
        mensaje=fallo.mensaje,
        recetasCandidatas=fallo.recetasCandidatas,
        sugerencias=fallo.sugerencias,
    )


def generar(
    solicitud: SolicitudGeneracion,
    cat,
    hoy: date | None = None,
) -> tuple[RespuestaOk | RespuestaError, Traza]:
    """Genera el plan. Nunca lanza salvo `ObjetivoInvalido` (error del cliente)."""
    t0 = time.perf_counter()
    _validar(solicitud)

    traza = Traza()
    seed = solicitud.seed if solicitud.seed is not None else secrets.randbits(63)
    traza.seed = seed
    restr = solicitud.restricciones
    slots = list(restr.slots)
    objetivos = list(solicitud.objetivos)
    n_dias = len(objetivos)
    hoy = hoy or date.today()

    # (2) Comprobación algebraica antes de generar nada: 1 µs frente a ~300 ms.
    for obj in objetivos:
        malo, motivo = macros_incompatibles(obj)
        if malo:
            fallo = Fallo(
                restriccionCulpable="macros_incompatibles",
                mensaje=motivo,
                recetasCandidatas=0,
                sugerencias=[
                    "Recalcular los macros a partir de tus kcal objetivo",
                    "Ampliar el rango de carbohidratos",
                    "Ampliar el rango de grasa",
                ],
            )
            traza.ms_total = int((time.perf_counter() - t0) * 1000)
            return RespuestaError(fallo=_a_contrato(fallo)), traza

    t_pool = time.perf_counter()
    pool = construir_pool(cat, restr)
    traza.ms_pool = int((time.perf_counter() - t_pool) * 1000)
    traza.pool = pool.p

    # (3) Las tres puertas de §6.0. Un umbral absoluto `|P| < MIN_POOL` culparía
    # al usuario de que el catálogo sea corto: con el catálogo semilla (36
    # recetas) rechazaría el 100 % de las peticiones.
    min_slot = _min_candidatos_slot(n_dias)
    por_slot = candidatos_por_slot(pool, restr, slots)
    flojos = {s: c for s, c in por_slot.items() if c < min_slot}

    puerta_1 = bool(flojos)
    puerta_2 = pool.p < MIN_POOL and pool.p < FRACCION_POOL_ATRIBUIBLE * cat.n
    if puerta_1 or puerta_2:
        fallo = diagnosticar_pool(cat, restr, slots, pool.p, flojos, min_slot)
        traza.ms_total = int((time.perf_counter() - t0) * 1000)
        return RespuestaError(fallo=_a_contrato(fallo)), traza
    if pool.p < MIN_POOL:
        # Puerta 3: los filtros apenas podan, el corto es el catálogo. Se genera
        # igual y se anota; culpar al usuario aquí sería mentirle.
        traza.catalogo_estrecho = True

    # (4) Generación.
    ctx = contexto_de(cat, pool, restr, n_dias, temperatura(VARIEDAD_POR_DEFECTO))
    if ctx.coste_desactivado_por:
        traza.terminos_desactivados.append(f"coste:{ctx.coste_desactivado_por}")

    t_gen = time.perf_counter()
    por_dia, traza.duplicados = generar_candidatos(pool, ctx, objetivos, slots, seed)
    traza.ms_generacion = int((time.perf_counter() - t_gen) * 1000)

    t_ens = time.perf_counter()
    resultado = ensamblar(
        pool, por_dia, seed, restr.presupuestoSemanalCents, restr.comensales
    )
    traza.ms_ensamblado = int((time.perf_counter() - t_ens) * 1000)

    if resultado.dias_sin_candidato or len(resultado.dias) != n_dias:
        # Algún día se quedó sin ninguna combinación admisible. No es un caso de
        # objetivo inalcanzable sino de pool agotado dentro del día.
        #
        # El sexto argumento es el dict de slots FLOJOS, no el recuento completo
        # por slot. Aquí se pasaba `por_slot`, que nunca está vacío: la rama de
        # `slot_sin_candidatos` de `diagnosticar_pool` se disparaba SIEMPRE y
        # escribía mensajes falsos del tipo «Sólo encuentro 21 recetas para la
        # comida y necesito al menos 8» —21 ≥ 8, o sea, ese slot no era el
        # problema—. En este punto ya se ha pasado la puerta 1, así que `flojos`
        # está vacío por construcción y el diagnóstico cae donde debe: en el eje
        # que la ablación señala como culpable. Es la misma llamada que la de la
        # puerta 1, y ésa siempre fue correcta.
        fallo = diagnosticar_pool(cat, restr, slots, pool.p, flojos, min_slot)
        traza.ms_total = int((time.perf_counter() - t0) * 1000)
        return RespuestaError(fallo=_a_contrato(fallo)), traza

    # El recocido puede haber roto una restricción dura que la etapa A vetó
    # contra un estado provisional. Se comprueba y se corrige item a item.
    resultado.dias, traza.reparaciones_duras = reparar_duras(
        pool, ctx, objetivos, resultado.dias
    )

    traza.errores_por_dia = [round(c.error, 4) for c in resultado.dias]
    traza.intentos_reparacion = sum(c.intentos for c in resultado.dias)
    traza.porcionados_de_emergencia = sum(1 for c in resultado.dias if c.emergencia)

    # (5) Umbral de honestidad: por encima, no se devuelve un plan que finge
    # cumplir el objetivo. El peor día manda: un plan semanal con un día roto es
    # un plan roto.
    peor = max(range(n_dias), key=lambda d: resultado.dias[d].error)
    if resultado.dias[peor].error > UMBRAL_ERROR_ACEPTABLE:
        fallo = diagnosticar_objetivo(
            pool,
            cat,
            restr,
            slots,
            cuotas_de(slots),
            objetivos[peor],
            resultado.dias[peor].totales,
            pool.p,
        )
        traza.ms_total = int((time.perf_counter() - t0) * 1000)
        return RespuestaError(fallo=_a_contrato(fallo)), traza

    dias = [
        _dia_a_contrato(pool, cand, (hoy + timedelta(days=d)).isoformat(), objetivos[d])
        for d, cand in enumerate(resultado.dias)
    ]
    ms = max(1, int((time.perf_counter() - t0) * 1000))
    traza.ms_total = ms
    # Los cinco datos de reproducibilidad van DENTRO de la respuesta, no en
    # cabeceras: el motor del navegador no tiene ninguna que poner, y un plan sin
    # ellos no se puede volver a generar. `seed` como cadena porque son 63 bits.
    return (
        RespuestaOk(
            dias=dias,
            msTranscurridos=ms,
            seed=str(seed),
            versionCatalogo=cat.version,
            versionGenerador=VERSION_GENERADOR,
            pool=pool.p,
            catalogoEstrecho=traza.catalogo_estrecho,
        ),
        traza,
    )


__all__ = ["ObjetivoInvalido", "Traza", "generar", "VERSION_GENERADOR"]
