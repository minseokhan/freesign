import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const CHANNEL_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "linkedin", label: "링크드인" },
  { value: "instagram", label: "인스타그램" },
  { value: "youtube", label: "유튜브" },
  { value: "direct", label: "직거래" },
  { value: "kmong", label: "크몽" },
  { value: "referral", label: "추천" },
  { value: "other", label: "기타" },
] as const;

export const CLIENT_CHANNELS = [
  "linkedin",
  "instagram",
  "youtube",
  "direct",
  "kmong",
  "referral",
  "other",
] as const;

export type ClientChannel = (typeof CLIENT_CHANNELS)[number];

type ChannelMeta = {
  label: string;
  className: string;
};

const channelMeta: Record<ClientChannel, ChannelMeta> = {
  linkedin: {
    label: "링크드인",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  instagram: {
    label: "인스타그램",
    className: "border-pink-200 bg-pink-50 text-pink-700",
  },
  youtube: {
    label: "유튜브",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  direct: {
    label: "직거래",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
  kmong: {
    label: "크몽",
    className: "border-teal-200 bg-teal-50 text-teal-700",
  },
  referral: {
    label: "추천",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  other: {
    label: "기타",
    className: "border-slate-200 bg-slate-100 text-slate-600",
  },
};

function getChannelMeta(channel: string): ChannelMeta {
  if (channel in channelMeta) {
    return channelMeta[channel as ClientChannel];
  }

  return channelMeta.other;
}

export function ChannelBadge({ channel }: { channel: string }) {
  const meta = getChannelMeta(channel);

  return (
    <Badge variant="neutral" className={cn("whitespace-nowrap", meta.className)}>
      {meta.label}
    </Badge>
  );
}
