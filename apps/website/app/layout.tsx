import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Rake Roofing",
  description: "A production-ready shell for Rake Roofing campaigns.",
};

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
