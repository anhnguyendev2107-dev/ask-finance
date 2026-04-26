"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Chart, type ChartSpec } from "@/components/Chart";
import { ConversationList, type ConversationSummary } from "@/components/ConversationList";
import { UserPicker } from "@/components/UserPicker";
import { useDrawer } from "@/lib/drawer-context";

// localStorage keys
const CONVO_KEY = (userId: string) => `ask-finance:conversations:${userId}`;
const ACTIVE_KEY = (userId: string) => `ask-finance:active-conversation:${userId}`;
const OLD_HISTORY_KEY = (userId: string) => `ask-finance:history:${userId}`;
const STORAGE_VERSION = 2;
const MAX_MESSAGES_PER_CONVO = 200;
const MAX_CONVERSATIONS_PER_USER = 50;

type Capability = "read_actuals" | "read_budget" | "read_projects" | "export";

interface UserInfo {
  user_id: string;
  name: string;
  email: string;
  role: string;
  bu_scope: string;
  region_scope: string;
  scope_description: string;
  capabilities: Record<Capability, boolean>;
  catalog: {
    actuals: { rows: number; business_units: string[]; regions: string[]; periods: string[] };
    projects: { rows: number; projects: string[] };
    budget_access: boolean;
  };
}

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
}

interface AgentTrace {
  user_query: string;
  user_id: string;
  iterations: number;
  tool_calls: ToolCall[];
  final_text: string;
  error: string | null;
  provider: "gemini" | "mock";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  trace?: AgentTrace;
}

interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  messages: ChatMessage[];
}

interface CitationDetail {
  ref_id: string;            // unique within conversation: msgId-localIdx
  msg_id: string;
  local_idx: number;         // 1-based index of citation within its message
  source: string;
  filters: string;
  rows: number;
  tool: string;
}

const newId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const newMessageId = () => newId("m");
const newConversationId = () => newId("c");

const SUGGESTION_ICONS = ["📊", "📈", "🔍", "🎯", "💡", "⚙️"];

const EXAMPLES_BY_ROLE: Record<string, string[]> = {
  "Group CFO": [
    "Summarise FY2024 P&L for the whole group",
    "Plot EBIT margin trend FY2023 to FY2025",
    "What was Opex variance for Q2 FY2024 in Electronics?",
    "Show ROI trend of Project Orion",
  ],
  "BU General Manager": [
    "Summarise my BU's FY2024 P&L",
    "Plot EBIT margin trend FY2023 to FY2025",
    "Opex variance Q2 FY2024",
    "ROI trend for Project Orion",
  ],
  "Regional Finance BP": [
    "Summarise APAC P&L for FY2024",
    "Plot revenue trend across APAC",
    "Variance for FY2024 Q3",
    "What is EBIT?",
  ],
  "BU Finance BP": [
    "P&L summary for my BU",
    "Plot EBIT trend FY2023 to FY2025",
    "Opex variance FY2024 Q2",
    "Define gross margin",
  ],
  Analyst: [
    "P&L summary for FY2024",
    "Plot revenue trend FY2023 to FY2025",
    "ROI trend for visible projects",
    "What is EBIT margin?",
  ],
};

