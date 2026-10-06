import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Footer } from "@/components/footer";
import { Nav } from "@/components/nav";
import { Providers } from "@/components/providers";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme-script";

// The app talks to the RPC (and the indexer, when configured) on first load, so open those connections early.
const origin = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};
const PRECONNECT = [origin(process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://testnet-rpc.monad.xyz"), origin(process.env.NEXT_PUBLIC_INDEXER_URL || "")].filter(
  (o): o is string => !!o,
);

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/** Public site URL for social previews. Accepts a bare domain; an unusable value never fails the build. */
function siteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) {
    try {
      return new URL(raw.includes("://") ? raw : `https://${raw}`);
    } catch {}
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: "Rackrate | GPU rental-rate forwards on Monad", template: "%s | Rackrate" },
  description:
    "Lock in next week's H100 rental rate. Fully collateralized weekly GPU-hour forwards, traded on Kuru's onchain order book on Monad.",
  openGraph: {
    title: "Rackrate",
    description: "Weekly GPU rental-rate forwards on Monad. Hedge GPU revenue or cap compute costs in one transaction.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0b12" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {PRECONNECT.map((o) => (
          <link key={o} rel="preconnect" href={o} crossOrigin="anonymous" />
        ))}
      </head>
      <body className="grain flex min-h-[100dvh] flex-col">
        <Providers>
          <Nav />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
