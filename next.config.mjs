/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'pbs.twimg.com', pathname: '/**' },
      { protocol: 'https', hostname: 'abs.twimg.com', pathname: '/**' },
      { protocol: 'https', hostname: '*.ipfs.nftstorage.link', pathname: '/**' },
      { protocol: 'https', hostname: 'arweave.net', pathname: '/**' },
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
      };
    }
    return config;
  },
  transpilePackages: [
    '@solana/wallet-adapter-base',
    '@solana/wallet-adapter-react',
    '@solana/wallet-adapter-react-ui',
    '@solana/wallet-adapter-wallets',
    '@solana/web3.js',
  ],
  env: {
    NEXT_PUBLIC_CLAWED_TOKEN_ADDRESS: 'ELusVXzUPHyAuPB3M7qemr2Y2KshiWnGXauK17XYpump',
  },
  output: 'standalone',
  poweredByHeader: false,
};

export default nextConfig;
