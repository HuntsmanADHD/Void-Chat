import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Key, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isLoading, error: authError } = useAuth();

  const [privateKey, setPrivateKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = useCallback(async () => {
    if (!privateKey.trim()) {
      setError('Enter your private key');
      return;
    }

    setError(null);

    try {
      const success = await login(privateKey.trim());
      if (success) {
        navigate('/app');
      } else {
        setError(authError || 'Authentication failed. Check your key and try again.');
      }
    } catch {
      setError('Login failed. Make sure your private key is correct.');
    }
  }, [privateKey, login, authError, navigate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      handleLogin();
    }
  }, [handleLogin, isLoading]);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Key className="w-12 h-12 mx-auto text-purple-400 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Enter the Void</h1>
          <p className="text-gray-400 text-sm">
            Your private key is your identity. Enter it to authenticate.
          </p>
        </div>

        {(error || authError) && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-300">{error || authError}</p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter your private key"
              className="w-full px-4 py-3 pr-12 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 font-mono text-sm"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <button
            onClick={handleLogin}
            disabled={isLoading || !privateKey.trim()}
            className="w-full py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Authenticating...
              </span>
            ) : (
              'Authenticate'
            )}
          </button>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-500 text-center">
            Your key never leaves your device. We verify a signature, not the key itself.
          </p>
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-500">
            No identity yet?{' '}
            <Link to="/create" className="text-purple-400 hover:text-purple-300 transition-colors">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
