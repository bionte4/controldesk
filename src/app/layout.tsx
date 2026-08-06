import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";

import { Providers } from "@/components/providers";
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
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn(inter.variable, jakarta.variable, "h-full antialiased")}
    >
      <body className="bg-background text-foreground min-h-full font-sans">
        <Providers
          locale={locale}
          messages={messages}
          timeZone="Asia/Jakarta"
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
