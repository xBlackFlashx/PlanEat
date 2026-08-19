/**
 * Categorías de alérgenos, para excluir de golpe en vez de uno a uno.
 *
 * `Alergeno` (`@planeat/shared`) tiene 267 valores porque cubre además el
 * catálogo de exclusiones libres (frutas, verduras, panes, tubérculos
 * sueltos…). Nadie excluye "toda la fruta" como alergia real, así que sólo
 * se agrupan aquí los 131 que sí responden a una categoría de exclusión con
 * sentido — "Pescados y mariscos", "Cerdo en cualquier presentación" — y el
 * resto se queda sólo en la búsqueda libre de `CampoAutocompletar`, a
 * propósito.
 *
 * La taxonomía está curada a mano contra `ALERGENOS` de
 * `packages/motor/src/constantes.ts` (el vocabulario REAL que el motor filtra):
 * no tiene sentido ofrecer una categoría que agrupe ids que ningún filtro usa.
 *
 * Mismo estilo que `ALERGENOS` en `constantes.ts`: `satisfies` en vez de una
 * anotación suelta, para que un id mal escrito falle en compilación —no en
 * producción— y para que, si `Alergeno` cambia de forma, el error de tipo
 * señale exactamente esta lista como huérfana.
 */

import type { Alergeno } from "@planeat/shared";

export const CATEGORIAS_ALERGENO = {
  "Pescados y mariscos": [
    "pescado",
    "crustaceos",
    "moluscos",
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
  ],
  "Cerdo, en cualquier presentación": ["cerdo", "tocino", "jamon", "chorizo", "cecina"],
  "Pollo y aves": ["pollo", "pavo", "pato", "codorniz"],
  "Res y otras carnes rojas": [
    "res",
    "ternera",
    "cordero",
    "conejo",
    "bistec",
    "filete",
    "costilla",
    "chuleta",
    "carne",
    "higado",
  ],
  Lácteos: [
    "lacteos",
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
  ],
  Huevo: ["huevos", "huevo"],
  "Frutos secos y cacahuate": [
    "frutos_de_cascara",
    "cacahuetes",
    "cacahuate",
    "almendra",
    "nuez",
    "pistache",
    "avellana",
    "macadamia",
    "castana",
    "nuezpecana",
    "pinon",
  ],
  Semillas: ["sesamo", "chia", "linaza", "ajonjoli", "girasol", "pepita", "canamo", "amaranto"],
  "Soya y derivados": ["soja", "tofu", "tempeh", "seitan", "edamame", "soya"],
  "Gluten y cereales con gluten": ["gluten", "trigo", "cebada", "centeno", "espelta", "bulgur"],
  "Condimentos y salsas": [
    "salsa",
    "mole",
    "hummus",
    "guacamole",
    "catsup",
    "vinagre",
    "pesto",
    "mermelada",
    "mayonesa",
    "mostaza",
    "miel",
    "cajeta",
    "sulfitos",
    "altramuces",
  ],
  "Especias y hierbas": [
    "paprika",
    "vainilla",
    "azafran",
    "clavo",
    "anis",
    "cardamomo",
    "nuez_moscada",
    "canela",
    "comino",
    "pimienta",
    "curcuma",
    "oregano",
    "romero",
    "tomillo",
    "laurel",
    "salvia",
    "estragon",
    "jengibre",
    "cilantro",
    "perejil",
    "albahaca",
    "menta",
    "hierbabuena",
    "eneldo",
    "sal",
    "azucar",
  ],
} as const satisfies Record<string, readonly Alergeno[]>;
