import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-surface-border bg-white p-xl shadow-raised",
        className,
      )}
      {...props}
    />
  );
}
