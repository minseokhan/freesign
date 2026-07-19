// 목록 페이지네이션의 순수 계산 로직 — 페이지 파싱·범위·표시 항목.
// 렌더링은 components/pagination.tsx, 데이터 조회는 각 RSC에서 담당한다.

export const PAGE_SIZE = 12;

/**
 * searchParams의 raw 값을 1 이상의 정수 페이지로 정규화한다.
 * 누락·비정수·1 미만은 모두 1페이지로 처리한다.
 */
export function parsePage(raw: string | undefined): number {
  if (!raw) {
    return 1;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

/** 전체 개수를 페이지 크기로 나눈 총 페이지 수(최소 1). */
export function getTotalPages(
  totalCount: number,
  pageSize: number = PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

/** Supabase `.range()`에 넘길 0-based 포함 구간. */
export function getRangeForPage(
  page: number,
  pageSize: number = PAGE_SIZE,
): { from: number; to: number } {
  const from = (page - 1) * pageSize;

  return { from, to: from + pageSize - 1 };
}

export type PageItem = number | "ellipsis";

/**
 * 페이지네이션 컨트롤에 표시할 항목 목록.
 * 항상 첫·마지막 페이지와 현재 페이지 좌우 1칸을 포함하고,
 * 사이가 벌어지면 "ellipsis"로 접는다.
 */
export function getPageItems(
  currentPage: number,
  totalPages: number,
): PageItem[] {
  if (totalPages <= 1) {
    return [1];
  }

  // 페이지가 적으면 접지 않고 모두 보여준다.
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  // 현재 페이지 좌우 1칸을 유지하되, 경계에 닿으면 잘라내는 대신 안쪽으로 밀어 항상 3칸을 확보한다.
  let start = currentPage - 1;
  let end = currentPage + 1;

  if (start < 1) {
    end += 1 - start;
    start = 1;
  }

  if (end > totalPages) {
    start -= end - totalPages;
    end = totalPages;
  }

  start = Math.max(1, start);

  const pages = new Set<number>([1, totalPages]);

  for (let page = start; page <= end; page += 1) {
    pages.add(page);
  }

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const items: PageItem[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const page = sorted[index];

    if (index > 0 && page - sorted[index - 1] > 1) {
      items.push("ellipsis");
    }

    items.push(page);
  }

  return items;
}
