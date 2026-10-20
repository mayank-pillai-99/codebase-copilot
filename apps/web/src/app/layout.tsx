import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { THEME_SCRIPT } from '@/lib/theme';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Codebase Copilot',
  description:
    'Paste a GitHub URL, get an onboarding guide to that codebase — grounded in the actual code.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-scroll-behavior lets Next.js turn off the CSS smooth scrolling during route
    // changes, so a new page starts at the top instead of animating there.
    // The theme script sets data-theme before hydration, hence suppressHydrationWarning.
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* A constant script, not user content: applies the theme before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* Public pages add the site header and footer ((site)/layout.tsx); repository
          pages have their own workspace frame ((workspace)/repos/[snapshotId]/layout.tsx). */}
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