export default function Page() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [activeUserId, setActiveUserId] = useState<string>("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { leftOpen, rightOpen, setLeftOpen, setRightOpen, closeAll } = useDrawer();
  const messagesRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLElement>(null);

  // ---- ESC closes mobile drawers -----------------------------------------
  useEffect(() => {
    if (!leftOpen && !rightOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftOpen, rightOpen, closeAll]);

  const isMobile = () => typeof window !== "undefined" && window.innerWidth <= 720;

  const activeUser = useMemo(
    () => users.find((u) => u.user_id === activeUserId),
    [users, activeUserId],
  );

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId),
    [conversations, activeConversationId],
  );

  const messages = activeConversation?.messages ?? [];

  // ---- Load users ---------------------------------------------------------
  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((d: { users: UserInfo[] }) => {
        setUsers(d.users);
        if (d.users.length) setActiveUserId(d.users[0].user_id);
      })
      .catch(() => {
        /* swallow */
      });
  }, []);

  // ---- Load + migrate conversations on user change ------------------------
  useEffect(() => {
    if (!activeUserId) return;
    try {
      // Migrate old single-history format if present.
      const oldRaw = localStorage.getItem(OLD_HISTORY_KEY(activeUserId));
      if (oldRaw) {
        try {
          const parsed = JSON.parse(oldRaw) as { v?: number; messages?: ChatMessage[] };
          if (
            parsed?.v === 1 &&
            Array.isArray(parsed.messages) &&
            parsed.messages.length > 0
          ) {
            const migrated: Conversation = {
              id: newConversationId(),
              user_id: activeUserId,
              title: deriveTitle(parsed.messages.find((m) => m.role === "user")?.content),
              created_at: Date.now(),
              updated_at: Date.now(),
              messages: parsed.messages.map((m) => (m.id ? m : { ...m, id: newMessageId() })),
            };
            const existingRaw = localStorage.getItem(CONVO_KEY(activeUserId));
            const existing: Conversation[] = existingRaw ? JSON.parse(existingRaw) : [];
            const combined = [migrated, ...existing];
            localStorage.setItem(
              CONVO_KEY(activeUserId),
              JSON.stringify({ v: STORAGE_VERSION, items: combined }),
            );
          }
        } catch {
          /* corrupted old data — ignore */
        }
        localStorage.removeItem(OLD_HISTORY_KEY(activeUserId));
      }

      // Load current conversations.
      const raw = localStorage.getItem(CONVO_KEY(activeUserId));
      let list: Conversation[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as
            | { v?: number; items?: Conversation[] }
            | Conversation[];
          if (Array.isArray(parsed)) list = parsed;
          else if (parsed?.v === STORAGE_VERSION && Array.isArray(parsed.items)) list = parsed.items;
        } catch {
          list = [];
        }
      }

      // Sort: most-recently-updated first.
      list.sort((a, b) => b.updated_at - a.updated_at);
      setConversations(list);

      // Restore last-active conversation, or pick the most recent, or none.
      const savedActive = localStorage.getItem(ACTIVE_KEY(activeUserId));
      if (savedActive && list.some((c) => c.id === savedActive)) {
        setActiveConversationId(savedActive);
      } else if (list.length > 0) {
        setActiveConversationId(list[0].id);
      } else {
        setActiveConversationId("");
      }
    } catch {
      setConversations([]);
      setActiveConversationId("");
    }
  }, [activeUserId]);

  // ---- Persist conversations ---------------------------------------------
  useEffect(() => {
    if (!activeUserId) return;
    try {
      // Cap memory: keep last MAX_CONVERSATIONS_PER_USER, trim each to last N msgs.
      const trimmed = conversations.slice(0, MAX_CONVERSATIONS_PER_USER).map((c) => ({
        ...c,
        messages: c.messages.slice(-MAX_MESSAGES_PER_CONVO),
      }));
      localStorage.setItem(
        CONVO_KEY(activeUserId),
        JSON.stringify({ v: STORAGE_VERSION, items: trimmed }),
      );
    } catch {
      /* quota / disabled */
    }
  }, [conversations, activeUserId]);

  useEffect(() => {
    if (!activeUserId) return;
    try {
      if (activeConversationId) {
        localStorage.setItem(ACTIVE_KEY(activeUserId), activeConversationId);
      } else {
        localStorage.removeItem(ACTIVE_KEY(activeUserId));
      }
    } catch {
      /* ignore */
    }
  }, [activeUserId, activeConversationId]);

  // ---- Conversation helpers ----------------------------------------------
  const updateConversation = (id: string, fn: (c: Conversation) => Conversation) => {
    setConversations((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  };

  const createConversation = (): string => {
    const conv: Conversation = {
      id: newConversationId(),
      user_id: activeUserId,
      title: "New conversation",
      created_at: Date.now(),
      updated_at: Date.now(),
      messages: [],
    };
    setConversations((cs) => [conv, ...cs]);
    setActiveConversationId(conv.id);
    return conv.id;
  };

  const deleteConversation = (id: string) => {
    setConversations((cs) => {
      const next = cs.filter((c) => c.id !== id);
      if (id === activeConversationId) {
        setActiveConversationId(next[0]?.id ?? "");
      }
      return next;
    });
  };

  // ---- Send query --------------------------------------------------------
  const send = async (queryOverride?: string) => {
    const query = (queryOverride ?? input).trim();
    if (!query || !activeUserId || busy) return;

    let convId = activeConversationId;
    if (!convId || !conversations.some((c) => c.id === convId)) {
      convId = createConversation();
    }

    setInput("");
    const userMsg: ChatMessage = { id: newMessageId(), role: "user", content: query };

    updateConversation(convId, (c) => ({
      ...c,
      title: c.messages.length === 0 ? deriveTitle(query) : c.title,
      messages: [...c.messages, userMsg],
      updated_at: Date.now(),
    }));

    setBusy(true);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: activeUserId, query }),
      });
      const trace = (await r.json()) as AgentTrace;
      const assistantMsg: ChatMessage = {
        id: newMessageId(),
        role: "assistant",
        content: trace.error ? `⚠️ ${trace.error}` : trace.final_text || "(empty response)",
        trace,
      };
      updateConversation(convId, (c) => ({
        ...c,
        messages: [...c.messages, assistantMsg],
        updated_at: Date.now(),
      }));
    } catch (err) {
      const errMsg: ChatMessage = {
        id: newMessageId(),
        role: "assistant",
        content: `⚠️ Network error: ${err instanceof Error ? err.message : String(err)}`,
      };
      updateConversation(convId, (c) => ({
        ...c,
        messages: [...c.messages, errMsg],
        updated_at: Date.now(),
      }));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  // ---- Auto-scroll chat to bottom ---------------------------------------
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages.length, busy]);

  // ---- Citations across the active conversation -------------------------
  const conversationCitations = useMemo<CitationDetail[]>(() => {
    const out: CitationDetail[] = [];
    for (const m of messages) {
      if (m.role !== "assistant" || !m.trace) continue;
      let local = 1;
      for (const tc of m.trace.tool_calls) {
        const r = tc.result as { citations?: { source: string; filters: string; rows: number }[] };
        if (!Array.isArray(r?.citations)) continue;
        for (const c of r.citations) {
          out.push({
            ref_id: `${m.id}-${local}`,
            msg_id: m.id,
            local_idx: local,
            source: c.source,
            filters: c.filters,
            rows: c.rows,
            tool: tc.name,
          });
          local++;
        }
      }
    }
    return out;
  }, [messages]);

  const lastTrace = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].trace) return messages[i].trace ?? null;
    }
    return null;
  }, [messages]);

  // ---- Cross-pane jumping ------------------------------------------------
  const jumpToCitation = (refId: string) => {
    // On mobile the right pane is hidden by default; open it first then
    // wait a tick so the slide-in animation doesn't fight the scrollIntoView.
    const onMobile = isMobile();
    if (onMobile && !rightOpen) setRightOpen(true);
    window.setTimeout(
      () => {
        const card = rightPaneRef.current?.querySelector(
          `[data-cite-ref="${CSS.escape(refId)}"]`,
        ) as HTMLElement | null;
        if (!card) return;
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("highlight-flash");
        window.setTimeout(() => card.classList.remove("highlight-flash"), 1400);
      },
      onMobile ? 220 : 0,
    );
  };

  // ---- Conversations summary for the sidebar ----------------------------
  const conversationSummaries: ConversationSummary[] = useMemo(
    () =>
      conversations.map((c) => ({
        id: c.id,
        title: c.title,
        message_count: c.messages.length,
        updated_at: c.updated_at,
      })),
    [conversations],
  );

  return (
    <div className={`app${leftOpen ? " left-open" : ""}${rightOpen ? " right-open" : ""}`}>
      {(leftOpen || rightOpen) && (
        <button className="mobile-backdrop" aria-label="Close panel" onClick={closeAll} />
      )}

      <aside className="left-pane">
        <div className="left-pane-header">
          <UserPicker users={users} activeId={activeUserId} onChange={setActiveUserId} />
        </div>

        <div className="left-pane-section convo-section-wrap">
          <ConversationList
            items={conversationSummaries}
            activeId={activeConversationId}
            onSelect={setActiveConversationId}
            onNew={createConversation}
            onDelete={deleteConversation}
          />
        </div>

        <div className="left-pane-footer">
          Same query, different roles → different data. RBAC is enforced server-side at every
          tool call, never trusted to the LLM.
        </div>
      </aside>

      <main className="center-pane">

        <div className="messages" ref={messagesRef}>
          {messages.length === 0 && activeUser && (
            <div className="welcome">
              <div className="welcome-headline">
                <span className="welcome-emoji" aria-hidden="true">👋</span>
                <span>
                  Hi <strong>{activeUser.name.split(" ")[0]}</strong> — what would you like to look at?
                </span>
              </div>
              <p className="welcome-subtitle">
                Every answer cites its source and stays inside your scope ({activeUser.scope_description}).
              </p>
              <div className="suggestion-grid">
                {(EXAMPLES_BY_ROLE[activeUser.role] ?? []).map((ex, i) => (
                  <button
                    key={ex}
                    type="button"
                    className="suggestion-card"
                    onClick={() => void send(ex)}
                    disabled={busy}
                  >
                    <span className="suggestion-icon" aria-hidden="true">
                      {SUGGESTION_ICONS[i % SUGGESTION_ICONS.length]}
                    </span>
                    <span className="suggestion-text">{ex}</span>
                    <span className="suggestion-arrow" aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => {
            const charts = m.trace ? extractCharts(m.trace) : [];
            const msgCitations = m.role === "assistant"
              ? conversationCitations.filter((c) => c.msg_id === m.id)
              : [];
            return (
              <div key={m.id ?? i} data-msg-id={m.id} className={`message ${m.role}`}>
                <div className={`msg-avatar ${m.role === "user" ? "user-av" : "assistant-av"}`}>
                  {m.role === "user" && activeUser ? initials(activeUser.name) : "AI"}
                </div>
                <div className="msg-body">
                  <div className="bubble">
                    {m.role === "assistant" ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    ) : (
                      m.content
                    )}
                    {charts.map((c, j) => (
                      <Chart key={j} spec={c} />
                    ))}
                  </div>
                  {msgCitations.length > 0 && (
                    <div className="msg-citations" aria-label="Citations">
                      {msgCitations.map((c) => (
                        <button
                          key={c.ref_id}
                          type="button"
                          className="citation-chip"
                          onClick={() => jumpToCitation(c.ref_id)}
                          title={`${c.source} — ${c.filters} (${c.rows} rows)`}
                        >
                          <span className="citation-idx">[{c.local_idx}]</span>
                          <span className="citation-src">{shortSource(c.source)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {busy && (
            <div className="message assistant">
              <div className="msg-avatar assistant-av">AI</div>
              <div className="msg-body">
                <div className="bubble">
                  <span className="thinking">
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="composer">
          <div className={`input-shell${input.trim() ? " has-input" : ""}`}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about P&L, variance, EBIT trend, project ROI…"
              rows={1}
              disabled={busy || !activeUserId}
            />
            <button
              type="button"
              className="send-btn"
              aria-label="Send"
              onClick={() => void send()}
              disabled={busy || !activeUserId || !input.trim()}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </main>

      <aside className="right-pane" ref={rightPaneRef}>
        <div className="right-pane-top">
          <h3>Visible scope</h3>
          {lastTrace && (
            <span className={`provider-badge ${lastTrace.provider === "gemini" ? "live" : ""}`}>
              {lastTrace.provider}
            </span>
          )}
        </div>
        {activeUser ? (
          <div className="scope-card">
            <div className="row">
              <span>BUs</span>
              <span>{activeUser.catalog.actuals.business_units.join(", ") || "—"}</span>
            </div>
            <div className="row">
              <span>Regions</span>
              <span>{activeUser.catalog.actuals.regions.join(", ") || "—"}</span>
            </div>
            <div className="row">
              <span>Projects</span>
              <span>{activeUser.catalog.projects.projects.join(", ") || "—"}</span>
            </div>
            <div className="row">
              <span>Actuals rows</span>
              <span>{activeUser.catalog.actuals.rows}</span>
            </div>
          </div>
        ) : (
          <div className="empty-state">No user selected.</div>
        )}

        <h3>Capabilities</h3>
        {activeUser && (
          <div>
            {(Object.entries(activeUser.capabilities) as [Capability, boolean][]).map(([k, v]) => (
              <span key={k} className={`cap-pill ${v ? "yes" : "no"}`}>
                {v ? "✓" : "✕"} {k}
              </span>
            ))}
          </div>
        )}

        <h3>Last tool calls</h3>
        {lastTrace && lastTrace.tool_calls.length > 0 ? (
          lastTrace.tool_calls.map((tc, i) => (
            <div key={i} className="tool-card">
              <div className="tool-name">{tc.name}</div>
              <div className="tool-input">{JSON.stringify(tc.input)}</div>
            </div>
          ))
        ) : (
          <div className="empty-state">No queries yet.</div>
        )}

        <h3>Citations</h3>
        {conversationCitations.length === 0 ? (
          <div className="empty-state">No citations yet — they appear here when an answer cites sources.</div>
        ) : (
          <div className="citation-card-list">
            {conversationCitations.map((c) => (
              <div
                key={c.ref_id}
                data-cite-ref={c.ref_id}
                className="tool-card citation-card"
              >
                <div className="citation-card-head">
                  <span className="citation-idx-pill">[{c.local_idx}]</span>
                  <span className="tool-name">{c.source}</span>
                </div>
                <div className="tool-input">{c.filters}</div>
                <div className="citation-meta">
                  {c.rows} rows · via <code>{c.tool}</code>
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function deriveTitle(query: string | undefined): string {
  if (!query) return "New conversation";
  const cleaned = query.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 48) return cleaned;
  return cleaned.slice(0, 45).trimEnd() + "…";
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 5l7 7-7 7" />
    </svg>
  );
}

function shortSource(source: string): string {
  // "SAP-ECC (sap_gl_actuals.csv)" → "SAP-ECC"; "Internal Finance Glossary" → "Glossary"
  if (/^Internal Finance Glossary/i.test(source)) return "Glossary";
  if (/^Oracle HFM/i.test(source)) return "HFM";
  if (/^PPM-System/i.test(source)) return "PPM";
  const match = source.match(/^([A-Za-z0-9-]+)/);
  return match ? match[1] : source;
}

function extractCharts(trace: AgentTrace): ChartSpec[] {
  // Models occasionally call generate_chart twice with effectively the same
  // payload (one missing chart_type, one with it). Dedupe by a content key
  // built from title + chart_type + the y-series, keeping the most-recent
  // call so any refinement wins.
  const seen = new Map<string, ChartSpec>();
  for (const tc of trace.tool_calls) {
    const r = tc.result as { chart?: ChartSpec };
    if (!r?.chart || !Array.isArray(r.chart.series) || r.chart.series.length === 0) continue;
    const key = [
      r.chart.title ?? "",
      r.chart.type ?? "line",
      r.chart.series.map((p) => `${p.x}:${p.y}`).join("|"),
    ].join("§");
    seen.set(key, r.chart);
  }
  return Array.from(seen.values());
}
