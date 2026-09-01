import type { Metadata } from "next";
import {cookies} from "next/headers";
import {PrivacyConsentProvider} from "../components/privacy-consent-provider";
import {MetaPixelProvider} from "../components/meta-pixel-provider";
import {PRIVACY_COOKIE_NAME, readWebsiteConsent} from "../lib/privacy-consent";
import "./styles.css";

export const metadata: Metadata = {
  title: "Rake Roofing",
  description: "A production-ready shell for Rake Roofing campaigns.",
};

export default async function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  const cookieStore = await cookies();
  const signingSecret = process.env.PRIVACY_CONSENT_SIGNING_SECRET;
  const metaTrackingEnabled = process.env.NEXT_PUBLIC_META_TRACKING_ENABLED === "true";
  const initialConsent = signingSecret
    ? readWebsiteConsent(cookieStore.get(PRIVACY_COOKIE_NAME)?.value, signingSecret)
    : null;

  return (
    <html lang="en">
      <body>
        <PrivacyConsentProvider initialConsent={initialConsent}>
          <MetaPixelProvider enabled={metaTrackingEnabled}>{children}</MetaPixelProvider>
        </PrivacyConsentProvider>
      </body>
    </html>
  );
}
