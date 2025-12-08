/**
 * NextAuth.js API Route Handler for X/Twitter OAuth
 *
 * This route handles the X OAuth flow for account linking.
 * Important: X auth is a VERIFICATION layer only - it does NOT
 * replace wallet-based authentication.
 *
 * Flow:
 * 1. User connects wallet and authenticates with signature
 * 2. User clicks "Link X Account" button
 * 3. Redirected to X OAuth consent
 * 4. After consent, redirected back here
 * 5. X profile stored in JWT session
 * 6. Client calls /api/auth/x/link to persist link to database
 */

import NextAuth from 'next-auth';
import TwitterProvider from 'next-auth/providers/twitter';
import type { NextAuthOptions, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

/**
 * Extended JWT type with X profile data
 */
interface XToken extends JWT {
  xId?: string;
  xUsername?: string;
  xName?: string;
  xImage?: string;
  accessToken?: string;
}

/**
 * Extended Session type with X profile data
 */
interface XSession extends Session {
  xProfile?: {
    id: string;
    username: string;
    name: string;
    image?: string;
  };
  accessToken?: string;
}

/**
 * NextAuth configuration for X/Twitter OAuth
 *
 * Uses OAuth 2.0 with JWT strategy.
 * No database adapter - we handle persistence separately
 * via wallet-linked user records.
 */
const authOptions: NextAuthOptions = {
  providers: [
    TwitterProvider({
      clientId: process.env.TWITTER_CLIENT_ID || '',
      clientSecret: process.env.TWITTER_CLIENT_SECRET || '',
      version: '2.0',
      authorization: {
        url: 'https://twitter.com/i/oauth2/authorize',
        params: {
          scope: 'users.read tweet.read offline.access',
        },
      },
      token: 'https://api.twitter.com/2/oauth2/token',
      userinfo: {
        url: 'https://api.twitter.com/2/users/me',
        params: {
          'user.fields': 'id,name,username,profile_image_url,verified',
        },
      },
      profile(profile) {
        // Transform X API response to NextAuth User format
        return {
          id: profile.data.id,
          name: profile.data.name,
          email: null, // X doesn't provide email with these scopes
          image: profile.data.profile_image_url?.replace('_normal', '_400x400'),
          // Custom fields for our use
          username: profile.data.username,
        };
      },
    }),
  ],

  // JWT strategy - no server-side session storage
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days - shorter for security
  },

  // Required secret for JWT encryption
  secret: process.env.NEXTAUTH_SECRET,

  // Custom pages
  pages: {
    signIn: '/auth/x-link',
    error: '/auth/x-link/error',
  },

  callbacks: {
    /**
     * JWT Callback
     *
     * Called whenever a JWT is created or updated.
     * Store X profile data in the token for client access.
     */
    async jwt({ token, user, account, profile }): Promise<XToken> {
      // First time sign in - add X profile data
      if (account && user) {
        return {
          ...token,
          xId: user.id,
          // @ts-expect-error - username from custom profile mapping
          xUsername: user.username || (profile as { data?: { username?: string } })?.data?.username,
          xName: user.name || undefined,
          xImage: user.image || undefined,
          accessToken: account.access_token,
        };
      }

      // Subsequent requests - return existing token
      return token as XToken;
    },

    /**
     * Session Callback
     *
     * Called whenever session is checked.
     * Expose X profile to client-side session.
     */
    async session({ session, token }): Promise<XSession> {
      const xToken = token as XToken;

      return {
        ...session,
        xProfile: xToken.xId
          ? {
              id: xToken.xId,
              username: xToken.xUsername || '',
              name: xToken.xName || '',
              image: xToken.xImage,
            }
          : undefined,
        accessToken: xToken.accessToken,
      };
    },

    /**
     * Sign In Callback
     *
     * Control whether user is allowed to sign in.
     * We only allow Twitter provider (X).
     */
    async signIn({ account }) {
      // Only allow Twitter/X provider
      if (account?.provider !== 'twitter') {
        console.warn('[NextAuth] Rejected non-Twitter sign in attempt');
        return false;
      }

      return true;
    },

    /**
     * Redirect Callback
     *
     * Control redirect after auth flow.
     * Redirect to linking completion page.
     */
    async redirect({ url, baseUrl }) {
      // If callback URL is relative or same origin, allow it
      if (url.startsWith('/')) {
        return `${baseUrl}${url}`;
      }

      // If same origin, allow
      if (new URL(url).origin === baseUrl) {
        return url;
      }

      // Default: redirect to X link completion
      return `${baseUrl}/auth/x-link/complete`;
    },
  },

  // Events for logging and debugging (only in development)
  events: {
    async signIn({ account }) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[NextAuth] X Sign In: provider=${account?.provider}`);
      }
    },
    async signOut() {
      if (process.env.NODE_ENV === 'development') {
        console.log('[NextAuth] X Sign Out');
      }
    },
    async createUser() {
      // This won't be called since we don't have a database adapter
    },
    async linkAccount({ account }) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[NextAuth] Link Account: provider=${account.provider}`);
      }
    },
    async session() {
      // Called on each session check - too noisy for logging
    },
  },

  // Enable debug mode in development
  debug: process.env.NODE_ENV === 'development',
};

/**
 * NextAuth route handler
 * Handles all /api/auth/* routes
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

/**
 * Export auth options for use in other server components
 */
export { authOptions };
