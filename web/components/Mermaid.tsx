"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type WheelEvent as RWheelEvent,
} from "react";
import { createPortal } from "react-dom";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

export function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/[^a-z0-9]/gi, "");
  const [svg, setSvg] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        const theme =
          (typeof document !== "undefined" &&
            document.documentElement.getAttribute("data-theme")) === "light"
            ? "default"
            : "dark";
        mermaid.initialize({
          startOnLoad: false,
          theme,
          securityLevel: "strict",
          fontFamily: "Inter, sans-serif",
          themeVariables: {
            fontSize: "13px",
            primaryColor: theme === "dark" ? "#1c2440" : "#eef2ff",
            primaryTextColor: theme === "dark" ? "#e8edff" : "#0f172a",
            primaryBorderColor: theme === "dark" ? "#2e3a60" : "#cbd5e1",
            lineColor: theme === "dark" ? "#475da3" : "#94a3b8",
            secondaryColor: theme === "dark" ? "#161d33" : "#f8fafc",
            tertiaryColor: theme === "dark" ? "#0a0e1a" : "#ffffff",
            edgeLabelBackground: theme === "dark" ? "#0a0e1a" : "#ffffff",
          },
        });
        const { svg: rendered } = await mermaid.render(`m-${id}`, code);
        if (!cancelled) {
          setSvg(rendered);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    }

    render();

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.attributeName === "data-theme")) render();
    });
    if (typeof document !== "undefined") {
      observer.observe(document.documentElement, { attributes: true });
    }

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [code, id]);

  // ESC closes fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  if (err) {
    return (
      <pre className="mermaid-error">
        <code>{`Mermaid render error:\n${err}\n\n${code}`}</code>
      </pre>
    );
  }

  return (
    <>
      <DiagramView svg={svg} fullscreen={false} onExpand={() => setFullscreen(true)} />
      {fullscreen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="mermaid-overlay" onClick={() => setFullscreen(false)}>
            <div className="mermaid-overlay-inner" onClick={(e) => e.stopPropagation()}>
              <DiagramView svg={svg} fullscreen onClose={() => setFullscreen(false)} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

interface DiagramViewProps {
  svg: string;
  fullscreen: boolean;
  onExpand?: () => void;
  onClose?: () => void;
}

function DiagramView({ svg, fullscreen, onExpand, onClose }: DiagramViewProps) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const draggingRef = useRef<{ x: number; y: number; startPan: { x: number; y: number } } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Reset on remount (e.g., entering fullscreen).
  useEffect(() => reset(), [fullscreen, reset]);

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z * 1.25).toFixed(3)));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z / 1.25).toFixed(3)));

  const onWheel = (e: RWheelEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    setZoom((z) => clamp(+(z + delta * z).toFixed(3), MIN_ZOOM, MAX_ZOOM));
  };

  // Drag-to-pan is only useful when the diagram is bigger than the viewport
  // (i.e. zoomed in or in fullscreen). At default 1× the SVG already fits, so
  // panning would just shove a static image around — disable it.
  const canPan = fullscreen || zoom !== 1;

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!canPan) return;
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = { x: e.clientX, y: e.clientY, startPan: { ...pan } };
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setPan({
      x: draggingRef.current.startPan.x + (e.clientX - draggingRef.current.x),
      y: draggingRef.current.startPan.y + (e.clientY - draggingRef.current.y),
    });
  };

  const endDrag = (e: RPointerEvent<HTMLDivElement>) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    draggingRef.current = null;
  };

  return (
    <div className={`mermaid-container${fullscreen ? " is-fullscreen" : ""}`}>
      <div className="mermaid-toolbar" role="toolbar" aria-label="Diagram controls">
        <button onClick={zoomOut} aria-label="Zoom out" title="Zoom out (Ctrl+scroll)">
          <ZoomOutIcon />
        </button>
        <span className="mermaid-zoom-level">{Math.round(zoom * 100)}%</span>
        <button onClick={zoomIn} aria-label="Zoom in" title="Zoom in (Ctrl+scroll)">
          <ZoomInIcon />
        </button>
        <span className="mermaid-toolbar-sep" />
        <button onClick={reset} aria-label="Reset view" title="Reset (1:1)">
          <ResetIcon />
        </button>
        {fullscreen ? (
          <button onClick={onClose} aria-label="Exit fullscreen" title="Exit (Esc)">
            <ContractIcon />
          </button>
        ) : (
          <button onClick={onExpand} aria-label="Open fullscreen" title="Fullscreen">
            <ExpandIcon />
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        className={`mermaid-viewport${canPan ? " pannable" : ""}${draggingRef.current ? " dragging" : ""}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={canPan ? reset : undefined}
      >
        <div
          className="mermaid-block"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function iconProps() {
  return {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

function ZoomInIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
    </svg>
  );
}
function ZoomOutIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35M8 11h6" />
    </svg>
  );
}
function ResetIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 12a8 8 0 1 0 2.34-5.66" />
      <path d="M4 4v5h5" />
    </svg>
  );
}
function ExpandIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}
function ContractIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </svg>
  );
}
