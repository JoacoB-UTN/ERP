import type { Metadata } from 'next';
import Script from 'next/script';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/components/providers/query-provider';
import { THEME_BOOT_SCRIPT } from '@/components/theme/theme';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Facturación · ERP Platform',
  description: 'Venta rápida del ERP',
  // Two icons rather than one: `favicon.ico` is a black "C" on an opaque white
  // tile, which disappears into a light tab strip and reads as a floating mark
  // there, but shows as a white box on a dark one. `favicon-dark.png` is the
  // white "C" on transparency, which is the inverse problem. Pairing them by
  // `prefers-color-scheme` gives the mark on its own in both.
  //
  // Declared here instead of via the `app/favicon.ico` file convention because
  // that convention emits a single unconditional <link> and can only carry one
  // file — it has nowhere to express the media query.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any', media: '(prefers-color-scheme: light)' },
      {
        url: '/favicon-dark.png',
        type: 'image/png',
        media: '(prefers-color-scheme: dark)',
      },
    ],
  },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html suppressHydrationWarning lang="es-AR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* beforeInteractive: injected into the initial HTML and run before
            hydration, which is what keeps a dark-mode user from seeing a white
            flash. See theme.ts. */}
        <Script id="erp-theme-boot" strategy="beforeInteractive">
          {THEME_BOOT_SCRIPT}
        </Script>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
