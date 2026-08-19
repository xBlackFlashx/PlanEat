"""Contrato HTTP del servicio solver.

Estos modelos son el espejo de `packages/shared/src/types.ts`. Cualquier cambio
aquí obliga a actualizar el lado TypeScript: no hay generación automática todavía
(está en el roadmap, fase 1).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Sexo = Literal["hombre", "mujer"]
TipoDieta = Literal[
    "omnivora",
    "vegetariana",
    "vegana",
    "pescetariana",
    "baja_en_carbohidratos",
    "mediterranea",
]
SlotComida = Literal["desayuno", "almuerzo", "comida", "merienda", "cena"]
Alergeno = Literal[
    "gluten",
    "crustaceos",
    "huevos",
    "pescado",
    "cacahuetes",
    "soja",
    "lacteos",
    "frutos_de_cascara",
    "apio",
    "mostaza",
    "sesamo",
    "sulfitos",
    "altramuces",
    "moluscos",
    "paprika",
    "vainilla",
    "sal",
    "miel",
    "mayonesa",
    "vinagre",
    "pesto",
    "mermelada",
    "tofu",
    "tempeh",
    "salsa",
    "azafran",
    "clavo",
    "anis",
    "cardamomo",
    "nuez_moscada",
    "azucar",
    "catsup",
    "mole",
    "hummus",
    "guacamole",
    "cajeta",
    "chocolate",
    "cacao",
    "gelatina",
    "seitan",
    "proteina",
    "cafe",
    "te",
    "huevo",
    "pollo",
    "pavo",
    "res",
    "cerdo",
    "cordero",
    "conejo",
    "pato",
    "codorniz",
    "ternera",
    "bistec",
    "filete",
    "costilla",
    "chuleta",
    "jamon",
    "tocino",
    "salchicha",
    "chorizo",
    "cecina",
    "carne",
    "higado",
    "atun",
    "salmon",
    "sardina",
    "trucha",
    "tilapia",
    "bacalao",
    "merluza",
    "robalo",
    "huachinango",
    "mojarra",
    "camaron",
    "langosta",
    "cangrejo",
    "pulpo",
    "calamar",
    "ostion",
    "almeja",
    "mejillon",
    "cacahuate",
    "almendra",
    "nuez",
    "pistache",
    "avellana",
    "macadamia",
    "castana",
    "nuezpecana",
    "pinon",
    "chia",
    "linaza",
    "ajonjoli",
    "girasol",
    "pepita",
    "canamo",
    "amaranto",
    "manzana",
    "platano",
    "naranja",
    "mandarina",
    "limon",
    "lima",
    "toronja",
    "uva",
    "fresa",
    "frambuesa",
    "zarzamora",
    "arandano",
    "cereza",
    "durazno",
    "nectarina",
    "ciruela",
    "pera",
    "mango",
    "papaya",
    "pina",
    "sandia",
    "melon",
    "kiwi",
    "guayaba",
    "granada",
    "higo",
    "datil",
    "coco",
    "maracuya",
    "lichi",
    "carambola",
    "pitahaya",
    "tuna",
    "mamey",
    "zapote",
    "guanabana",
    "chirimoya",
    "tejocote",
    "tamarindo",
    "membrillo",
    "persimon",
    "grosella",
    "acerola",
    "rambutan",
    "lechuga",
    "espinaca",
    "acelga",
    "col",
    "kale",
    "arugula",
    "berro",
    "brocoli",
    "coliflor",
    "zanahoria",
    "jitomate",
    "tomate",
    "pepino",
    "calabaza",
    "calabacita",
    "chayote",
    "berenjena",
    "pimiento",
    "chile",
    "jalapeno",
    "serrano",
    "poblano",
    "habanero",
    "cebolla",
    "ajo",
    "nopal",
    "rabano",
    "betabel",
    "esparrago",
    "alcachofa",
    "poro",
    "jicama",
    "ejote",
    "elote",
    "champinon",
    "hongo",
    "coles",
    "endivia",
    "escarola",
    "quelite",
    "verdolaga",
    "huauzontle",
    "frijol",
    "lenteja",
    "garbanzo",
    "chicharo",
    "haba",
    "soya",
    "alubia",
    "edamame",
    "arroz",
    "avena",
    "trigo",
    "maiz",
    "cebada",
    "centeno",
    "quinoa",
    "mijo",
    "sorgo",
    "espelta",
    "bulgur",
    "cuscus",
    "farro",
    "papa",
    "camote",
    "yuca",
    "name",
    "malanga",
    "tapioca",
    "leche",
    "queso",
    "yogur",
    "crema",
    "mantequilla",
    "requeson",
    "jocoque",
    "kefir",
    "cuajada",
    "ricotta",
    "mozzarella",
    "manchego",
    "cheddar",
    "parmesano",
    "gouda",
    "cottage",
    "panela",
    "pan",
    "tortilla",
    "tostada",
    "bolillo",
    "telera",
    "baguette",
    "bagel",
    "croissant",
    "galleta",
    "granola",
    "cereal",
    "pasta",
    "espagueti",
    "macarron",
    "fideo",
    "lasana",
    "aguacate",
    "aceituna",
    "oliva",
    "aceite",
    "manteca",
    "tahini",
    "cilantro",
    "perejil",
    "albahaca",
    "oregano",
    "romero",
    "tomillo",
    "menta",
    "hierbabuena",
    "eneldo",
    "laurel",
    "salvia",
    "estragon",
    "curcuma",
    "jengibre",
    "canela",
    "pimienta",
    "comino",
]


class Rango(BaseModel):
    min: float
    max: float


class ObjetivoNutricional(BaseModel):
    kcal: float
    toleranciaKcal: float = 0.03
    proteinaG: Rango
    carbohidratoG: Rango
    grasaG: Rango
    fibraMinG: float = 0
    sodioMaxMg: float | None = None


class RestriccionesGeneracion(BaseModel):
    dieta: TipoDieta = "omnivora"
    alergenosExcluidos: list[Alergeno] = Field(default_factory=list)
    ingredientesExcluidos: list[str] = Field(default_factory=list)
    slots: list[SlotComida]
    minutosMaxPorSlot: dict[SlotComida, int] | None = None
    comensales: int = 1
    presupuestoSemanalCents: int | None = None
    despensaAlimentoIds: list[str] = Field(default_factory=list)
    recetasRecientes: list[str] = Field(default_factory=list)


class SolicitudGeneracion(BaseModel):
    objetivos: list[ObjetivoNutricional]
    restricciones: RestriccionesGeneracion
    seed: int | None = None


class TotalesNutricionales(BaseModel):
    """Totales ya servidos de una comida o de un día. NO es un panel por 100 g.

    El mismo modelo se usaba antes para las dos cosas y la web acabó leyendo
    `salG` de un total del día, campo que este servicio no emite ni puede emitir
    (no tiene sal por receta, tiene sodio). Espejo de `TotalesNutricionales` de
    `packages/shared/src/types.ts`.

    `fibraG` y `sodioMg` son anulables porque `None` afirma algo —«este total no
    es fiable»— y omitirlos dejaría leer un total parcial como total (§8.5).
    """

    kcal: float
    proteinaG: float
    carbohidratoG: float
    grasaG: float
    fibraG: float | None = None
    sodioMg: float | None = None


class ItemPlan(BaseModel):
    recetaId: str
    factorRacion: float
    bloqueado: bool = False


class ComidaPlan(BaseModel):
    slot: SlotComida
    items: list[ItemPlan]
    totales: TotalesNutricionales


class DiaPlan(BaseModel):
    fecha: str
    comidas: list[ComidaPlan]
    totales: TotalesNutricionales
    objetivo: ObjetivoNutricional


class FalloGeneracion(BaseModel):
    """Un fallo del solver explica qué restricción ata, nunca un error genérico.

    La UI convierte `sugerencias` en botones de acción concreta.
    """

    restriccionCulpable: str
    mensaje: str
    recetasCandidatas: int
    sugerencias: list[str]


class RespuestaOk(BaseModel):
    """Plan generado, con todo lo necesario para volver a generarlo.

    Los cinco campos que siguen a `msTranscurridos` viajaban en cabeceras
    (`X-PlanEat-Seed`, `-Catalogo`, `-Generador`, `-Pool`). El motor del
    navegador no tiene servidor ni cabeceras, así que sin traerlos al payload un
    plan guardado o compartido deja de ser reproducible: exactamente el fallo
    indepurable contra el que avisa el docstring de `main.py`. Los dos motores
    emiten el mismo contrato; las cabeceras se mantienen por compatibilidad.
    """

    ok: Literal[True] = True
    dias: list[DiaPlan]
    msTranscurridos: int
    # Decimal y como CADENA: son 63 bits y un JSON con `number` los redondea en
    # silencio al pasar por un lector de 53 bits (JavaScript). Un plan cuya
    # semilla se ha redondeado no se puede volver a generar y nada falla al
    # hacerlo, que es la peor combinación posible.
    seed: str
    versionCatalogo: str
    versionGenerador: str
    pool: int
    # El pool se quedó corto por lo corto del catálogo, no por los filtros del
    # usuario (puerta 3 de §6.0): el plan vale, la variedad está limitada, y la
    # culpa no es de quien lo pidió.
    catalogoEstrecho: bool = False


class RespuestaError(BaseModel):
    ok: Literal[False] = False
    fallo: FalloGeneracion
