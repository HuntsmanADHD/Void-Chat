/** @type {import('next').NextConfig} */
const nextConfig = {
  // React strict mode for better development experience
  reactStrictMode: true,

  // Enable experimental features
  experimental: {
    // Server Actions for form handling
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  // Image optimization configuration
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pbs.twimg.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'abs.twimg.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.ipfs.nftstorage.link',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'arweave.net',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.arweave.net',
        pathname: '/**',
      },
    ],
    // Allowed image domains (legacy, use remotePatterns for new projects)
    domains: [],
  },

  // Webpack configuration for Socket.io and Solana compatibility
  webpack: (config, { isServer }) => {
    // Handle Socket.io client-side
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        child_process: false,
        encoding: false,
      };
    }

    // Handle node: protocol imports (for Solana packages)
    config.resolve.alias = {
      ...config.resolve.alias,
      // Ensure proper module resolution
    };

    // Ignore optional peer dependencies warnings
    config.ignoreWarnings = [
      { module: /node_modules\/node-fetch/ },
      { module: /node_modules\/@solana/ },
    ];

    return config;
  },

  // Transpile specific packages that need it
  transpilePackages: [
    '@solana/wallet-adapter-base',
    '@solana/wallet-adapter-react',
    '@solana/wallet-adapter-react-ui',
    '@solana/wallet-adapter-wallets',
    '@solana/web3.js',
  ],

  // Headers for security and CORS
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://mainnet.helius-rpc.com https://*.helius-rpc.com https://api.mainnet-beta.solana.com wss://api.mainnet-beta.solana.com ws://localhost:3001 wss://localhost:3001; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // CORS headers for API routes
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Credentials',
            value: 'true',
          },
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET,DELETE,PATCH,POST,PUT,OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-wallet-address, x-wallet-signature, x-wallet-message',
          },
        ],
      },
    ];
  },

  // Redirects configuration
  async redirects() {
    return [
      // Example: Redirect old routes to new ones
      // {
      //   source: '/old-route',
      //   destination: '/new-route',
      //   permanent: true,
      // },
    ];
  },

  // Environment variables validation (runtime)
  env: {
    NEXT_PUBLIC_CLAWED_TOKEN_ADDRESS: 'ELusVXzUPHyAuPB3M7qemr2Y2KshiWnGXauK17XYpump',
  },

  // Output configuration
  output: 'standalone',

  // Powered by header (disable for security)
  poweredByHeader: false,

  // Compression
  compress: true,

  // Generate ETags for caching
  generateEtags: true,

  // Trailing slash configuration
  trailingSlash: false,

  // Logging configuration
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
};

export default nextConfig;
