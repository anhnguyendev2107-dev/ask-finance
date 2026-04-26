"use client";

import { type MouseEvent } from "react";

export interface ConversationSummary {
  id: string;
  title: string;
  message_count: number;
  updated_at: number;
}

interface Props {
  items: ConversationSummary[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ConversationList({ items, activeId, onSelect, onNew, onDelete }: Props) {
  return (
    <div className="convo-section">
      <div className="section-label section-label-row">
        <span>Conversations</span>
        <button type="button" className="link-btn convo-new-btn" onClick={onNew} title="Start a new conversation">
          <PlusIcon /> New
        </button>
      </div>

      {items.length === 0 ? (
        <div className="history-empty">
          No conversations yet. Type a question below to start the first one.
        </div>
      ) : (
        <ul className="convo-list">
          {items.map((c) => {
            const isActive = c.id === activeId;
            return (
              <li key={c.id} className={`convo-li${isActive ? " is-active" : ""}`}>
                <button
                  type="button"
                  className="convo-item"
                  onClick={() => onSelect(c.id)}
                  title={c.title}
                >
                  <span className="convo-title">{c.title}</span>
                  <span className="convo-meta">
                    {c.message_count} {c.message_count === 1 ? "msg" : "msgs"} · {timeAgo(c.updated_at)}
                  </span>
                </button>
                <button
                  type="button"
                  className="convo-delete"
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete "${c.title}"? This can't be undone.`)) {
                      onDelete(c.id);
                    }
                  }}
                  aria-label="Delete conversation"
                  title="Delete"
                >
                  <TrashIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
