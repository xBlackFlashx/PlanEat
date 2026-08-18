#!/usr/bin/env python3
"""Busca una foto real por receta en Pexels y guarda el resultado en
data/imagenes.json.

No es una llamada en caliente desde la app: es un paso de compilación, igual
que construir_catalogo.py. Se corre una vez (o cuando cambian las recetas) y
el resultado se versiona.

Por qué la consulta va en inglés y no en español: Pexels SÍ responde a
consultas en español (probado a mano), pero su texto alternativo (`alt`) es
siempre en inglés, así que comparar las palabras del título en español contra
el `alt` en inglés daba coincidencia cero en casi todo — no porque la foto
fuera mala, sino porque "pollo" nunca va a coincidir con "chicken" por
comparación literal. Traducir la consulta al inglés (a mano, en
consultas_en_imagenes.json, no con un traductor automático — el catálogo
entero se revisa así) hace que la consulta y el `alt` compartan idioma, y
entonces la coincidencia de palabras sí mide relevancia de verdad.

Por qué NO se usa el parámetro `color` de la API: existe y está documentado,
pero probado a mano contra la API real no filtra nada — la misma consulta con
`color=white`, `color=black` o sin color devuelve exactamente los mismos
resultados en el mismo orden. En su lugar, cada candidata trae su propio
`avg_color`, y de ahí sí se puede preferir la más clara entre las que ya
encajan por contenido: no es un filtro por fondo (`avg_color` promedia toda
la foto, plato y comida incluidos, no sólo el fondo), pero entre variantes
igual de relevantes, la más clara tiende a ser la de mesa/estudio despejado
en vez de restaurante en penumbra. Se combina con `" close up"` añadido a la
propia consulta, que sí es un término real que Pexels entiende — los
resultados con esa palabra son sistemáticamente encuadres más cerrados.

`SIN_GENTE` descarta cualquier candidata cuyo `alt` mencione a una persona:
una comida con una cara o una mano mordiendo el plato no es la fotografía de
producto que pide la ficha. `CONSULTAS_REVISADAS` sobrescribe la traducción
literal del título cuando esa traducción, aun en inglés, atrae fotos que no
son el plato — carne cruda, una copa de vino, un kit de glucosa — porque
comparten alguna palabra con la receta pero no el plato.

Uso:
    PEXELS_API_KEY=... python scripts/buscar_imagenes.py
    PEXELS_API_KEY=... python scripts/buscar_imagenes.py --reanudar  # tras un 429
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
RUTA_RECETAS = RAIZ / "data" / "recetas.json"
RUTA_SALIDA = RAIZ / "data" / "imagenes.json"
RUTA_CONSULTAS_EN = RAIZ / "scripts" / "consultas_en_imagenes.json"

STOPWORDS = {
    "a", "an", "and", "the", "with", "on", "in", "for", "of", "style",
    "fresh", "delicious", "perfect", "close", "up", "top", "view", "plate",
    "bowl", "glass",
}

SIN_GENTE = {
    "woman", "man", "person", "people", "girl", "boy", "face", "model",
    "eating", "bite", "biting",
}

# Consultas que dieron una foto que no es el plato (carne cruda, una copa de
# vino, un kit de glucosa...) o un encuadre demasiado abierto para "primer
# plano". Sólo las que se revisaron a mano tras mirar el resultado real.
#
# `buscar()` añade " close up" a toda consulta antes de mandarla, así que
# estas no lo repiten.
CONSULTAS_REVISADAS: dict[str, str] = {
    "pollo_asado_aderezo_italiano": "grilled chicken with roasted vegetables on a plate",
    "salmon_espinacas_aguacate": "baked salmon fillet with spinach and avocado on a plate",
    "hummus_pan_centeno": "hummus with rye bread slices",
    "requeson_miel_almendras": "yogurt bowl with honey and almonds",
    "sandwich_mermelada_cacahuete_grande": "peanut butter and jelly sandwich cut in half",
    "pasta_aceite_tomate_albahaca": "pasta with tomato sauce and basil",
    "crema_calabacin_requeson": "zucchini soup with cottage cheese",
    "judias_verdes_ajo": "sauteed green beans with garlic",
    "arroz_pollo_verduras": "rice with chicken and vegetables",
    "ensalada_pasta_atun": "pasta salad with tuna and olives",
    "ensalada_pepino_tomate_verano": "cucumber and tomato salad",
    "ensalada_pollo_curry": "curry chicken salad",
    "salteado_col_verde_bacon": "sauteed cabbage with bacon",
    "avena_platano_leche": "oatmeal with banana and milk",
    "porridge_platano_cacahuete": "oatmeal with peanut butter and sliced banana",
    "yogur_nueces": "plain yogurt with walnuts",
    "brocheta_pollo_pimientos": "chicken skewers with bell peppers",
    "coles_bruselas_ajo": "garlic roasted brussels sprouts",
    "manzana_almendras": "sliced apple with almonds",
    "wrap_pavo_espinacas_queso": "turkey wrap with spinach and cheese",
    "wrap_pollo_lechuga": "chicken lettuce wrap",
    "salmon_balsamico": "balsamic glazed salmon fillet",
    "batido_platano_avena": "banana oat smoothie in a glass",
    "ensalada_atun_americana": "tuna salad",
    "curry_garbanzos": "chickpea curry with rice",
    "lentejas_guisadas": "lentil stew with vegetables",
}

# Casos donde ni reescribir la consulta bastó: la búsqueda siguió devolviendo
# la misma foto mala como mejor resultado (una foto de pizza para "salmón al
# horno", una ensalada con copa de vino de fondo, un bar con luz de neón para
# "batido tropical"...). Aquí se ancla directamente el id de Pexels de la
# foto que sí es la correcta, encontrada revisando resultados a mano.
FOTOS_FORZADAS: dict[str, tuple[int, str]] = {
    "batido_tropical": (12119029, "tropical fruit smoothie with mint"),
    "salmon_horno_hierbas": (26763442, "baked salmon fillet with dill wrapped in foil"),
    "ensalada_atun_americana": (19572488, "tuna salad bowl lettuce tomato"),
    "ensalada_pollo_curry": (28841108, "curry chicken salad bowl"),
    "batido_platano_avena": (4311550, "banana oat smoothie glass"),
    "bacalao_verduras_horno": (5713767, "grilled fish fillet with vegetables"),
    "merluza_espinacas_vapor": (29203708, "fish fillet with spinach"),
    "atun_ensalada_pepino_ligera": (5950514, "tuna salad with vegetables and lemon"),
    "ensalada_kale_manzana": (4899800, "kale salad with walnuts"),
    "ensalada_alubias_aguacate": (6327667, "vegan salad with avocado and tomato"),
    "huevo_duro_pepino_sal": (15583294, "boiled eggs with fresh vegetables"),
    "lomo_cerdo_verduras_plancha": (36673992, "roasted pork loin with vegetables"),
    "pechuga_pollo_esparragos_ajo": (24868594, "grilled chicken breast with asparagus"),
    "queso_cottage_pina": (5836438, "toast with ricotta cheese and pineapple"),
    "rollitos_pavo_queso": (28584246, "ham rolls stuffed with cheese"),
    "tofu_revuelto_verduras": (6327660, "tofu scramble with vegetables"),
    "wrap_atun_aguacate": (9026808, "tuna wrap with vegetables"),
    "pechuga_pollo_verduras_vapor": (36936952, "grilled chicken breast with broccoli and carrots"),
    "atun_tomate_relleno": (13944575, "tuna salad with bell peppers"),
    "claras_huevo_champinones": (6003058, "eggs with mushrooms in a pan"),
    "claras_huevo_pavo_tostada": (12944792, "omelette breakfast with toast and cucumbers"),
    "hamburguesa_garbanzos": (13365029, "veggie patty with fresh tomatoes"),
    "jamon_melon_snack": (19409026, "prosciutto wrapped around melon"),
    "nueces_miel_snack": (12648313, "honey poured over yogurt with walnuts"),
    "pavo_queso_manzana_snack": (9670689, "rolled ham slices with apple slices"),
    "pollo_cebolla_caramelizada": (5695619, "caramelized chicken with rice"),
    "queso_curado_manzana": (18032214, "cheese and fruit platter with bread"),
    "revuelto_claras_pimiento_cebolla": (89238, "egg and bell pepper skillet"),
    "salmon_mostaza_horno": (7627414, "grilled salmon fillet and spinach"),
    "tofu_salteado_pimientos_vegano": (37297770, "stir fried tofu with eggplant and bell peppers"),
    "tostada_hummus_pepino": (36169881, "cucumbers tomatoes and hummus on a board"),
    "wrap_tempeh_verduras": (30392937, "vegetable wrap with greens and tomatoes"),
    "yogur_pina_snack": (1406573, "kiwi and pineapple slices topped with yogurt"),
}


def foto_por_id(key: str, id_foto: int) -> dict:
    peticion = urllib.request.Request(
        f"https://api.pexels.com/v1/photos/{id_foto}",
        headers={"Authorization": key, "User-Agent": "curl/8.0"},
    )
    with urllib.request.urlopen(peticion, timeout=15) as respuesta:
        return json.loads(respuesta.read())


def normalizar(texto: str) -> set[str]:
    sin_acentos = "".join(
        c for c in unicodedata.normalize("NFD", texto.lower())
        if unicodedata.category(c) != "Mn"
    )
    palabras = re.findall(r"[a-z]+", sin_acentos)
    return {p for p in palabras if p not in STOPWORDS and len(p) > 2}


def buscar(key: str, consulta: str, por_pagina: int = 20) -> list[dict]:
    parametros = {"query": f"{consulta} close up", "per_page": str(por_pagina)}
    url = f"https://api.pexels.com/v1/search?{urllib.parse.urlencode(parametros)}"
    # Cloudflare (delante de la API de Pexels) bloquea el user-agent por
    # defecto de urllib ("Python-urllib/3.x") con un 403 silencioso.
    peticion = urllib.request.Request(
        url,
        headers={"Authorization": key, "User-Agent": "curl/8.0"},
    )
    with urllib.request.urlopen(peticion, timeout=15) as respuesta:
        cuerpo = json.loads(respuesta.read())
    return cuerpo.get("photos", [])


def buscar_con_reintento(
    key: str, consulta: str, indice: int, total: int, rid: str
) -> list[dict]:
    """El límite de ráfaga de Pexels (aparte de la cuota mensual) se agota a
    mitad de un lote de 91 aunque cada petición espere `time.sleep` de sobra
    entre sí — pasó dos veces seguidas al preparar este catálogo. Un 429 aquí
    no es "sin resultados", es "espera y vuelve a preguntar"."""
    espera = 10.0
    for intento in range(6):
        try:
            return buscar(key, consulta)
        except urllib.error.HTTPError as error:
            if error.code != 429 or intento == 5:
                raise
            print(
                f"[{indice}/{total}] {rid}: 429, esperando {espera:.0f}s "
                f"(intento {intento + 1}/6)"
            )
            time.sleep(espera)
            espera = min(espera * 1.6, 60.0)
    raise AssertionError("inalcanzable")


def tiene_gente(alt: str) -> bool:
    return bool(normalizar(alt) & SIN_GENTE)


def luminancia(color_hex: str) -> float:
    """Percepción de claridad del `avg_color` que devuelve Pexels, 0-255."""
    color_hex = color_hex.lstrip("#")
    r, g, b = (int(color_hex[i : i + 2], 16) for i in (0, 2, 4))
    return 0.299 * r + 0.587 * g + 0.114 * b


def mejor_candidata(
    consulta: str, candidatas: list[dict], usadas: set[int]
) -> tuple[dict | None, int]:
    """Relevancia primero (coincidencia de palabras con la consulta), y sólo
    entre las que empatan en relevancia, la de fondo más claro — no al
    revés: una foto más clara pero del plato equivocado no sirve de nada."""
    palabras_consulta = normalizar(consulta)
    mejor = None
    mejor_clave: tuple[int, float] | None = None
    for candidata in candidatas:
        if candidata["id"] in usadas or tiene_gente(candidata.get("alt", "")):
            continue
        palabras_alt = normalizar(candidata.get("alt", ""))
        puntaje = len(palabras_consulta & palabras_alt)
        clave = (puntaje, luminancia(candidata.get("avg_color") or "#000000"))
        if mejor_clave is None or clave > mejor_clave:
            mejor_clave = clave
            mejor = candidata
    return mejor, (mejor_clave[0] if mejor_clave else 0)


def guardar(resultado: dict[str, dict]) -> None:
    with open(RUTA_SALIDA, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")


def main() -> None:
    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        print("Falta PEXELS_API_KEY en el entorno.", file=sys.stderr)
        sys.exit(1)
    # Pexels aplica, además de la cuota mensual, un límite de ráfaga corto
    # que un lote de 91 peticiones puede agotar a mitad de camino (429). Con
    # `--reanudar` la siguiente ejecución no repite lo que ya quedó bien: lee
    # `imagenes.json` tal cual está, se queda con esas entradas y sólo pide
    # las recetas que faltan.
    reanudar = "--reanudar" in sys.argv

    with open(RUTA_CONSULTAS_EN, encoding="utf-8") as f:
        consultas_en: dict[str, str] = json.load(f)

    with open(RUTA_RECETAS, encoding="utf-8") as f:
        datos = json.load(f)
    recetas = datos["recetas"] if isinstance(datos, dict) else datos

    resultado: dict[str, dict] = {}
    if reanudar and RUTA_SALIDA.exists():
        with open(RUTA_SALIDA, encoding="utf-8") as f:
            resultado = json.load(f)
        print(f"Reanudando con {len(resultado)} recetas ya resueltas.")

    revisar: list[str] = []
    fallidas: list[str] = []
    usadas: set[int] = {r["pexelsId"] for r in resultado.values()}

    for i, receta in enumerate(recetas):
        rid = receta["id"]
        if rid in resultado:
            continue

        if rid in FOTOS_FORZADAS:
            id_foto, consulta = FOTOS_FORZADAS[rid]
            try:
                foto = foto_por_id(key, id_foto)
            except Exception as error:  # noqa: BLE001
                print(f"[{i + 1}/{len(recetas)}] {rid}: ERROR {error}", file=sys.stderr)
                fallidas.append(rid)
                time.sleep(1.5)
                continue
            usadas.add(foto["id"])
            src = foto["src"]
            resultado[rid] = {
                "pexelsId": foto["id"],
                "url": src["large"],
                "urlGrande": src["large2x"],
                "ancho": foto["width"],
                "alto": foto["height"],
                "colorPromedio": foto.get("avg_color"),
                "alt": foto.get("alt", ""),
                "fotografo": foto["photographer"],
                "fotografoUrl": foto["photographer_url"],
                "consultaUsada": consulta,
                "puntajeCoincidencia": 3,
            }
            print(f"[{i + 1}/{len(recetas)}] {rid}: FORZADA — {foto.get('alt', '')[:70]}")
            guardar(resultado)
            time.sleep(0.6)
            continue

        consulta = CONSULTAS_REVISADAS.get(rid) or consultas_en.get(rid)
        if consulta is None:
            print(f"[{i + 1}/{len(recetas)}] {rid}: sin consulta en inglés, se salta")
            fallidas.append(rid)
            continue

        try:
            candidatas = buscar_con_reintento(key, consulta, i + 1, len(recetas), rid)
            elegida, puntaje = mejor_candidata(consulta, candidatas, usadas)
        except Exception as error:  # noqa: BLE001
            print(f"[{i + 1}/{len(recetas)}] {rid}: ERROR {error}", file=sys.stderr)
            fallidas.append(rid)
            time.sleep(1.5)
            continue

        if elegida is None:
            print(f"[{i + 1}/{len(recetas)}] {rid}: sin resultados aprovechables para {consulta!r}")
            fallidas.append(rid)
            time.sleep(0.4)
            continue

        usadas.add(elegida["id"])
        src = elegida["src"]
        resultado[rid] = {
            "pexelsId": elegida["id"],
            "url": src["large"],
            "urlGrande": src["large2x"],
            "ancho": elegida["width"],
            "alto": elegida["height"],
            "colorPromedio": elegida.get("avg_color"),
            "alt": elegida.get("alt", ""),
            "fotografo": elegida["photographer"],
            "fotografoUrl": elegida["photographer_url"],
            "consultaUsada": consulta,
            "puntajeCoincidencia": puntaje,
        }
        marca = "OK" if puntaje >= 2 else ("DUDOSO" if puntaje == 1 else "REVISAR")
        print(f"[{i + 1}/{len(recetas)}] {rid}: {marca}({puntaje}) — {elegida.get('alt', '')[:70]}")
        if puntaje < 2:
            revisar.append(rid)

        # Se guarda tras CADA receta, no sólo al final: un 429 a mitad de
        # lote (pasó una vez) no debe tirar el progreso ya conseguido, y
        # `--reanudar` necesita algo real que leer si el proceso muere aquí.
        guardar(resultado)
        time.sleep(0.6)

    guardar(resultado)

    print(f"\nEscrito {RUTA_SALIDA}: {len(resultado)} de {len(recetas)} recetas.")
    if revisar:
        print(f"\nA REVISAR/DUDOSO ({len(revisar)}) — puntaje < 2:")
        for rid in revisar:
            r = resultado[rid]
            print(f"  {rid} ({r['puntajeCoincidencia']}): {r['consultaUsada']!r} -> {r['alt']!r}")
    if fallidas:
        print(f"\nFALLIDAS ({len(fallidas)}): {fallidas}")


if __name__ == "__main__":
    main()
