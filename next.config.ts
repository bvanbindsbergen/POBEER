import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ccxt", "pg", "bcrypt"],
};

export default nextConfig;
