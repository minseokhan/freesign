import type { Metadata } from "next";
import Link from "next/link";

import {
  LegalDocument,
  LegalList,
  LegalSection,
} from "@/components/legal/legal-document";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "이용약관",
  description: `${LEGAL.serviceName} 서비스의 이용 조건, 유료 구독과 해지, 전자서명의 효력 범위와 책임 한계를 안내합니다.`,
};

export default function TermsPage() {
  return (
    <LegalDocument title="이용약관" effectiveDate={LEGAL.termsEffectiveDate}>
      <p className="text-sm leading-relaxed text-text-body">
        본 약관은 {LEGAL.serviceName}(이하 &ldquo;서비스&rdquo;)의 이용 조건과
        절차, 서비스와 이용자의 권리·의무를 정합니다.
      </p>

      <LegalSection id="terms-service" heading="제1조 (서비스의 내용)">
        <p>
          서비스는 프리랜서가 계약 작성, 전자서명, 인보이스 청구, 입금·미수금
          관리, 세금 정리를 하나의 흐름으로 처리할 수 있도록 돕는 도구입니다.
          서비스는 이용자를 대리해 계약을 체결하거나 대금을 수취하지 않으며,
          계약 당사자는 언제나 이용자와 그 거래 상대방입니다.
        </p>
      </LegalSection>

      <LegalSection id="terms-account" heading="제2조 (계정)">
        <LegalList
          items={[
            "서비스 이용을 위해서는 Google 계정으로 로그인해야 합니다.",
            "계정은 개인 1인용이며, 계정 정보를 타인과 공유해서는 안 됩니다.",
            "이용자는 언제든지 설정 화면에서 계정을 삭제할 수 있으며, 삭제 시 데이터는 즉시 파기됩니다.",
          ]}
        />
      </LegalSection>

      <LegalSection id="terms-ai" heading="제3조 (AI 생성 계약서의 성격)">
        <p>
          서비스는 인공지능을 이용해 계약서 초안과 조항 요약, 계약 인사이트를
          제공합니다. 이 결과물은 <strong>어디까지나 초안이며 법률 자문이 아닙니다.</strong>{" "}
          중요한 계약은 반드시 전문가의 검토를 거쳐야 하며, 초안을 그대로
          사용해 발생한 결과에 대한 책임은 서비스가 부담하지 않습니다.
        </p>
        <p>
          원천징수 계산 결과 또한 참고용이며 세무 신고를 대행하거나 세액을
          확정하지 않습니다.
        </p>
      </LegalSection>

      <LegalSection id="terms-signature" heading="제4조 (전자서명의 효력 범위)">
        <p>
          서비스가 제공하는 전자서명은 전자서명법상 인정사업자의{" "}
          <strong>공인전자서명이 아닙니다.</strong> 서비스는 문서 해시 동결,
          접속 기록, 제3자 타임스탬프(RFC 3161), 완결증명서를 통해 서명의
          진정성을 뒷받침하는 증거를 남기지만, 신원확인 수준은 이메일 링크
          소유 확인에 해당합니다.
        </p>
        <p>따라서 서비스는 입증력을 다음 두 단계로 구분해 표기합니다.</p>
        <LegalList
          items={[
            <>
              <strong>단독 기록</strong> — 이용자 본인만 서명한 상태. 계약
              내용과 시점의 기록으로서 의미를 가집니다.
            </>,
            <>
              <strong>맞서명</strong> — 거래 상대방까지 서명해 완결된 상태.
              양 당사자의 합의 증거가 갖춰집니다.
            </>,
          ]}
        />
        <p>
          두 단계 모두 분쟁 시 서명의 진정성립을 법정에서 다툴 여지가 있으며,
          서비스는 그 결과를 보증하지 않습니다.
        </p>
      </LegalSection>

      <LegalSection id="terms-billing" heading="제5조 (유료 구독과 해지)">
        <LegalList
          items={[
            "서비스는 무료 플랜과 유료 구독(Pro)으로 구성됩니다. 각 플랜의 기능 범위는 서비스 화면에 표시된 내용을 따릅니다.",
            <>
              유료 구독은 결제일을 기준으로 매월{" "}
              <strong>자동으로 갱신</strong>됩니다.
            </>,
            <>
              해지는{" "}
              <Link
                href="/billing"
                className="text-brand-primary underline underline-offset-2"
              >
                요금제
              </Link>{" "}
              화면의 구독 관리에서 언제든지 할 수 있으며, 해지해도 남은 결제
              기간까지는 유료 기능을 이용할 수 있습니다.
            </>,
            <>
              환불과 청약철회는{" "}
              <Link
                href="/legal/refund"
                className="text-brand-primary underline underline-offset-2"
              >
                환불 및 청약철회 정책
              </Link>
              을 따릅니다.
            </>,
            "구독을 해지하거나 무료 플랜으로 전환해도 기존 데이터는 삭제하지 않으며, 자동화 기능과 일부 화면만 잠깁니다.",
          ]}
        />
      </LegalSection>

      <LegalSection id="terms-data" heading="제6조 (데이터의 소유와 백업)">
        <p>
          이용자가 서비스에 입력하거나 생성한 계약·인보이스·정산 데이터의
          권리는 <strong>이용자에게 있습니다.</strong> 이용자는 설정 화면에서
          자신의 데이터 전체를 언제든지 파일로 내려받을 수 있습니다.
        </p>
        <p>
          서비스는 합리적인 수준의 백업을 수행하지만, 중요한 기록은 이용자가
          별도로 보관할 것을 권장합니다.
        </p>
      </LegalSection>

      <LegalSection id="terms-prohibited" heading="제7조 (금지 행위)">
        <LegalList
          items={[
            "타인의 개인정보를 정당한 권한 없이 입력하거나 이용하는 행위",
            "허위 계약서 작성 등 서비스를 위법한 목적으로 이용하는 행위",
            "서비스의 정상적인 운영을 방해하거나 비정상적인 방법으로 자동화된 요청을 보내는 행위",
            "서비스의 코드나 데이터를 무단으로 복제·변조·역설계하는 행위",
          ]}
        />
        <p>
          이용자는 클라이언트 정보 등 제3자의 개인정보를 입력할 때 해당
          제3자로부터 필요한 동의를 받을 책임을 집니다.
        </p>
      </LegalSection>

      <LegalSection id="terms-change" heading="제8조 (서비스의 변경과 중단)">
        <p>
          서비스는 기능을 개선하기 위해 내용을 변경할 수 있으며, 중대한 변경이나
          서비스 종료는 최소 30일 전에 공지합니다. 천재지변, 외부 서비스 장애 등
          불가피한 사유로 일시 중단될 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection id="terms-liability" heading="제9조 (책임의 제한)">
        <p>
          서비스는 이용자와 거래 상대방 사이의 분쟁, 계약 내용의 적법성, 대금
          지급 여부에 관여하지 않으며 책임지지 않습니다. 서비스의 고의 또는
          중과실이 없는 한, 서비스가 부담하는 손해배상 책임은 이용자가 최근 3개월
          동안 지급한 이용료를 넘지 않습니다.
        </p>
      </LegalSection>

      <LegalSection id="terms-law" heading="제10조 (준거법과 관할)">
        <p>
          본 약관은 대한민국 법률에 따라 해석되며, 서비스와 이용자 간 분쟁은
          민사소송법에 따른 관할 법원에 제기합니다.
        </p>
      </LegalSection>

      <LegalSection id="terms-privacy-link" heading="제11조 (개인정보의 처리)">
        <p>
          개인정보의 처리에 관한 사항은{" "}
          <Link
            href="/legal/privacy"
            className="text-brand-primary underline underline-offset-2"
          >
            개인정보처리방침
          </Link>
          에서 정합니다.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
