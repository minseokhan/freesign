"use server";

import { redirect } from "next/navigation";

import { getPostHogClient } from "@/lib/posthog-server";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const posthog = getPostHogClient();
    posthog.capture({ distinctId: user.id, event: "user_signed_out" });
    await posthog.flush();
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(`로그아웃에 실패했습니다: ${error.message}`);
  }
  redirect("/");
}
