import type { Metadata } from "next";
import Link from "next/link";

import {
  LegalDocument,
  LegalList,
  LegalSection,
  LegalTable,
} from "@/components/legal/legal-document";
import { COLLECTED_DATA, DATA_PROCESSORS, LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: `${LEGAL.serviceName}이 수집하는 개인정보 항목과 이용·보관·파기 절차, 처리위탁 및 국외 이전 현황을 안내합니다.`,
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="개인정보처리방침"
      effectiveDate={LEGAL.privacyEffectiveDate}
    >
      <p className="text-sm leading-relaxed text-text-body">
        {LEGAL.serviceName}(이하 &ldquo;서비스&rdquo;)은 이용자의 개인정보를
        중요하게 생각하며, 개인정보 보호법 등 관련 법령을 준수합니다. 본
        방침은 서비스가 어떤 개인정보를 어떤 목적으로 처리하고 얼마나 보관하며
        어떻게 파기하는지를 안내합니다.
      </p>

      <LegalSection id="privacy-items" heading="1. 수집하는 개인정보 항목">
        <p>
          서비스는 아래 항목만 처리합니다. 주민등록번호 등 고유식별정보는
          수집하지 않으며, 카드번호 등 결제수단 정보는 저장하지 않습니다.
        </p>
        <LegalTable
          caption="수집하는 개인정보 항목"
          headers={["구분", "항목", "수집 경로"]}
          rows={COLLECTED_DATA.map((entry) => [
            entry.category,
            <>
              <p>{entry.items}</p>
              {entry.note ? (
                <p className="mt-xs text-xs text-text-muted">{entry.note}</p>
              ) : null}
            </>,
            entry.source,
          ])}
        />
      </LegalSection>

      <LegalSection id="privacy-purpose" heading="2. 개인정보의 처리 목적">
        <LegalList
          items={[
            "회원 식별 및 로그인 등 계정 관리",
            "계약·전자서명·인보이스·정산 기록의 생성과 보관",
            "서명 요청, 완결 안내, 미수금 독촉 등 이용자가 요청한 이메일 발송",
            "유료 구독의 결제·갱신·해지 처리",
            "서비스 이용 분석, 오류 대응 및 품질 개선",
          ]}
        />
      </LegalSection>

      <LegalSection id="privacy-retention" heading="3. 보유 및 이용 기간">
        <p>
          원칙적으로 회원 탈퇴 시 지체 없이 파기합니다. 다만 아래 정보는 관계
          법령에 따라 정해진 기간 동안 보관합니다.
        </p>
        <LegalList
          items={[
            <>
              전자상거래 등에서의 소비자보호에 관한 법률에 따라{" "}
              <strong>대금결제 및 재화 등의 공급에 관한 기록은 5년</strong>{" "}
              보존합니다. 이 경우 이용자를 식별할 수 있는 정보는 삭제하고 결제
              사실만 익명으로 남깁니다.
            </>,
            "계약·인보이스 등 이용자가 직접 생성한 기록은 이용자가 삭제하거나 회원을 탈퇴할 때까지 보관합니다.",
            "서명 요청 링크는 만료일이 지나면 사용할 수 없으며, 서명 기록은 계약 기록의 일부로 함께 보관됩니다.",
          ]}
        />
      </LegalSection>

      <LegalSection
        id="privacy-processors"
        heading="4. 처리위탁 및 개인정보의 국외 이전"
      >
        <p>
          서비스는 안정적인 운영을 위해 아래와 같이 개인정보 처리를 위탁하고
          있으며, 수탁자의 서버가 국외에 있어 개인정보가 국외로 이전됩니다.
          이용자는 국외 이전을 거부할 수 있으나, 이 경우 서비스 이용이 제한될
          수 있습니다(거부 방법: 회원 탈퇴).
        </p>
        <LegalTable
          caption="처리위탁 및 국외 이전 현황"
          headers={["수탁자", "이전 국가", "이전 목적", "이전 항목", "보유 기간"]}
          rows={DATA_PROCESSORS.map((processor) => [
            processor.name,
            processor.country,
            processor.purpose,
            processor.items,
            processor.retention,
          ])}
        />
        <p className="text-xs text-text-muted">
          이전 방법: 서비스 이용 과정에서 정보통신망을 통해 암호화된 상태로
          전송됩니다.
        </p>
      </LegalSection>

      <LegalSection id="privacy-third-party" heading="5. 제3자 제공">
        <p>
          서비스는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만
          이용자가 서명 요청이나 인보이스 발송을 실행하는 경우, 이용자가 지정한
          수신자에게 해당 계약·청구 내용이 전달됩니다. 이는 이용자의 지시에 따른
          발송이며 서비스의 제3자 제공이 아닙니다.
        </p>
      </LegalSection>

      <LegalSection id="privacy-rights" heading="6. 정보주체의 권리와 행사 방법">
        <p>
          이용자는 언제든지 자신의 개인정보에 대해 열람·정정·삭제·처리정지를
          요구할 수 있습니다. 서비스는 이를 화면에서 직접 수행할 수 있도록
          제공합니다.
        </p>
        <LegalList
          items={[
            <>
              <strong>열람 및 전송</strong> —{" "}
              <Link
                href="/settings"
                className="text-brand-primary underline underline-offset-2"
              >
                설정
              </Link>{" "}
              화면의 &ldquo;내 데이터 내보내기&rdquo;에서 보관 중인 데이터
              전체를 기계 판독이 가능한 JSON 파일로 내려받을 수 있습니다.
            </>,
            "정정 — 프로필·클라이언트·계약·인보이스 각 화면에서 직접 수정할 수 있습니다.",
            "삭제 — 설정 화면의 계정 삭제로 모든 데이터를 즉시 파기할 수 있습니다(3항의 법정 보존 기록 제외).",
          ]}
        />
      </LegalSection>

      <LegalSection id="privacy-destruction" heading="7. 파기 절차 및 방법">
        <p>
          보유 기간이 지나거나 처리 목적이 달성된 개인정보는 지체 없이
          파기합니다. 전자적 파일은 복구할 수 없는 방법으로 영구 삭제하며,
          업로드된 계약 문서와 서명 이미지는 저장소에서 함께 삭제됩니다.
        </p>
      </LegalSection>

      <LegalSection id="privacy-security" heading="8. 안전성 확보 조치">
        <LegalList
          items={[
            "데이터베이스 행 수준 보안(RLS)으로 이용자별 데이터를 분리하고, 다른 이용자의 데이터에 접근할 수 없도록 통제합니다.",
            "업로드 파일은 비공개 저장소에 보관하며, 열람은 단기간만 유효한 서명된 링크로만 가능합니다.",
            "모든 통신은 전송 구간에서 암호화됩니다.",
            "외부 연동에 사용하는 비밀값은 평문으로 저장하지 않습니다.",
          ]}
        />
      </LegalSection>

      <LegalSection id="privacy-cookies" heading="9. 쿠키 등 자동 수집 장치">
        <p>
          서비스는 로그인 상태 유지를 위해 필수 쿠키를 사용합니다. 또한 서비스
          개선을 위해 이용 기록을 분석 도구로 수집하며, 브라우저 설정에서 쿠키
          저장을 거부할 수 있습니다. 다만 필수 쿠키를 차단하면 로그인이
          유지되지 않습니다.
        </p>
      </LegalSection>

      <LegalSection id="privacy-officer" heading="10. 개인정보 보호책임자">
        <p>
          개인정보 처리에 관한 문의·불만·피해 구제는 아래로 연락해 주시기
          바랍니다.
        </p>
        <dl className="space-y-xs">
          <div className="flex gap-sm">
            <dt className="w-24 shrink-0 text-text-muted">성명</dt>
            <dd>{LEGAL.privacyOfficer.name}</dd>
          </div>
          <div className="flex gap-sm">
            <dt className="w-24 shrink-0 text-text-muted">연락처</dt>
            <dd>{LEGAL.privacyOfficer.email}</dd>
          </div>
        </dl>
        <p className="text-xs text-text-muted">
          개인정보 침해에 대한 신고·상담이 필요하면 개인정보침해신고센터
          (118), 대검찰청 사이버수사과(1301), 경찰청 사이버수사국(182)에 문의할
          수 있습니다.
        </p>
      </LegalSection>

      <LegalSection id="privacy-changes" heading="11. 방침의 변경">
        <p>
          본 방침의 내용을 변경할 경우 시행일 최소 7일 전부터 서비스 화면을 통해
          공지합니다. 이용자에게 불리한 변경은 30일 전에 공지합니다.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
