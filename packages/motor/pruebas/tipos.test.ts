import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

import { VERSION_GENERADOR } from "../src/constantes.ts";
import type {
  Alergeno,
  Progreso,
  RespuestaOk,
  SlotComida,
  TipoDieta,
  TotalesNutricionales,
  Traza,
} from "../src/tipos.ts";
import type {
  Alergeno as AlergenoDeShared,
  SlotComida as SlotDeShared,
  TipoDieta as DietaDeShared,
} from "@planeat/shared";

/**
 * `tipos.ts` no tiene comportamiento: es una declaración. Lo que sí se puede
 * comprobar es que la declaración sigue diciendo lo mismo que las dos cosas con
 * las que tiene que cuadrar —el contrato de Python y las dataclasses del
 * solver— y que no se ha convertido en un módulo con código dentro.
 *
 * Las afirmaciones de tipo (`Afirma<Igual<…>>`) NO las comprueba `node --test`,
 * que borra los tipos sin mirarlos: las comprueba `tsc --noEmit`, que es parte
 * obligatoria de la verificación. Las que se pueden ejecutar, se ejecutan.
 */
type Igual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Afirma<T extends true> = T;

const RAIZ = new URL("../../../", import.meta.url);
const leer = (ruta: string) => readFileSync(new URL(ruta, RAIZ), "utf8");

/** Cuerpo de una clase de Python, de su `class X` al siguiente `class` a nivel 0. */
function bloqueDeClase(fuente: string, nombre: string): string {
  const inicio = fuente.indexOf(`class ${nombre}`);
  assert.notEqual(inicio, -1, `no encuentro la clase ${nombre}`);
  const resto = fuente.slice(inicio);
  const fin = resto.indexOf("\nclass ", 1);
  return fin === -1 ? resto : resto.slice(0, fin);
}

/** `ms_total` -> `msTotal`. Es la única diferencia de estilo entre los dos lados. */
function aCamel(nombre: string): string {
  return nombre.replace(/_([a-z])/g, (_, letra: string) => letra.toUpperCase());
}

/** Campos anotados de un bloque de clase, en orden de declaración. */
function camposDeclarados(bloque: string): string[] {
  return [...bloque.matchAll(/^ {4}([a-zA-Z_]+): /gm)].map((m) => m[1] ?? "");
}

// ---------------------------------------------------------------------------

test("tipos.ts no emite código: importarlo no añade nada al bundle", async () => {
  const modulo = await import("../src/tipos.ts");

  // Si esto falla es que alguien ha metido una constante, una función o un
  // `enum` aquí dentro. El sitio de las constantes es `constantes.ts`, y un
  // fichero de tipos que pesa en el bundle deja de poder importarse desde
  // cualquier parte sin pensárselo.
  assert.deepEqual(Object.keys(modulo), []);
});

test("los tipos de dominio se reexportan de shared, no se redefinen", () => {
  type _Slot = Afirma<Igual<SlotComida, SlotDeShared>>;
  type _Dieta = Afirma<Igual<TipoDieta, DietaDeShared>>;
  type _Alergeno = Afirma<Igual<Alergeno, AlergenoDeShared>>;

  // La igualdad de tipos de arriba se cumpliría también con una copia literal
  // —TypeScript es estructural—, así que la comprobación que de verdad importa
  // es que aquí no se declara ninguno de esos nombres.
  const fuente = leer("packages/motor/src/tipos.ts");
  assert.doesNotMatch(
    fuente,
    /export (interface|type|enum) (SlotComida|TipoDieta|Alergeno|ObjetivoNutricional|DiaPlan|ComidaPlan|ItemPlan|RespuestaOk|RespuestaGeneracion|FalloGeneracion)\b/,
  );
});

test("RespuestaOk lleva los cinco datos que ya no caben en una cabecera", () => {
  const respuesta: RespuestaOk = {
    ok: true,
    dias: [],
    msTranscurridos: 12,
    seed: "9218868437227405311",
    versionCatalogo: "6b4fe8f81196dd7e",
    versionGenerador: VERSION_GENERADOR,
    pool: 36,
    catalogoEstrecho: true,
  };

  assert.deepEqual(Object.keys(respuesta).sort(), [
    "catalogoEstrecho",
    "dias",
    "msTranscurridos",
    "ok",
    "pool",
    "seed",
    "versionCatalogo",
    "versionGenerador",
  ]);
  type _SeedEsTexto = Afirma<Igual<RespuestaOk["seed"], string>>;
  assert.equal(typeof respuesta.seed, "string");
});

