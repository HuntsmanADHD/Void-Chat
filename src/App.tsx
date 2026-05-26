import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProviders } from '@/components/providers/AppProviders';
import Landing from '@/pages/Landing';
import HowItWorks from '@/pages/HowItWorks';
import Wash from '@/pages/Wash';
import Privacy from '@/pages/Privacy';
import Terms from '@/pages/Terms';
import Dashboard from '@/pages/Dashboard';
import Settings from '@/pages/Settings';
import Community from '@/pages/Community';
import Channel from '@/pages/Channel';
import DM from '@/pages/DM';

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/wash" element={<Wash />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/settings" element={<Settings />} />
          <Route path="/app/community/:id" element={<Community />} />
          <Route path="/app/community/:id/channel/:channelId" element={<Channel />} />
          <Route path="/app/dm/:publicId" element={<DM />} />
        </Routes>
      </BrowserRouter>
    </AppProviders>
  );
}

export default App;
