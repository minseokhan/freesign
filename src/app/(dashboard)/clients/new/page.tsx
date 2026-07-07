import Link from "next/link";

import { ClientForm } from "@/components/client-form";

export default function NewClientPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-xl">
      <div>
        <Link
          href="/clients"
          className="text-sm font-medium text-text-muted hover:text-brand-primary"
        >
          클라이언트 목록
        </Link>
        <h2 className="mt-sm text-2xl font-semibold tracking-tight text-text-primary">
          새 클라이언트
        </h2>
      </div>

      <ClientForm mode="create" />
    </div>
  );
}
