# docs/archive — 완료된 작업의 계획서

여기 있는 문서는 **이미 구현이 끝난 작업의 계획 원본**이다. 할 일이 아니라 기록이다.

- **정본은 여기가 아니다.** 확정된 결정은 `docs/ADR.md`, 현재 구조는 `docs/ARCHITECTURE.md`·`docs/DATABASE.md`,
  코드와 마이그레이션이 최종 사실이다. 계획서는 실행 중 바뀐 부분이 있어 세부가 다를 수 있다.
- **읽어야 할 때**: "왜 이렇게 됐나"의 배경·대안 비교·당시 트레이드오프를 찾을 때만.
- **살아 있는 잔여 항목은 여기에 두지 않는다.** 아카이브 시점에 남아 있던 미결 항목은
  `docs/PRODUCT_BACKLOG.md`(제품)·`docs/SECURITY_NEXT_STEPS.md`(보안·운영)로 옮겼다.

## 목록

| 문서                          | 무엇을 했나                             | 결론 정본 |
| ----------------------------- | --------------------------------------- | --------- |
| `SIGNATURE_V2_PLAN.md`        | 쌍방 전자서명 v2 (비로그인 맞서명)      | ADR-009   |
| `SIGNATURE_V2_FIXES_PLAN.md`  | v2 수동 E2E 피드백 7건 수정 (`0022`·`0023`) | ADR-009   |
| `BILLING_PLAN.md`             | Polar 구독 결제 + Free/Pro 도입 (`0024`~`0026`) | ADR-010   |
| `PRO_FEATURES_PLAN.md`        | Pro 3기능 — 독촉·반복 인보이스·AI 인사이트 (`0027`~`0031`) | ADR-011 (ADR-010 갱신) |
| `SECURITY_REMEDIATION_PLAN.md`| OWASP 스캔 47건 수정 (`0032`~`0045`)    | `docs/SECURITY_NEXT_STEPS.md` |
| `LIGHTHOUSE_LOOP_PLAN.md`     | 성능 최적화 루프 설계·실행 (86.6 → 98.6) | `/lighthouse-loop` 스킬 |
| `LEGAL_ACCOUNT_PLAN.md`       | 법적 고지 3장 + 계정 삭제·내보내기 (`0047`·`0048`) | ADR-012   |
| `INVOICE_DELIVERY_PLAN.md`    | 인보이스 전달 경로(공개 청구서 링크) (`0046`) | ADR-013   |

## 옛 경로 참조

이 8편은 원래 `docs/` 바로 아래 있었다. **이미 적용된 마이그레이션 SQL 주석과 `phases/` 실행 기록은
그 시점의 스냅샷이라 일부러 고치지 않았으므로**, 거기서 `docs/<이름>.md`를 보면 `docs/archive/<이름>.md`로 읽으면 된다.
