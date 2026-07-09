import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const buttonBaseClass = cn(
  "inline-flex min-h-11 items-center justify-center rounded-md px-lg py-sm text-sm font-medium transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-50",
);

export const buttonVariants = {
  primary:
    "bg-brand-primary text-white hover:bg-brand-hover active:bg-blue-800",
  secondary:
    "border border-surface-border bg-white text-text-body hover:bg-surface-muted",
  text: "text-text-muted hover:text-text-primary",
  danger: "text-red-600 hover:bg-red-50"
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonBaseClass, buttonVariants[variant], className)}
      {...props}
    />
  );
}
