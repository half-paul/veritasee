import type { Metadata } from 'next';
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: 'Veritasee Override',
  description: 'Community-governed correction overlay for online encyclopedias.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="antialiased">
          <header className="flex items-center justify-between border-b border-black/10 px-6 py-3">
            <span className="font-semibold">Veritasee Override</span>
            <div className="flex items-center gap-3">
              <SignedOut>
                <SignInButton mode="modal" />
              </SignedOut>
              <SignedIn>
                <UserButton />
              </SignedIn>
            </div>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
