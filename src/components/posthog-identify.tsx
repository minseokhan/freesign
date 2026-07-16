"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

interface PostHogIdentifyProps {
  userId: string;
  email?: string;
  name?: string;
}

export function PostHogIdentify({ userId, email, name }: PostHogIdentifyProps) {
  useEffect(() => {
    posthog.identify(userId, { email, name });
  }, [userId, email, name]);

  return null;
}
