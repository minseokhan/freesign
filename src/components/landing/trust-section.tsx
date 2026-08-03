import { Card } from "@/components/ui/card";

type EvidenceStep = {
  step: string;
  title: string;
  description: string;
};

const STEPS: EvidenceStep[] = [
  {
    step: "1",
    title: "발송 시점에 내용을 동결",
    description:
      "서명 요청을 보내는 순간 계약 원문의 SHA-256 해시를 고정하고, RFC 3161 타임스탬프로 “이 시점에 이 내용이 있었다”를 제3자 기관 토큰으로 남깁니다.",
  },
  {
    step: "2",
    title: "상대방은 가입 없이 서명",
    description:
      "발주처 담당자는 메일로 받은 링크에서 바로 서명합니다. 가입도 앱 설치도 필요 없고, 동의 문구와 서명 시각·IP·브라우저가 함께 기록됩니다.",
  },
  {
    step: "3",
    title: "서명 시점에 원문 일치 검증",
    description:
      "서명이 들어오면 발송 때 동결한 해시와 대조해 한 글자라도 바뀌었으면 거절합니다. 완결 시점에도 다시 타임스탬프를 받습니다.",
  },
  {
    step: "4",
    title: "증거를 양측 메일함으로",
    description:
      "서명 완료 계약서 PDF와 감사추적(완결증명서) PDF를 양쪽에 발송합니다. 서비스에 접속하지 않아도 각자 영구 사본을 갖게 됩니다.",
  },
];

export function TrustSection() {
  return (
    <section aria-labelledby="trust-heading" className="space-y-2xl">
      <div className="max-w-2xl">
        <p className="text-sm font-medium text-brand-primary">
          쌍방 전자서명 · 증거력
        </p>
        <h2
          id="trust-heading"
          className="mt-md text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl"
        >
          &ldquo;그때 그렇게 합의했잖아요&rdquo;를 증명할 수 있게
        </h2>
        <p className="mt-md text-sm leading-relaxed text-text-body sm:text-base">
          말로 끝난 합의는 대금을 못 받을 때 아무것도 지켜주지 않습니다. 매듭은
          계약이 성립한 사실을 나중에 뒤집을 수 없는 형태로 남깁니다.
        </p>
      </div>

      <ol className="grid gap-lg md:grid-cols-2">
        {STEPS.map((item) => (
          <li key={item.step}>
            <Card className="flex h-full flex-col gap-md">
              <span
                aria-hidden="true"
                className="flex size-8 items-center justify-center rounded-full bg-brand-point text-sm font-semibold text-brand-primary tabular-nums"
              >
                {item.step}
              </span>
              <h3 className="text-lg font-semibold text-text-primary">
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed text-text-body">
                {item.description}
              </p>
            </Card>
          </li>
        ))}
      </ol>

      <p className="max-w-3xl text-xs leading-relaxed text-text-muted">
        서명 기록은 수정·삭제할 수 없고, 상대방 서명이 남은 계약은 삭제 대신
        &lsquo;무효화&rsquo;로만 처리됩니다. 타임스탬프는 RFC 3161 표준이라
        국내 공인 인증기관으로 교체해도 그대로 검증됩니다. 다만 매듭은 법률
        자문을 제공하지 않으며, 분쟁이 예상되는 계약은 전문가 검토를 권장합니다.
      </p>
    </section>
  );
}
