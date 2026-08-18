-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "EstadoSuscripcion" AS ENUM ('activa', 'en_gracia', 'cancelada', 'impago');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT,
    "esAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suscripciones" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "Tier" NOT NULL DEFAULT 'FREE',
    "estado" "EstadoSuscripcion" NOT NULL DEFAULT 'cancelada',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "finPeriodoActual" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suscripciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generaciones_plan" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "tier" "Tier" NOT NULL,
    "dias" INTEGER NOT NULL,
    "slots" INTEGER NOT NULL,
    "dieta" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "restriccionCulpable" TEXT,
    "msTranscurridos" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generaciones_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planes_semana" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "semanaDelDia" TIMESTAMP(3) NOT NULL,
    "respuestaJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planes_semana_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametros" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parametros_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "suscripciones_userId_key" ON "suscripciones"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "suscripciones_stripeCustomerId_key" ON "suscripciones"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "suscripciones_stripeSubscriptionId_key" ON "suscripciones"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "generaciones_plan_createdAt_idx" ON "generaciones_plan"("createdAt");

-- CreateIndex
CREATE INDEX "generaciones_plan_tier_idx" ON "generaciones_plan"("tier");

-- CreateIndex
CREATE INDEX "planes_semana_userId_semanaDelDia_idx" ON "planes_semana"("userId", "semanaDelDia");

-- AddForeignKey
ALTER TABLE "suscripciones" ADD CONSTRAINT "suscripciones_userId_fkey" FOREIGN KEY ("userId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generaciones_plan" ADD CONSTRAINT "generaciones_plan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planes_semana" ADD CONSTRAINT "planes_semana_userId_fkey" FOREIGN KEY ("userId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
