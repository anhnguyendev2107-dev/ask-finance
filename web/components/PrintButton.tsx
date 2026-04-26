"use client";

export function PrintButton() {
  const onPrint = () => {
    // The browser's print dialog includes "Save as PDF" — no extra dep needed.
    // @media print rules in globals.css strip the chrome.
    if (typeof window !== "undefined") window.print();
  };
  return (
    <button
      type="button"
      onClick={onPrint}
      className="print-button"
      aria-label="Print or save this page as PDF"
      title="Print · Save as PDF (Ctrl/⌘+P)"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" rx="1" />
      </svg>
      <span>Save as PDF</span>
    </button>
  );
}
