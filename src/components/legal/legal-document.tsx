import type { ReactNode } from "react";

/**
 * 3개 고지 문서(처리방침·약관·환불정책)가 공유하는 문서 셸.
 * 문서 본문은 각 페이지가 소유하고, 여기서는 제목·시행일·본문 타이포그래피만 맞춘다.
 */
export function LegalDocument({
  title,
  effectiveDate,
  children,
}: {
  title: string;
  effectiveDate: string;
  children: ReactNode;
}) {
  return (
    <article className="space-y-xl">
      <header className="space-y-xs border-b border-surface-border pb-lg">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
          {title}
        </h1>
        <p className="text-sm text-text-muted">
          시행일: <span>{effectiveDate}</span>
        </p>
      </header>
      <div className="space-y-2xl">{children}</div>
    </article>
  );
}

export function LegalSection({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-md">
      <h2
        id={id}
        className="text-lg font-semibold tracking-tight text-text-primary"
      >
        {heading}
      </h2>
      <div className="space-y-md text-sm leading-relaxed text-text-body">
        {children}
      </div>
    </section>
  );
}

/** 조항 번호가 붙는 목록. 약관처럼 항목을 인용해야 하는 문서에서 쓴다. */
export function LegalList({ items }: { items: readonly ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-sm pl-lg">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ol>
  );
}

/**
 * 가로로 넓은 고지 표. 모바일에서 페이지 자체가 밀리지 않도록 표만 가로 스크롤한다.
 * caption은 표의 접근성 이름이 되므로 생략하지 말 것.
 */
export function LegalTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-surface-border">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-muted">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-md py-sm font-medium text-text-primary"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-t border-surface-border align-top text-text-body"
            >
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-md py-sm">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
