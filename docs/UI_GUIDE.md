# UI 디자인 가이드

> UX 원칙(계층·점진적 노출·일관성·대비·접근성·근접성·정렬)은 `UX_PRINCIPLES.md` 참조. 이 문서는 그 원칙을 구현하는 **구체적 시각 시스템(디자인 토큰·색·타이포·컴포넌트)**이다.

## 디자인 원칙
1. **도구처럼 보이되, 세련되게.** 마케팅 랜딩이 아니라 매일 여는 정산 대시보드. 정보 밀도·가독성이 우선이되, 넉넉한 여백·명확한 타이포 스케일·부드러운 엘리베이션으로 2025년대 프로덕트 감도를 낸다.
2. **뉴트럴 + 블루 1색.** 차분한 슬레이트 뉴트럴 위에 브랜드 블루 1색만 액션·강조에 쓴다. 색을 아낄수록 정산 신호색(완료/대기/미수)이 살아난다.
3. **돈의 상태는 3초 안에 읽힌다.** 완료(green)·대기/임박(amber)·미수/지연(red). 큰 tabular-nums 숫자 + 시맨틱 배지로 "내 돈이 어디까지 왔나"를 스캔으로.

## AI 슬롭 안티패턴 — 하지 마라
| 금지 사항 | 이유 |
|-----------|------|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text (배경 그라데이션 텍스트) | AI가 만든 SaaS 랜딩의 1번 특징 |
| "Powered by AI" 배지 | 기능이 아니라 장식. 사용자에게 가치 없음 |
| box-shadow 글로우 애니메이션 | 네온 글로우 = AI 슬롭 (부드러운 elevation 그림자는 허용) |
| 보라/인디고 브랜드 색상 | "AI = 보라색" 클리셰 (우리는 블루 1색) |
| 모든 카드에 동일한 rounded-2xl | 균일한 둥근 모서리는 템플릿 느낌 (radius 토큰 위계 사용) |
| 배경 gradient orb (blur-3xl 원형) | 모든 AI 랜딩 페이지에 있는 장식 |

> "트렌디"의 방향은 **글래스·그라데이션·네온이 아니라** 강한 타이포 위계, 넉넉한 여백, 부드러운 소프트 섀도우, 절제된 모션이다. 유행하는 슬롭 장식은 위 표로 계속 배제한다.

---

## 디자인 토큰

### 스페이싱 (4px 베이스)
`xs 4 · sm 8 · md 12 · lg 16 · xl 24 · 2xl 32 · 3xl 48`
- 카드 내부 패딩 `xl(24)`, 섹션 간 `2xl(32)`, 폼 필드 간 `lg(16)`, 인라인 요소 `sm~md`.

### 라디우스 (위계)
| 토큰 | 값 | 용도 |
|------|----|------|
| sm | 6px | 배지·태그·인풋 |
| md | 10px | 버튼·작은 카드 |
| lg | 14px | 카드·패널·모달 |
| full | 9999px | 상태 pill·아바타 |

> 전부 같은 반경을 쓰지 않는다(안티슬롭). 요소 크기에 비례해 위 4단계를 사용.

### 엘리베이션 (소프트 섀도우 — 글로우 아님)
| 레벨 | 값 |
|------|----|
| flat | `border border-slate-200` (테이블·인라인) |
| raised | `shadow-[0_1px_2px_rgba(15,23,42,0.06),0_1px_3px_rgba(15,23,42,0.10)]` (카드) |
| overlay | `shadow-[0_8px_24px_rgba(15,23,42,0.12)]` (드롭다운·모달·토스트) |

> 카드는 무거운 테두리 대신 얕은 섀도우 + 옅은 보더로 떠 있는 느낌. 컬러 글로우·펄스 금지.

### 타이포 스케일
폰트: **Pretendard**(본문·한글) / 숫자는 tabular-nums. 큰 제목은 `tracking-tight`.

| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | text-2xl font-semibold tracking-tight text-slate-900 |
| 섹션 제목 | text-lg font-semibold text-slate-900 |
| KPI 숫자 | text-3xl font-bold tabular-nums tracking-tight text-slate-900 |
| 카드 라벨/캡션 | text-xs font-medium uppercase tracking-wide text-slate-500 |
| 본문 | text-sm text-slate-700 leading-relaxed |
| 금액 | tabular-nums, 통화 `₩` 접두, 우측 정렬 |

---

## 색상
### 표면 (뉴트럴)
| 용도 | 값 |
|------|------|
| 페이지 배경 | #f8fafc (slate-50) |
| 카드/패널 | #ffffff |
| 보조 표면(호버·헤더 셀) | #f1f5f9 (slate-100) |
| 경계선 | #e2e8f0 (slate-200) |
| 강한 경계(포커스 주변) | #cbd5e1 (slate-300) |

### 텍스트
| 용도 | 값 |
|------|------|
| 제목 | #0f172a (slate-900) |
| 본문 | #334155 (slate-700) |
| 보조 | #64748b (slate-500) |
| 비활성 | #94a3b8 (slate-400) |

### 브랜드 포인트 (블루 1색)
| 용도 | 값 |
|------|------|
| Primary(버튼·링크·활성 탭) | #2563eb (blue-600) |
| Primary hover | #1d4ed8 (blue-700) |
| 포커스 링 | #3b82f6 (blue-500), 2px |
| 포인트 배경(선택·배지·활성 내비) | #eff6ff (blue-50) |

### 시맨틱 색상 (정산 상태 신호)
| 용도 | 전경 | 배경 |
|------|------|------|
| 완료 / 입금(paid) | #16a34a (green-600) | #f0fdf4 |
| 대기 / 임박(unpaid·due 임박) | #d97706 (amber-600) | #fffbeb |
| 미수 / 지연(overdue) | #dc2626 (red-600) | #fef2f2 |
| 중립 / draft·canceled | #64748b (slate-500) | #f1f5f9 |

> 시맨틱 색은 **상태 배지·금액 강조·대시보드 하이라이트**에만. 일반 UI 강조는 블루 포인트만 사용해 신호를 희석하지 않는다. 상태는 색 + **텍스트 라벨 병기**(색각 이상 대비, §접근성).

---

## 컴포넌트
### 카드
```
rounded-[14px] bg-white border border-slate-200
shadow-[0_1px_2px_rgba(15,23,42,0.06),0_1px_3px_rgba(15,23,42,0.10)] p-6
```
### KPI 스탯 카드 (대시보드 계층 1)
```
카드 안: 라벨(text-xs uppercase tracking-wide text-slate-500)
        + 값(text-3xl font-bold tabular-nums text-slate-900)
        + 델타/보조(text-xs, 시맨틱 색)
```
### 상태 배지 (pill, 전 화면 동일)
```
완료: rounded-full bg-green-50 text-green-700 border border-green-200 px-2.5 py-0.5 text-xs font-medium
임박: rounded-full bg-amber-50 text-amber-700 border border-amber-200 ...
지연: rounded-full bg-red-50   text-red-700   border border-red-200 ...
중립: rounded-full bg-slate-100 text-slate-600 border border-slate-200 ...
※ 색 옆에 항상 텍스트 라벨(입금완료/미수/지연) 포함
```
> **예외 — 대시보드 계약 파이프라인 단계 배지**: 상태 배지의 "전 화면 동일 색" 원칙에서 유일한 예외. signed/active가 상태 배지에선 모두 amber라 인접 단계가 겹치므로, 파이프라인만 진행감을 주는 별도 팔레트(draft=slate·signed=blue-50·active=amber·done=green)를 쓴다.
### 버튼
```
Primary:   rounded-[10px] bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800
           px-4 py-2 text-sm font-medium transition-colors
           focus-visible:ring-2 ring-blue-500 ring-offset-2
           disabled:opacity-50 disabled:pointer-events-none   (제출 중 비활성)
Secondary: rounded-[10px] bg-white text-slate-700 border border-slate-200 hover:bg-slate-50
Text:      text-slate-500 hover:text-slate-800
Danger:    rounded-[10px] text-red-600 hover:bg-red-50   (soft-delete·취소·되돌리기 — 일반 액션과 분리 배치)
```
### 입력 필드
```
rounded-[6px] bg-white border border-slate-300 px-3 py-2 text-sm
focus: border-blue-500 ring-2 ring-blue-500/30 outline-none
error: border-red-500  (+ 필드 하단 text-red-600 text-xs, aria-describedby 연결)
라벨: text-sm font-medium text-slate-700 (label-input 연결, 터치 타깃 ≥44px)
```
### 스텝 인디케이터 (`/contracts/new` 점진적 노출)
```
현재 단계 blue-600 채움 + 라벨, 완료 단계 green 체크, 이후 단계 slate-300
"구조화 입력 · 초안 생성 · 저장"(3단계) 진행 위치 표시, 마지막 버튼은 "초안 저장"
조항 편집은 별도 페이지(`/contracts/[id]/edit`)로 분리
```
### 면책 배너 (AI 초안·원천징수 — 비차단 경고)
```
rounded-[10px] bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2
"AI 초안이며 법적 자문이 아닙니다. 전문가 검토를 권장합니다." / "참고용 계산입니다."
```
### 빈 상태 (empty state)
```
중앙 정렬(예외): 옅은 아이콘 + 문구(text-slate-500) + Primary CTA
예) "아직 계약이 없어요" + [계약 만들기] / 첫 진입 → [데모 데이터 채우기]
```
### 이력 타임라인 (증빙 체인)
```
좌측 세로선 + 노드(단일 브랜드 블루 고정) + 시각(text-slate-500) + 설명
생성·서명·발행·입금·되돌리기·취소를 시간 역순 또는 순차로
```
### 테이블 (목록)
```
헤더: bg-slate-100 text-xs uppercase tracking-wide text-slate-500
행: hover:bg-slate-50, 금액 열 우측 정렬 tabular-nums, 상태 열 배지
zebra 없이 얇은 구분선(border-slate-200)로 밀도 유지
```