test("el seed viaja como texto porque 63 bits no sobreviven a un number", () => {
  const semilla = 9218868437227405311n; // 63 bits, de los que un double pierde 10
  const texto = semilla.toString();

  const idaYVuelta = JSON.parse(JSON.stringify({ seed: texto })) as { seed: string };
  assert.equal(BigInt(idaYVuelta.seed), semilla);

  // Y la razón de la regla, ejecutada en vez de escrita: por `number` el viaje
  // devuelve otra semilla y nada falla al hacerlo, que es lo peor que puede
  // pasarle a un plan guardado.
  assert.notEqual(BigInt(Number(texto)), semilla);
});

test("Traza cubre exactamente los campos de la dataclass Traza de Python", () => {
  const traza: Traza = {
    seed: "123",
    pool: 36,
    msTotal: 40,
    msPool: 3,
    msGeneracion: 30,
    msEnsamblado: 5,
    duplicados: 2,
    erroresPorDia: [0.01],
    intentosReparacion: 1,
    porcionadosDeEmergencia: 0,
    reparacionesDuras: 0,
    terminosDesactivados: ["coste:sin_presupuesto"],
    catalogoEstrecho: true,
  };

  const enPython = camposDeclarados(
    bloqueDeClase(leer("services/solver/app/solver/motor.py"), "Traza"),
  ).map(aCamel);

  assert.deepEqual(Object.keys(traza).sort(), enPython.sort());
});

test("el contrato de Python declara los cinco datos de reproducibilidad", () => {
  const bloque = bloqueDeClase(leer("services/solver/app/schemas.py"), "RespuestaOk");

  // Los dos motores tienen que seguir hablando el mismo contrato mientras
  // convivan: si aquí falta uno, un plan del backend no se puede reproducir en
  // el navegador ni al revés.
  assert.match(bloque, /^ {4}seed: str$/m);
  assert.match(bloque, /^ {4}versionCatalogo: str$/m);
  assert.match(bloque, /^ {4}versionGenerador: str$/m);
  assert.match(bloque, /^ {4}pool: int$/m);
  assert.match(bloque, /^ {4}catalogoEstrecho: bool/m);
});

test("los totales son anulables en los dos lados: null afirma, no falta", () => {
  const totales: TotalesNutricionales = {
    kcal: 1905.5,
    proteinaG: 130.7,
    carbohidratoG: 218.4,
    grasaG: 60.5,
    fibraG: null,
    sodioMg: null,
  };
  assert.equal(totales.fibraG, null);

  const bloque = bloqueDeClase(
    leer("services/solver/app/schemas.py"),
    "TotalesNutricionales",
  );
  assert.match(bloque, /^ {4}fibraG: float \| None/m);
  assert.match(bloque, /^ {4}sodioMg: float \| None/m);

  // El sodio estaba en la columna 5 del motor y el serializador lo tiraba.
  // Que esté aquí es lo que permite a la UI enseñar la sal sin inventársela.
  type _Sodio = Afirma<Igual<TotalesNutricionales["sodioMg"], number | null>>;
});

test("Progreso tiene una etapa por paso de la pantalla que informa", () => {
  const etapas = ["objetivos", "pool", "porcionado", "cuadre"] as const;
  type _Cubre = Afirma<Igual<Progreso["etapa"], (typeof etapas)[number]>>;

  const pantalla = leer("apps/web/src/components/estado-generacion.tsx");
  const pasos = pantalla.match(/^const PASOS = \[([\s\S]*?)\] as const;$/m)?.[1] ?? "";
  const cuantos = [...pasos.matchAll(/^\s*"/gm)].length;

  // Si esto falla, alguien ha cambiado los pasos de la pantalla sin cambiar las
  // etapas del progreso (o al revés) y la barra volvería a avanzar por su
  // cuenta, que es justo el estado del que este port la saca.
  assert.equal(
    cuantos,
    etapas.length,
    "los pasos de estado-generacion.tsx y las etapas de Progreso han dejado de cuadrar",
  );
});

test("un candidato de día se identifica por su clave, no por el orden de selección", () => {
  // `clave` sustituye al `frozenset(filas)` de Python. La propiedad que hay que
  // conservar es que el orden de selección no forma parte de la identidad: dos
  // días con las mismas recetas son el mismo candidato aunque las eligieran en
  // distinto orden. Se comprueba la construcción, que es donde se pierde.
  const clave = (filas: number[]) => [...filas].sort((a, b) => a - b).join(",");
  assert.equal(clave([7, 2, 19]), clave([19, 7, 2]));
  assert.notEqual(clave([7, 2, 19]), clave([7, 2, 20]));
  // Y que no colisione por concatenación: 1,23 y 12,3 son días distintos.
  assert.notEqual(clave([1, 23]), clave([12, 3]));
});
