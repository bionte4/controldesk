import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";

import { Providers } from "@/components/providers";
import { SerwistProvider } from "@/components/pwa/serwist-provider";
import { cn } from "@/lib/utils";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ControlDesk",
    template: "%s · ControlDesk",
  },
  description:
    "ControlDesk — multi-tenant BPO / Managed Services ERP with dynamic approvals, cash advance, petty cash, HRIS, and AI analytics.",
  applicationName: "ControlDesk",
  authors: [{ name: "ControlDesk" }],
  keywords: [
    "BPO",
    "ERP",
    "multi-tenant",
    "managed services",
    "approvals",
    "HRIS",
  ],
  // PWA manifest — served from `public/manifest.webmanifest`. Because
  // it's a relative URL, each tenant subdomain gets its own manifest
  // scope automatically (rules §5 multi-tenancy — no cross-subdomain
  // PWA install collision).
  manifest: "/manifest.webmanifest",
  // Apple / iOS "Add to Home Screen" support. Android Chrome reads the
  // manifest above; iOS Safari still relies on these classic meta tags.
  appleWebApp: {
    capable: true,
    title: "ControlDesk",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  formatDetection: {
    // Prevent Android auto-linking phone numbers on approval / finance
    // lists (they look ugly + tap targets steal from actual buttons).
    telephone: false,
  },
};

/**
 * Split viewport out of `metadata` (Next.js 15+ convention). `themeColor`
 * drives the Android status bar tint when the PWA is installed; the pair
 * `light` / `dark` lets Chrome pick the right shade with `prefers-color-
 * scheme`. Values match `background_color` / `theme_color` in
 * `public/manifest.webmanifest` — Chrome DevTools > Manifest audit warns
 * loudly when they drift.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f19" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
  // Allow limited zoom so keyboard/pinch zoom still works on tiny form
  // labels — accessibility rules §23 (WCAG 2.2 AAA).
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn(inter.variable, jakarta.variable, "h-full antialiased")}
    >
      <body className="bg-background text-foreground min-h-full font-sans">
        <SerwistProvider>
          <Providers
            locale={locale}
            messages={messages}
            timeZone="Asia/Jakarta"
          >
            {children}
          </Providers>
        </SerwistProvider>
      </body>
    </html>
  );
}
