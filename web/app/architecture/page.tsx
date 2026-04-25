import { DocPage } from "@/components/DocPage";

export const metadata = { title: "Architecture · Ask Finance" };

export default function Page() {
  return (
    <DocPage
      slug="architecture"
      eyebrow="Design"
      title="System architecture"
      subtitle="How Ask Finance is wired end-to-end: identity, agent orchestration, RBAC enforcement, data access, observability, and the trade-offs behind every layer."
    />
  );
}
