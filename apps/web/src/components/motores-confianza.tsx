/**
 * `MotoresConfianza` — la señal de confianza real del producto.
 *
 * Un landing de fitness genérico pondría aquí perfiles de entrenador o
 * testimonios. PlanEat no tiene ni lo uno ni lo otro (docs/spec.md: «no somos
 * coaching»), así que la prueba de fiabilidad es la que existe de verdad: el
 * motor de generación está escrito dos veces a propósito —Python de
 * referencia, TypeScript de producción— y las cifras de paridad de
 * `README.md` (2.576 casos de función pura, 2.171 instancias del porcionador,
 * p95 de la diferencia de energía = 0) son datos del repositorio, no
 * marketing.
 *
 * Componente estático: no depende del motor ni del catálogo, así que no paga
 * su peso en el bundle del cliente.
 */

const MOTORES = [
  {
    etiqueta: "Motor de referencia",
    lenguaje: "Python",
    texto:
      "Corre en servidor con el solver simplex HiGHS. Es el patrón contra el que se mide todo lo demás: 2 576 casos de funciones puras deben coincidir con él cifra a cifra.",
  },
  {
    etiqueta: "Motor de producción",
    lenguaje: "TypeScript",
    texto:
      "Es el que genera tu plan ahora mismo, en el navegador. En 2 171 instancias del solver de porciones, la diferencia de energía frente a la referencia tiene un percentil 95 de cero kcal.",
  },
] as const;

export function MotoresConfianza() {
  return (
    <section className="mx-auto mt-16 w-full max-w-[1120px] border-t border-line pt-10 sm:mt-24">
      <h2 className="t-1">El mismo cálculo, comprobado dos veces</h2>
      <p className="mt-3 max-w-2xl text-pretty leading-relaxed text-text-2">
        El generador existe por duplicado a propósito: un motor de referencia
        en Python y un motor de producción en TypeScript que corre en tu
        navegador. En vez de pedirte que confíes, los enfrentamos entre sí
        antes de cada cambio, sin dar por hecho que coincidan.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {MOTORES.map((motor) => (
          <div
            key={motor.lenguaje}
            className="rounded-[var(--radius-lg)] border border-line bg-surface p-5 sm:p-6"
          >
            <p className="micro text-brand">{motor.lenguaje}</p>
            <h3 className="t-3 mt-1.5">{motor.etiqueta}</h3>
            <p className="mt-3 text-pretty leading-relaxed text-text-2">
              {motor.texto}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
