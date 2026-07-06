# UI 디자인 가이드

## 디자인 원칙
1. **도구처럼 보여야 한다.** 마케팅 랜딩이 아니라 프리랜서가 매일 여는 정산 대시보드. 정보 밀도와 가독성이 화려함보다 우선.
2. **라이트 테마 + 블루 포인트 1색.** 중립 배경 위에 브랜드 블루 1색만 액션·강조에 쓴다. 색을 아껴 쓸수록 시맨틱 신호색(완료/대기/미수)이 눈에 띈다.
3. **돈의 상태는 색으로 즉시 읽힌다.** 완료(green)·대기/임박(amber)·미수/지연(red). "내 돈이 어디까지 왔나"를 한눈에.

## AI 슬롭 안티패턴 — 하지 마라
| 금지 사항 | 이유 |
|-----------|------|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text (배경 그라데이션 텍스트) | AI가 만든 SaaS 랜딩의 1번 특징 |
| "Powered by AI" 배지 | 기능이 아니라 장식. 사용자에게 가치 없음 |
| box-shadow 글로우 애니메이션 | 네온 글로우 = AI 슬롭 |
| 보라/인디고 브랜드 색상 | "AI = 보라색" 클리셰 (우리는 블루 1색) |
| 모든 카드에 동일한 rounded-2xl | 균일한 둥근 모서리는 템플릿 느낌 |
| 배경 gradient orb (blur-3xl 원형) | 모든 AI 랜딩 페이지에 있는 장식 |

## 색상
### 배경
| 용도 | 값 |
|------|------|
| 페이지 | #f8fafc (slate-50) |
| 카드 | #ffffff |
| 보조 배경(호버·구분) | #f1f5f9 (slate-100) |
| 경계선 | #e2e8f0 (slate-200) |

### 텍스트
| 용도 | 값 |
|------|------|
| 주 텍스트(제목) | #0f172a (slate-900) |
| 본문 | #334155 (slate-700) |
| 보조 | #64748b (slate-500) |
| 비활성 | #94a3b8 (slate-400) |

### 브랜드 포인트 (블루 1색)
| 용도 | 값 |
|------|------|
| Primary(버튼·링크·활성 탭) | #2563eb (blue-600) |
| Primary hover | #1d4ed8 (blue-700) |
| 포인트 배경(선택·배지) | #eff6ff (blue-50) |

### 데이터/시맨틱 색상 (정산 상태 신호)
| 용도 | 값 |
|------|------|
| 완료 / 입금(paid) | #16a34a (green-600) · 배경 #f0fdf4 |
| 대기 / 임박(due 임박·unpaid) | #d97706 (amber-600) · 배경 #fffbeb |
| 미수 / 지연(overdue) | #dc2626 (red-600) · 배경 #fef2f2 |
| 중립 / draft·canceled | #64748b (slate-500) · 배경 #f1f5f9 |

> 시맨틱 색은 **상태 배지·금액 강조·대시보드 하이라이트**에만. 일반 UI 강조는 블루 포인트만 사용해 신호색을 희석하지 않는다.

## 컴포넌트
### 카드
```
rounded-lg bg-white border border-slate-200 p-6
```
### 상태 배지
```
완료: rounded-full bg-green-50 text-green-700 border border-green-200 px-2.5 py-0.5 text-xs font-medium
임박: rounded-full bg-amber-50 text-amber-700 border border-amber-200 ...
지연: rounded-full bg-red-50   text-red-700   border border-red-200 ...
중립: rounded-full bg-slate-100 text-slate-600 border border-slate-200 ...
```
### 버튼
```
Primary:   rounded-lg bg-blue-600 text-white hover:bg-blue-700 px-4 py-2 text-sm font-medium
Secondary: rounded-lg bg-white text-slate-700 border border-slate-200 hover:bg-slate-50
Text:      text-slate-500 hover:text-slate-800
Danger:    rounded-lg text-red-600 hover:bg-red-50   (soft-delete·취소 등)
```
### 입력 필드
```
rounded-lg bg-white border border-slate-300 px-3 py-2 text-sm
focus: border-blue-600 ring-1 ring-blue-600
error: border-red-500 (+ 필드 하단 text-red-600 text-xs)
```
### 면책 배너 (AI 초안·원천징수)
```
rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2
"AI 초안이며 법적 자문이 아닙니다. 전문가 검토를 권장합니다." / "참고용 계산입니다."
```

## 레이아웃
- 전체 너비: `max-w-6xl` (대시보드·리포트), 상세 폼은 `max-w-3xl`.
- 정렬: 좌측 정렬 기본. 지표 숫자는 우측 정렬(금액 정렬 가독성).
- 간격: 카드 내 `gap-4`, 섹션 간 `space-y-6`.
- 사이드 내비(대시보드 그룹) + 상단 페이지 헤더.

## 타이포그래피
| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | text-2xl font-semibold text-slate-900 |
| 지표 숫자(KPI) | text-3xl font-bold text-slate-900 (tabular-nums) |
| 카드 제목/라벨 | text-sm font-medium text-slate-500 |
| 본문 | text-sm text-slate-700 leading-relaxed |
| 금액 | tabular-nums (자릿수 정렬), 통화 "₩" 접두 |

## 애니메이션
- fade-in (0.2s), 낙관적 토글 상태 전환(즉시).
- 그 외 모든 장식성 애니메이션(글로우·플로트·펄스) 금지.

## 아이콘
- SVG 인라인, `strokeWidth 1.5` (lucide 계열).
- 아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다.
- 채널 태그(인스타·링크드인·유튜브 등)는 색 배지 + 텍스트 라벨로 구분(브랜드 로고 남용 금지).
