import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/api/[...slug]": ["./satzung_schiri.md"],
  },
};

export default nextConfig;
