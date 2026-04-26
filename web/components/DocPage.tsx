import fs from "node:fs";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isValidElement, type ReactNode } from "react";
import { Mermaid } from "./Mermaid";
import { PrintButton } from "./PrintButton";

interface Props {
  slug: "architecture" | "evaluation" | "future";
  eyebrow: string;
  title: string;
  subtitle: string;
}

export function DocPage({ slug, eyebrow, title, subtitle }: Props) {
  const file = path.join(process.cwd(), "lib", "docs", `${slug}.md`);
  const raw = fs.readFileSync(file, "utf8");

  // Strip the first H1 — we render our own gradient title.
  const body = raw.replace(/^#\s+[^\n]+\n+/, "");

  const toc = buildToc(body);

  return (
    <div className="doc-shell">
      <aside className="doc-toc">
        <div className="doc-toc-label">On this page</div>
        <nav className="doc-toc-list" aria-label="Table of contents">
          {toc.map((entry) => (
            <a
              key={entry.id}
              href={`#${entry.id}`}
              className={`doc-toc-link depth-${entry.depth}`}
            >
              {entry.text}
            </a>
          ))}
        </nav>
      </aside>

      <main className="doc-main">
        <div className="doc-container">
          <div className="doc-header-row">
            <div className="doc-eyebrow">{eyebrow}</div>
            <PrintButton />
          </div>
          <h1 className="doc-title">{title}</h1>
          <p className="doc-subtitle">{subtitle}</p>

          <article className="doc-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h2 id={slugify(extractText(children))}>{children}</h2>,
                h2: ({ children }) => <h2 id={slugify(extractText(children))}>{children}</h2>,
                h3: ({ children }) => <h3 id={slugify(extractText(children))}>{children}</h3>,
                pre: ({ children, ...rest }) => {
                  const child = Array.isArray(children) ? children[0] : children;
                  if (
                    isValidElement(child) &&
                    typeof (child.props as { className?: string }).className === "string" &&
                    (child.props as { className: string }).className.includes("language-mermaid")
                  ) {
                    const code = extractText(
                      (child.props as { children?: ReactNode }).children,
                    ).trim();
                    return <Mermaid code={code} />;
                  }
                  return <pre {...rest}>{children}</pre>;
                },
              }}
            >
              {body}
            </ReactMarkdown>
          </article>
        </div>
      </main>
    </div>
  );
}

interface TocEntry {
  id: string;
  text: string;
  depth: 2 | 3;
}

function buildToc(md: string): TocEntry[] {
  const out: TocEntry[] = [];
  const lines = md.split("\n");
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m2 = line.match(/^##\s+(.+?)\s*$/);
    const m3 = line.match(/^###\s+(.+?)\s*$/);
    if (m2) {
      const text = stripMd(m2[1]);
      out.push({ id: slugify(text), text, depth: 2 });
    } else if (m3) {
      const text = stripMd(m3[1]);
      out.push({ id: slugify(text), text, depth: 3 });
    }
  }
  return out;
}

function stripMd(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in children) {
    const props = (children as { props: { children?: ReactNode } }).props;
    return extractText(props.children);
  }
  return "";
}
