"use client";

import { useEffect, useRef, useState } from "react";

interface UserSummary {
  user_id: string;
  name: string;
  role: string;
  scope_description: string;
}

interface Props {
  users: UserSummary[];
  activeId: string;
  onChange: (id: string) => void;
}

export function UserPicker({ users, activeId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = users.find((u) => u.user_id === activeId);
  const activeIndex = users.findIndex((u) => u.user_id === activeId);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!active) {
    return (
      <div className="user-picker">
        <div className="user-picker-trigger user-picker-empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="user-picker" ref={ref}>
      <button
        type="button"
        className={`user-picker-trigger${open ? " is-open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`avatar a-${(activeIndex % 5) + 1}`}>{initials(active.name)}</span>
        <span className="user-picker-info">
          <span className="user-picker-name">{active.name}</span>
          <span className="user-picker-role">{active.role}</span>
        </span>
        <ChevronIcon className={`user-picker-chevron${open ? " is-open" : ""}`} />
      </button>

      {open && (
        <div className="user-picker-list" role="listbox" aria-label="Switch user">
          {users.map((u, i) => {
            const isActive = u.user_id === activeId;
            return (
              <button
                type="button"
                key={u.user_id}
                role="option"
                aria-selected={isActive}
                className={`user-picker-item${isActive ? " is-active" : ""}`}
                onClick={() => {
                  onChange(u.user_id);
                  setOpen(false);
                }}
              >
                <span className={`avatar a-${(i % 5) + 1}`}>{initials(u.name)}</span>
                <span className="user-picker-item-info">
                  <span className="user-picker-item-name">{u.name}</span>
                  <span className="user-picker-item-role">{u.role}</span>
                  <span className="user-picker-item-scope">{u.scope_description}</span>
                </span>
                {isActive && <CheckIcon />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
