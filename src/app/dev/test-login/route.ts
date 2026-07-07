import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

function notFoundResponse() {
  return new NextResponse(null, { status: 404 });
}

function missingCredentialsResponse() {
  return new NextResponse("Missing E2E test credentials", { status: 400 });
}

function failedLoginResponse() {
  return new NextResponse("Test login failed", { status: 401 });
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return notFoundResponse();
  }

  if (process.env.ALLOW_TEST_LOGIN !== "true") {
    return notFoundResponse();
  }

  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!email || !password) {
    return missingCredentialsResponse();
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return failedLoginResponse();
    }
  } catch {
    return failedLoginResponse();
  }

  return NextResponse.redirect(new URL("/dashboard", request.url));
}
