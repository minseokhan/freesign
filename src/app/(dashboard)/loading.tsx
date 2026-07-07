import { Card } from "@/components/ui/card";

export default function DashboardLoading() {
  return (
    <div className="grid gap-lg md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <Card aria-hidden="true" className="space-y-md" key={index}>
          <div className="h-3 w-24 animate-pulse rounded-sm bg-slate-200" />
          <div className="h-8 w-32 animate-pulse rounded-sm bg-slate-200" />
          <div className="h-3 w-20 animate-pulse rounded-sm bg-slate-100" />
        </Card>
      ))}
    </div>
  );
}
