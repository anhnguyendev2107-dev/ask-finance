"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDrawer } from "@/lib/drawer-context";
import { ThemeToggle } from "./ThemeToggle";

const TABS: { href: string; label: string }[] = [
  { href: "/", label: "Chat" },
  { href: "/architecture", label: "Architecture" },
  { href: "/evaluation", label: "Evaluation" },
  { href: "/future", label: "Roadmap" },
];

export function TopNav() {
  const pathname = usePathname();
  const { setLeftOpen, setRightOpen } = useDrawer();
  const isChatPage = pathname === "/" || pathname === "";

  return (
    <header className="topnav">
      {/* Left mobile toggle — only on the chat page where the conversations
          drawer exists. Hidden on desktop via CSS. */}
      {isChatPage && (
        <button
          type="button"
          className="topnav-toggle topnav-toggle-left"
          aria-label="Open conversations"
          onClick={() => setLeftOpen(true)}
        >
          <MenuIcon />
        </button>
      )}

      <Link className="brand-link" href="/">
        <span className="brand-mark" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="bm-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6c8cff" />
                <stop offset="55%" stopColor="#8a7cff" />
                <stop offset="100%" stopColor="#b685ff" />
              </linearGradient>
              <linearGradient id="bm-shine" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
                <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="bm-line" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#ffffff" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#bm-bg)" />
            <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#bm-shine)" />
            <line x1="6" y1="23" x2="26" y2="23" stroke="#ffffff" strokeOpacity="0.32" strokeWidth="1" strokeLinecap="round" />
            <path
              d="M6 20 L11 16 L16 18 L21 11 L26 8"
              fill="none"
              stroke="url(#bm-line)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="26" cy="8" r="3" fill="#ffffff" fillOpacity="0.25" />
            <circle cx="26" cy="8" r="2" fill="#ffffff" />
          </svg>
        </span>
        <span className="brand-name">Ask Finance</span>
      </Link>

      <nav className="topnav-tabs" aria-label="Primary">
        {TABS.map((t) => {
          const active = isActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`topnav-tab${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="topnav-actions">
        {/* Right mobile toggle — only on chat page; opens scope/citations drawer. */}
        {isChatPage && (
          <button
            type="button"
            className="topnav-toggle topnav-toggle-right"
            aria-label="Open scope and citations"
            onClick={() => setRightOpen(true)}
          >
            <InfoIcon />
          </button>
        )}
        <a
          className="topnav-link"
          href="https://github.com/anhnguyendev2107-dev/ask-finance"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="GitHub repository"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .5C5.65.5.5 5.65.5 12.02c0 5.07 3.29 9.37 7.86 10.89.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.13-3.2.7-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.34.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.17.92-.26 1.91-.39 2.89-.4.98 0 1.97.13 2.89.4 2.2-1.49 3.16-1.17 3.16-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.08 0 4.42-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12.02C23.5 5.65 18.35.5 12 .5z" />
          </svg>
          <span className="topnav-link-label">GitHub</span>
        </a>
        <ThemeToggle />
      </div>
    </header>
  );
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="12" y1="7" x2="12" y2="7.01" />
    </svg>
  );
}
