# Puesta en marcha: cuentas, Pro, Stripe, admin, Vercel

Esta parte del proyecto (todo lo que no sea el generador gratis de un día) es
nueva y necesita servidor: Postgres, Auth.js, Stripe y un panel en `/admin`.
Este documento es el paso a paso completo, de cero a desplegado.

## 1. Local: base de datos

Necesitas Postgres corriendo en local. Con Homebrew (macOS):

```bash
brew install postgresql@16
brew services start postgresql@16
createdb planeat_dev
```

Con cualquier otro Postgres (Docker, un paquete del sistema, etc.) basta con
tener una base de datos vacía y su cadena de conexión.

## 2. Variables de entorno

```bash
cd apps/web
cp .env.example .env
```

Rellena `.env`:

- `DATABASE_URL` — la cadena de conexión de arriba, algo como
  `postgresql://TU_USUARIO@localhost:5432/planeat_dev?schema=public`.
- `AUTH_SECRET` — genera uno con `openssl rand -base64 32`. Firma las cookies
  de sesión; sin él, Auth.js no arranca.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — con qué credenciales se siembra el único
  usuario administrador (ver paso 4). Cámbialas antes de sembrar en producción.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO` — vacías
  por defecto. Sin ellas, el botón "Pasar a Pro" responde con un error claro en
  vez de fingir que cobra. Ver § Stripe más abajo para rellenarlas.
- `NEXT_PUBLIC_PRECIO_PRO_MXN` — el precio que se enseña en las tarjetas de
  `/precios` (hoy `99`). Es sólo texto para la UI: el cobro real lo define el
  precio que crees en el dashboard de Stripe (`STRIPE_PRICE_ID_PRO`), así que
  si cambias uno cambia el otro a mano.

## 3. Esquema y cliente Prisma

```bash
cd apps/web
npm run db:migrar   # aplica las migraciones versionadas en prisma/migrations/
npm run db:generar  # regenera el cliente (npm install ya lo hace por su cuenta
                     # via el script "postinstall", esto es sólo para forzarlo)
```

## 4. El usuario admin

```bash
cd apps/web
npm run db:seed
```

Crea (o promueve a admin, si ya existía) al usuario con `ADMIN_EMAIL` /
`ADMIN_PASSWORD`. Entra en `/entrar` con esas credenciales y `/admin` queda
accesible. Es idempotente: puedes volver a correrlo para recuperar el acceso si
pierdes la contraseña.

## 5. Arrancar

```bash
npm run dev   # desde la raíz del monorepo, o `npm run dev` dentro de apps/web
```

`http://localhost:3000` — el generador gratis funciona igual que siempre, sin
nada de lo de arriba. `/precios`, `/entrar`, `/registro`, `/semana` y `/admin`
sí necesitan los pasos 1-4.

## 6. Stripe (modo prueba)

No hace falta para desarrollar ni para ver la UI — sin configurar, el checkout
responde con un error legible ("El cobro con tarjeta aún no está activo..."),
no con una pantalla rota. Para activarlo de verdad, en modo prueba (sin riesgo
de cobros reales):

1. Crea una cuenta en <https://dashboard.stripe.com/register> si no tienes una.
2. Con el dashboard en **modo prueba** (interruptor arriba a la derecha),
   crea un producto — "PlanEat Pro", precio recurrente mensual, el importe que
   quieras (ideal: que coincida con `NEXT_PUBLIC_PRECIO_PRO_MXN`, moneda MXN si
   tu cuenta la soporta). Copia el **Price ID** (`price_...`) a
   `STRIPE_PRICE_ID_PRO`.
3. En **Developers → API keys**, copia la **Secret key** de modo prueba
   (`sk_test_...`) a `STRIPE_SECRET_KEY`.
4. Para el webhook en local, instala la [Stripe CLI](https://docs.stripe.com/stripe-cli)
   y corre:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
   Te da un `whsec_...` — pégalo en `STRIPE_WEBHOOK_SECRET`. En producción
   (Vercel), el webhook se configura desde el dashboard de Stripe apuntando a
   `https://tu-dominio/api/stripe/webhook` y ese endpoint tiene su propio
   `whsec_...`, distinto del de la CLI.
5. Reinicia `npm run dev`. El botón "Pasar a Pro" de `/precios` ya abre un
   checkout real (de prueba): usa la [tarjeta de prueba de Stripe](https://docs.stripe.com/testing)
   `4242 4242 4242 4242`, cualquier fecha futura y CVC.

El flujo completo: `/precios` → botón Pro → `/api/checkout` crea una sesión de
Stripe Checkout → el usuario paga → Stripe llama a `/api/stripe/webhook` →
la tabla `Suscripcion` se actualiza a `tier: PRO` → `/semana` queda accesible.

## 7. Desplegar en Vercel

El proyecto dejó de ser un export estático (GitHub Pages ya no sirve para
esto — no hay servidor ahí). Vercel es el camino recomendado para Next.js con
API routes, Auth.js y webhooks de Stripe:

1. En <https://vercel.com>, "Add New… → Project" e importa este repositorio.
   **Root Directory: `apps/web`** (es un monorepo con npm workspaces; Vercel
   detecta Next.js automáticamente ahí).
2. Base de datos: crea un Postgres gestionado — Neon o Vercel Postgres son las
   opciones más simples desde la propia integración de Vercel ("Storage" en el
   dashboard del proyecto) — y copia su cadena de conexión a `DATABASE_URL` en
   las variables de entorno del proyecto en Vercel.
3. Añade el resto de variables de entorno del paso 2 (`AUTH_SECRET`,
   `ADMIN_EMAIL`, `ADMIN_PASSWORD`, las tres de Stripe con las llaves reales o
   de prueba, `NEXT_PUBLIC_PRECIO_PRO_MXN`) en Settings → Environment Variables.
4. Antes del primer deploy (o tras el primero, por SSH/CLI de Vercel), corre
   las migraciones contra esa base de datos:
   ```bash
   DATABASE_URL="<la de Vercel/Neon>" npx prisma migrate deploy
   DATABASE_URL="<la de Vercel/Neon>" ADMIN_EMAIL=... ADMIN_PASSWORD=... npx tsx prisma/seed.ts
   ```
   (desde `apps/web`, con las variables reales — `migrate deploy` es la versión
   no interactiva de `migrate dev`, pensada exactamente para esto).
5. Vercel construye y publica automáticamente en cada push a `main` a partir de
   aquí — no hace falta ningún paso de GitHub Actions para el despliegue
   (`.github/workflows/ci.yml` sólo verifica: typecheck, lint, tests).
6. En el dashboard de Stripe, añade el endpoint de webhook de producción
   apuntando a `https://tu-dominio.vercel.app/api/stripe/webhook` (§6, paso 4)
   y pon ese `whsec_...` como `STRIPE_WEBHOOK_SECRET` en Vercel.

## Qué NO hace falta tocar

El generador gratis (`/`, `/plan`) sigue funcionando exactamente igual que
antes de todo esto: corre en el navegador, sin base de datos, sin sesión, sin
Stripe. Si algo de lo de arriba falla o no está configurado, esa parte del
producto no se entera.
