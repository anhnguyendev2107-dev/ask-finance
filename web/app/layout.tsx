import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ask Finance — AI Finance Business Partner",
  description:
    "Demo of an AI agent that answers finance questions over SAP/HFM data with role-based access control.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
