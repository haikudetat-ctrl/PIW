import type { Metadata } from "next";
import { Bebas_Neue, Geist, Geist_Mono, Montserrat } from "next/font/google";
import { cookies } from "next/headers";
import {ConsentAwareVercelAnalytics} from "@/components/analytics/consent-aware-vercel-analytics";
import { PrivacyConsentProvider } from "@/components/privacy/privacy-consent-provider";
import { MetaPixelProvider } from "@/components/marketing/meta-pixel-provider";
import {parseServerEnv, resolveMetaTrackingConfiguration} from "@/lib/env/server";
import {
  PRIVACY_COOKIE_NAME,
  verifyConsentCookie,
} from "@/modules/privacy/consent";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});

const bebasNeue = Bebas_Neue({
  variable: "--font-bebas-neue",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://rake.2-stack.com"),
  title: "Rake | Property Intelligence Worker",
  description: "Property intelligence and roofing operations for the Rake team.",
  openGraph: {
    type: "website",
    siteName: "Rake",
    title: "Rake | Property Intelligence Worker",
    description: "Property intelligence and roofing operations for the Rake team.",
    images: [{url: "/api/share-image", width: 1200, height: 630, alt: "Rake — Property Intelligence Worker"}],
  },
  twitter: {
    card: "summary_large_image",
    title: "Rake | Property Intelligence Worker",
    description: "Property intelligence and roofing operations for the Rake team.",
    images: ["/api/share-image"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const signingSecret = process.env.PRIVACY_CONSENT_SIGNING_SECRET;
  let metaTrackingEnabled = false;
  try {
    metaTrackingEnabled = Boolean(resolveMetaTrackingConfiguration(parseServerEnv(process.env)));
  } catch {
    // Core startup validation may fail independently; never enable optional
    // browser tracking from a partially parsed environment.
  }
  const initialConsent = signingSecret
    ? verifyConsentCookie(cookieStore.get(PRIVACY_COOKIE_NAME)?.value, signingSecret)
    : null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${montserrat.variable} ${bebasNeue.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PrivacyConsentProvider initialConsent={initialConsent}>
          <MetaPixelProvider enabled={metaTrackingEnabled}>{children}</MetaPixelProvider>
          <ConsentAwareVercelAnalytics />
        </PrivacyConsentProvider>
      </body>
    </html>
  );
}
