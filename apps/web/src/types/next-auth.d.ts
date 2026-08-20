import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      esAdmin: boolean;
      tier: "FREE" | "PRO";
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    esAdmin?: boolean;
    tier?: "FREE" | "PRO";
  }
}
