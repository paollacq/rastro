import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import './globals.css';

// Self-hosted from @fontsource, so a build never depends on reaching Google Fonts.
const sans = localFont({
  src: [
    { path: '../node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff2', weight: '400' },
    { path: '../node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff2', weight: '600' },
  ],
  variable: '--font-sans',
  display: 'swap',
});

const mono = localFont({
  src: [
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', weight: '400' },
    { path: '../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', weight: '500' },
  ],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'rastro', template: '%s · rastro' },
  description: 'Dólar entra, real sai por Pix, e cada transferência deixa rastro. Demonstração na testnet do Tempo.',
};

// Each page brings its own warning strip, in its own language. English pages mark
// themselves with lang="en" on their main element.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
