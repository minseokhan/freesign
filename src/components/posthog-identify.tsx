"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

import { bootPostHog } from "@/lib/posthog-boot";

interface PostHogIdentifyProps {
  userId: string;
  email?: string;
  name?: string;
}

export function PostHogIdentify({ userId, email, name }: PostHogIdentifyProps) {
  useEffect(() => {
    // 부트스트랩이 유휴 시점으로 미뤄져 있어, 초기화 완료 후에 식별해야 유실되지 않는다.
    void bootPostHog().then(() => posthog.identify(userId, { email, name }));
  }, [userId, email, name]);

  return null;
}
