import { useId, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  error?: ReactNode;
  id?: string;
  label?: ReactNode;
  wrapperClassName?: string;
};

export function Input({
  "aria-describedby": ariaDescribedBy,
  className,
  error,
  id,
  label,
  wrapperClassName,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = cn(ariaDescribedBy, errorId);

  return (
    <div className={cn("grid gap-sm", wrapperClassName)}>
      {label ? (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-text-body"
        >
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : props["aria-invalid"]}
        className={cn(
          "min-h-11 rounded-sm border border-slate-300 bg-white px-md py-sm text-sm text-text-primary",
          "focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30",
          "disabled:cursor-not-allowed disabled:text-text-disabled disabled:opacity-50",
          error && "border-red-500",
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={errorId} className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
