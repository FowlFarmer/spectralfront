import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import '../src/style.css';
import '../src/modes.css';

export const metadata = {
  title: 'Spectral Front',
  description: 'A casual tactical graph artillery duel.',
};

export default function RootLayout({ children }) {
  return <html lang="en"><body><div className="sky" aria-hidden="true" />{children}<Analytics /><SpeedInsights /></body></html>;
}
