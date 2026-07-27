// 반복 스케줄 목록 필터(순수 함수). 조회는 RSC에서 active 컬럼으로 좁힌다.
export const RECURRING_FILTERS = ["all", "active", "paused"] as const;

export type RecurringFilter = (typeof RECURRING_FILTERS)[number];

export const RECURRING_FILTER_OPTIONS: ReadonlyArray<{
  value: RecurringFilter;
  label: string;
}> = [
  { value: "all", label: "전체" },
  { value: "active", label: "활성" },
  { value: "paused", label: "일시중지" },
];

/** searchParams의 raw 값 → 필터. 누락·미지의 값은 전체로 처리한다. */
export function parseRecurringFilter(raw: string | undefined): RecurringFilter {
  return RECURRING_FILTERS.includes(raw as RecurringFilter)
    ? (raw as RecurringFilter)
    : "all";
}
