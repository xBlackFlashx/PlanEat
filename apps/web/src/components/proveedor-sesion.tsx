"use client";

import { SessionProvider } from "next-auth/react";

export function ProveedorSesion({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
