import { Link } from 'react-router-dom';
import { ArrowLeft } from '@/lib/icons';
import { WashWidget } from '@/components/wash/WashWidget';

export default function Wash() {
  return (
    <div className="h-screen overflow-y-auto bg-black">
      <header className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/"
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold text-white">Wash</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <WashWidget />
      </main>
    </div>
  );
}
