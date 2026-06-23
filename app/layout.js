import '../src/style.css';
import '../src/modes.css';

export const metadata = {
  title: 'Spectral Front',
  description: 'A casual peer-to-peer tactical duel.',
};

export default function RootLayout({ children }) {
  return <html lang="en"><body><div className="sky" aria-hidden="true" />{children}</body></html>;
}
