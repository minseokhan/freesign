import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = {
  success: "border-green-200 bg-status-paid-bg text-green-700",
  warning: "border-amber-200 bg-status-waiting-bg text-amber-700",
  danger: "border-red-200 bg-status-overdue-bg text-red-700",
  neutral: "border-slate-200 bg-status-neutral-bg text-slate-600"
} as const;

export type BadgeVariant = keyof typeof badgeVariants;

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  variant?: BadgeVariant;
};

export function Badge({
  className,
  variant = "neutral",
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        badgeVariants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
