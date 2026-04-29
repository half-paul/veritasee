import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Veritasee Override',
  description: 'Community-governed correction overlay for online encyclopedias.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
