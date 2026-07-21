import { Badge } from "@/components/ui/badge";
import type { Plan } from "@/lib/plan";

export function PlanBadge({ plan }: { plan: Plan }) {
  if (plan === "pro") {
    return <Badge variant="success">Pro</Badge>;
  }

  return <Badge variant="neutral">Free</Badge>;
}
