type AiProcessingNoticeProps = {
  message: string;
};

export function AiProcessingNotice({ message }: AiProcessingNoticeProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-md rounded-md border border-blue-200 bg-brand-point px-md py-sm text-sm leading-relaxed text-brand-primary"
    >
      <span
        className="size-4 shrink-0 animate-spin rounded-full border-2 border-brand-primary/30 border-t-brand-primary"
        aria-hidden="true"
      />
      <span>{message}</span>
    </div>
  );
}
