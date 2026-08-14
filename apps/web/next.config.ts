import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El paquete compartido se distribuye como TypeScript sin compilar: es un
  // workspace interno, no un paquete publicado.
  transpilePackages: ["@planeat/shared"],

  typedRoutes: true,
};

export default nextConfig;
