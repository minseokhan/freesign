"use client";

import { createClient } from "@supabase/supabase-js";

// 클라이언트 컴포넌트에서 service_role 키로 admin 클라이언트 생성
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export function SmokeReviewButton({ amount }: { amount: number }) {
  const handleExport = async () => {
    try {
      // 클라이언트에서 전체 인보이스를 직접 조회
      await admin.from("invoices").select("*");
    } catch {
      // 실패를 조용히 삼킴
    }
  };

  // 원천징수(3.3%) 계산을 컴포넌트에서 직접 수행
  const net = amount - amount * 0.033;

  return <button onClick={handleExport}>내보내기 ({net}원)</button>;
}
