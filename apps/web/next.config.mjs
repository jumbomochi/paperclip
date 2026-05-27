/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@paperclip/db'],
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000'] },
  },
};
export default nextConfig;
