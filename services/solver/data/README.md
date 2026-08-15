# Catálogo

> **Catálogo semilla de desarrollo, no el catálogo de producto.** Sirve para que
> el solver funcione de punta a punta y para que los tests sean reales. El
> catálogo de producto (≈130 ingredientes, 60-80 recetas con fotografía y
> revisión de dietista) es una partida aparte del roadmap.

## Los tres ficheros

| Fichero | Qué es | Se edita |
|---|---|---|
| `ingredientes.json` | Hechos nutricionales por 100 g, con fuente citada | A mano |
| `recetas.json` | Lo que decide un humano: qué lleva, cómo se hace, cuándo | A mano |
| `catalogo.jsonl` | Lo único que lee el solver | **Generado** |

Tras tocar cualquiera de los dos primeros:

```bash
python scripts/construir_catalogo.py
pytest tests/test_catalogo.py
```

## Qué se deriva y por qué

Nada derivable se escribe a mano. `construir_catalogo.py` calcula:

- **La nutrición**, desde los ingredientes y sus gramos. Escribirla en la receta
  permitiría que se desincronizara en silencio al cambiar una cantidad.
- **Los alérgenos**, como unión de los de sus ingredientes. Aquí un olvido
  humano no es un fallo de datos, es un riesgo de daño real.
- **Las dietas**, desde el origen de los ingredientes y los macros calculados.
  Que alguien marque «vegana» a mano una receta con miel es cuestión de tiempo.
- **El coste**, desde los formatos de compra.

El script también avisa si la kcal calculada se aparta más de un 15 % de la
fórmula de Atwater (4P + 4C + 9G): casi siempre significa un gramaje mal
tecleado.

## Convenciones

**Los paneles son por 100 g de porción comestible.** El campo `estado` dice si
el valor corresponde al alimento crudo, cocido o en conserva, y los gramos de
las recetas deben ser coherentes con él: el arroz se pesa crudo, las lentejas
de bote escurridas.

**Los gramos de cada receta son por ración base.** Si `racionesBase` es 2, los
ingredientes son para las dos y el script divide.

## Procedencia de los datos

Los valores nutricionales de alimentos son datos de referencia pública —hechos,
no obra protegida— tomados de USDA FoodData Central, BEDCA y CIQUAL. Cada
ingrediente cita su fuente.

Las recetas son preparaciones caseras estándar redactadas para este proyecto. No
proceden de ningún sitio web ni base de datos de terceros.

**Ninguna receta ha sido revisada por un dietista.** `revisadaPor` va a `null` en
todo el catálogo generado y debe seguir así hasta que exista revisión real y
firmada. Marcarlas como revisadas sin que lo estén sería grave: el usuario
asumiría una garantía profesional que nadie ha dado.

Los precios son estimaciones orientativas para España. Sirven para probar el
término de coste del solver, **no para mostrárselos al usuario**.

## Cobertura actual

36 recetas · 73 ingredientes.

| Dimensión | Cobertura |
|---|---|
| Slots | desayuno 11 · comida 21 · cena 22 · merienda 9 · almuerzo 8 |
| Dietas | omnívora 36 · pescetariana 29 · mediterránea 24 · vegetariana 21 · baja en carbohidratos 10 · vegana 8 |
| Proteína alta y grasa baja | 10 |

Esa última fila es la que más importa: es el hueco que vuelve infactibles los
problemas de programación lineal cuando el objetivo proteico es exigente. Los
tests fallan si baja de 6.
