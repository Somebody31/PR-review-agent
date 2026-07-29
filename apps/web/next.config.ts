import type { NextConfig } from "next";

/**
 * Thin dashboard — all data comes from the Hono API (prefer API boundary).
 * No rewrite proxy for mutations; server actions call the API with the token.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
