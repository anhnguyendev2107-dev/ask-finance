"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Chart, type ChartSpec } from "@/components/Chart";

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
  role: "user" | "assistant";
  content: string;
  trace?: AgentTrace;
}

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  const activeUser = useMemo(
    () => users.find((u) => u.user_id === activeUserId),
    [users, activeUserId],
  );

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((d: { users: UserInfo[] }) => {
        setUsers(d.users);
        if (d.users.length) setActiveUserId(d.users[0].user_id);
      })
      .catch(() => {
        /* swallow — UI will show empty state */
      });
  }, []);

  useEffect(() => {
    setMessages([]);
  }, [activeUserId]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const lastTrace = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].trace) return messages[i].trace!;
    }
    return null;
  }, [messages]);

  const send = async (queryOverride?: string) => {
    const query = (queryOverride ?? input).trim();
    if (!query || !activeUserId || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: query }]);
    setBusy(true);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: activeUserId, query }),
      });
      const trace = (await r.json()) as AgentTrace;
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: trace.error ? `⚠️ ${trace.error}` : trace.final_text || "(empty response)",
          trace,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `⚠️ Network error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
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

  return (
    <div className="app">
      <aside className="left-pane">
        <div className="brand">
          <span className="logo">A</span>
          <span>Ask Finance</span>
        </div>
        <div className="tagline">AI Finance Business Partner — demo</div>

        <div className="section-label">Switch user / role</div>
        {users.map((u, idx) => (
          <div
            key={u.user_id}
            className={`user-card ${u.user_id === activeUserId ? "active" : ""}`}
            onClick={() => setActiveUserId(u.user_id)}
          >
            <div className={`avatar a-${(idx % 5) + 1}`}>{initials(u.name)}</div>
            <div className="user-info">
              <div className="user-name">{u.name}</div>
              <div className="user-role">{u.role}</div>
              <div className="user-scope">{u.scope_description}</div>
            </div>
          </div>
        ))}

        <div className="section-label">About</div>
        <div className="about-text">
          Same query, different roles → different data. RBAC is enforced server-side at every
          tool call, never trusted to the LLM.
        </div>
      </aside>

      <main className="center-pane">
        <header className="chat-header">
          <div className="header-title">
            {activeUser && (
              <div className={`avatar a-${(users.findIndex((u) => u.user_id === activeUserId) % 5) + 1}`}>
                {initials(activeUser.name)}
              </div>
            )}
            <div>
              <h1>{activeUser ? activeUser.name : "—"}</h1>
              <div className="scope-badge">
                {activeUser
                  ? `${activeUser.role} · ${activeUser.scope_description}`
                  : "loading…"}
              </div>
            </div>
          </div>
          <span className={`provider-badge ${lastTrace?.provider === "gemini" ? "live" : ""}`}>
            {lastTrace ? lastTrace.provider : "—"}
          </span>
        </header>

        <div className="messages" ref={messagesRef}>
          {messages.length === 0 && (
            <div className="empty-state" style={{ padding: "12px 0" }}>
              Pick a user on the left, then ask anything about P&L, variance, ROI, or
              finance terms.
            </div>
          )}
          {messages.map((m, i) => {
            const charts = m.trace ? extractCharts(m.trace) : [];
            return (
              <div key={i} className={`message ${m.role}`}>
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
                  {m.trace && m.trace.tool_calls.length > 0 && (
                    <div className="tool-trace">
                      {m.trace.tool_calls.map((tc, j) => (
                        <div key={j}>
                          <span className="tool-name">{tc.name}</span>
                          {Object.keys(tc.input).length > 0
                            ? `(${JSON.stringify(tc.input)})`
                            : "()"}
                        </div>
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
          <div className="examples">
            {(activeUser ? EXAMPLES_BY_ROLE[activeUser.role] ?? [] : []).map((ex) => (
              <button key={ex} className="example" onClick={() => void send(ex)} disabled={busy}>
                {ex}
              </button>
            ))}
          </div>
          <div className="input-row">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask about P&L, variance, EBIT trend, project ROI…"
              rows={1}
              disabled={busy || !activeUserId}
            />
            <button
              className="send-btn"
              onClick={() => void send()}
              disabled={busy || !activeUserId || !input.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </main>

      <aside className="right-pane">
        <h3>Visible scope</h3>
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
        {lastTrace ? (
          <CitationsList trace={lastTrace} />
        ) : (
          <div className="empty-state">No queries yet.</div>
        )}
      </aside>
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

function extractCharts(trace: AgentTrace): ChartSpec[] {
  const charts: ChartSpec[] = [];
  for (const tc of trace.tool_calls) {
    const r = tc.result as { chart?: ChartSpec };
    if (r?.chart && Array.isArray(r.chart.series) && r.chart.series.length > 0) {
      charts.push(r.chart);
    }
  }
  return charts;
}

function CitationsList({ trace }: { trace: AgentTrace }) {
  const citations: { source: string; filters: string; rows: number }[] = [];
  for (const tc of trace.tool_calls) {
    const r = tc.result as { citations?: { source: string; filters: string; rows: number }[] };
    if (r?.citations) citations.push(...r.citations);
  }
  if (citations.length === 0) {
    return <div className="empty-state">No citations.</div>;
  }
  return (
    <>
      {citations.map((c, i) => (
        <div key={i} className="tool-card">
          <div className="tool-name">{c.source}</div>
          <div className="tool-input">
            {c.filters} · {c.rows} rows
          </div>
        </div>
      ))}
    </>
  );
}
