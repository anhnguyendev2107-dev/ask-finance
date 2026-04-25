import { DocPage } from "@/components/DocPage";

export const metadata = { title: "Evaluation · Ask Finance" };

export default function Page() {
  return (
    <DocPage
      slug="evaluation"
      eyebrow="Quality"
      title="Evaluation design"
      subtitle="Three loops — offline regression, online behaviour, ops monitoring — with concrete metrics, golden datasets, RBAC red-team suites, and launch gates."
    />
  );
}
