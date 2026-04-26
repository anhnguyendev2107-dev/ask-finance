import type { Metadata } from "next";
import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { DrawerProvider } from "@/lib/drawer-context";

export const metadata: Metadata = {
  title: "Ask Finance — AI Finance Business Partner",
  description:
    "AI agent that answers finance questions over SAP/HFM data with role-based access control.",
};

const themeBootstrap = `
(function () {
  try {
    var t = localStorage.getItem('ask-finance-theme');
    if (!t) t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        <DrawerProvider>
          <div className="shell">
            <TopNav />
            <div className="page-content">{children}</div>
          </div>
        </DrawerProvider>
        <div className="bg-glow" aria-hidden="true" />
      </body>
    </html>
  );
}
