import { redirect } from "next/navigation";

export default function HomePage() {
  // Phase 3(auth) will replace this temporary public-shell redirect.
  redirect("/dashboard");
}
