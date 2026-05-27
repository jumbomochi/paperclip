/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@paperclip/db'],
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000'] },
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};
export default nextConfig;
