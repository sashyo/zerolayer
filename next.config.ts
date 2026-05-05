import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/channels/@me",
        destination: "/channels/me",
        permanent: false,
      },
      {
        source: "/channels/@me/:path*",
        destination: "/channels/me/:path*",
        permanent: false,
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
  // Custom server handles serving — disable standalone output conflicts
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
