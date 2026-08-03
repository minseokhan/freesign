import Link from "next/link";

import { getPageItems } from "@/lib/pagination";
import { cn } from "@/lib/utils";

const itemBaseClass = cn(
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-md text-sm font-medium transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
);

const activeItemClass = "border-brand-primary/20 bg-brand-point text-brand-primary";
const inactiveItemClass =
  "border-surface-border bg-white text-text-body hover:bg-surface-muted";
const disabledItemClass =
  "pointer-events-none border-surface-border bg-white text-text-muted opacity-50";

/**
 * 목록 페이지 하단 페이지네이션. 서버 컴포넌트로, `createHref`가
 * 현재 필터 등 다른 쿼리 파라미터를 유지한 페이지 링크를 만든다.
 * 총 페이지가 1개면 렌더링하지 않는다.
 */
export function Pagination({
  currentPage,
  totalPages,
  createHref,
}: {
  currentPage: number;
  totalPages: number;
  createHref: (page: number) => string;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const items = getPageItems(currentPage, totalPages);
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <nav
      aria-label="페이지 이동"
      className="flex items-center justify-center gap-sm"
    >
      {hasPrev ? (
        <Link
          href={createHref(currentPage - 1)}
          rel="prev"
          className={cn(itemBaseClass, inactiveItemClass)}
        >
          이전
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(itemBaseClass, disabledItemClass)}>
          이전
        </span>
      )}

      {items.map((item, index) =>
        item === "ellipsis" ? (
          <span
            key={`ellipsis-${index}`}
            aria-hidden="true"
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm text-text-muted"
          >
            …
          </span>
        ) : item === currentPage ? (
          <span
            key={item}
            aria-current="page"
            className={cn(itemBaseClass, activeItemClass)}
          >
            {item}
          </span>
        ) : (
          <Link
            key={item}
            href={createHref(item)}
            className={cn(itemBaseClass, inactiveItemClass)}
          >
            {item}
          </Link>
        ),
      )}

      {hasNext ? (
        <Link
          href={createHref(currentPage + 1)}
          rel="next"
          className={cn(itemBaseClass, inactiveItemClass)}
        >
          다음
        </Link>
      ) : (
        <span aria-hidden="true" className={cn(itemBaseClass, disabledItemClass)}>
          다음
        </span>
      )}
    </nav>
  );
}
