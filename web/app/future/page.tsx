import { DocPage } from "@/components/DocPage";

export const metadata = { title: "Roadmap · Ask Finance" };

export default function Page() {
  return (
    <DocPage
      slug="future"
      eyebrow="Roadmap"
      title="From prototype to production"
      subtitle="Phased plan to scale Ask Finance across BUs — real connectors, RAG over finance knowledge, dimensional RBAC, multi-tenant cost controls, and what we explicitly will not do."
    />
  );
}
