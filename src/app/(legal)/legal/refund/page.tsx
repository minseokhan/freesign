import type { Metadata } from "next";
import Link from "next/link";

import {
  LegalDocument,
  LegalList,
  LegalSection,
} from "@/components/legal/legal-document";
import { LEGAL, listUnfilledLegalFields } from "@/lib/legal";

export const metadata: Metadata = {
  title: "환불 및 청약철회 정책",
  description: `${LEGAL.serviceName} 유료 구독의 청약철회 기간, 환불 기준, 해지 방법과 사업자 정보를 안내합니다.`,
};

const BUSINESS_INFO: readonly { label: string; value: string }[] = [
  { label: "상호", value: LEGAL.operatorName },
  { label: "대표자", value: LEGAL.representative },
  { label: "사업자등록번호", value: LEGAL.businessRegistrationNumber },
  { label: "통신판매업 신고번호", value: LEGAL.mailOrderSalesNumber },
  { label: "사업장 주소", value: LEGAL.address },
  { label: "문의", value: LEGAL.contactEmail },
];

export default function RefundPage() {
  // 값이 아직 없다는 사실을 이용자에게 숨기지 않는다. 결제를 켜기 전 반드시 채워야 한다.
  const hasUnfilled = listUnfilledLegalFields().length > 0;

  return (
    <LegalDocument
      title="환불 및 청약철회 정책"
      effectiveDate={LEGAL.refundEffectiveDate}
    >
      <p className="text-sm leading-relaxed text-text-body">
        본 정책은 {LEGAL.serviceName}의 유료 구독에 대한 청약철회와 환불 기준을
        정합니다. 전자상거래 등에서의 소비자보호에 관한 법률을 따르며, 법령이
        정한 이용자의 권리를 제한하지 않습니다.
      </p>

      <LegalSection id="refund-withdrawal" heading="1. 청약철회">
        <LegalList
          items={[
            <>
              결제일로부터 <strong>7일</strong> 이내에 유료 기능을 사용하지
              않았다면 전액 환불받을 수 있습니다.
            </>,
            "유료 기능을 이미 사용한 경우에도 결제일로부터 7일 이내라면 청약철회를 요청할 수 있으며, 이때 사용한 기간에 해당하는 금액을 공제하고 환불합니다.",
            "구독 갱신 결제 역시 같은 기준을 적용합니다.",
          ]}
        />
      </LegalSection>

      <LegalSection id="refund-standard" heading="2. 환불 기준">
        <LegalList
          items={[
            <>
              청약철회 기간이 지난 뒤의 중도 해지는 남은 기간에 대해{" "}
              <strong>일할</strong> 계산한 금액을 환불합니다.
            </>,
            "서비스의 중대한 장애로 유료 기능을 상당 기간 이용할 수 없었던 경우, 해당 기간만큼 환불하거나 이용 기간을 연장합니다.",
            "이용자의 약관 위반으로 이용이 제한된 경우에는 환불하지 않을 수 있습니다.",
          ]}
        />
        <p className="text-xs text-text-muted">
          환불은 요청일로부터 영업일 기준 3일 이내에 처리하며, 결제 수단에 따라
          실제 입금까지 며칠이 더 걸릴 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection id="refund-cancel" heading="3. 구독 해지 방법">
        <p>
          구독 해지는{" "}
          <Link
            href="/billing"
            className="text-brand-primary underline underline-offset-2"
          >
            요금제
          </Link>{" "}
          화면의 구독 관리에서 직접 할 수 있습니다. 해지하면 다음 결제부터
          청구되지 않으며, 이미 결제한 기간이 끝날 때까지는 유료 기능을 계속
          이용할 수 있습니다.
        </p>
        <p>
          해지 후에도 데이터는 삭제되지 않습니다. 데이터까지 지우려면 설정
          화면에서 계정을 삭제해 주세요.
        </p>
      </LegalSection>

      <LegalSection id="refund-request" heading="4. 환불 요청 방법">
        <p>
          아래 사업자 정보의 문의처로 계정 이메일과 환불 사유를 보내주시면
          확인 후 처리합니다.
        </p>
      </LegalSection>

      <section aria-labelledby="refund-business" className="space-y-md">
        <h2
          id="refund-business"
          className="text-lg font-semibold tracking-tight text-text-primary"
        >
          5. 사업자 정보
        </h2>

        {hasUnfilled ? (
          <p
            role="status"
            className="rounded-md border border-status-waiting-fg/30 bg-status-waiting-bg px-md py-sm text-sm text-text-body"
          >
            사업자 등록을 준비 중이며, 아래 정보는 등록이 완료되는 대로
            기입됩니다. 현재 유료 구독 결제는 제공되지 않습니다.
          </p>
        ) : null}

        <dl className="space-y-xs text-sm text-text-body">
          {BUSINESS_INFO.map((item) => (
            <div key={item.label} className="flex gap-sm">
              <dt className="w-32 shrink-0 text-text-muted">{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </LegalDocument>
  );
}