## 레이아웃
- 전체 너비: `max-w-6xl`(대시보드·리포트·목록), 상세/폼은 `max-w-3xl`.
- 좌측 사이드 내비(대시보드 그룹, 활성 항목 blue-50 배경 + blue-600 텍스트) + 상단 페이지 헤더(제목 + 우상단 primary 액션).
- 정렬: 좌측 정렬 기본, 숫자·금액은 우측 정렬. 중앙 정렬은 빈 상태 CTA에만.
- 그리드: 대시보드 KPI는 반응형 그리드(`grid-cols-1 md:grid-cols-3`, 카드 3개: 미수금 합계·이달 수익·이번 달 예정 입금), 간격 `lg~xl`.

## 모션
- 허용: fade/slide-in `150–200ms ease-out`(카드·모달 등장), 색 전환 `transition-colors 150ms`, 낙관적 토글은 **즉시** 반영.
- 금지: 글로우·펄스·플로트·무한 루프 애니메이션, 등장 시 과장된 bounce.
- 접근성: `prefers-reduced-motion` 존중 — 모션 최소화 모드에서 트랜지션 제거.
- AI 처리 대기: AI 로딩 안내(`ai-processing-notice.tsx`)는 블루 계열(`border-blue-200 bg-brand-point`) 박스 + 작은 회전 스피너로 비차단 진행 상태를 알린다(글로우·펄스 아님).

## 아이콘
- SVG 인라인, `strokeWidth 1.5`(lucide 계열). 크기 위계 `16 / 20 / 24`.
- 아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다.
- 의미 있는 아이콘엔 `aria-label`, 장식용엔 `aria-hidden`.
- 채널 태그(인스타·링크드인·유튜브·직거래·크몽·추천·기타)는 색 배지 + 텍스트 라벨로 구분(브랜드 로고 남용 금지).

## 접근성 (요약 — 상세 §UX_PRINCIPLES)
- 색 대비 WCAG AA(본문 4.5:1, UI 3:1) 이상. 상태는 색만이 아니라 라벨 병기.
- 전 인터랙션 키보드 도달·조작, 포커스 링(blue-500 2px) 명시.
- 폼 라벨-인풋 연결, 에러 `aria-describedby`, 터치 타깃 ≥44px.
