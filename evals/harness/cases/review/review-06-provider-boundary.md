---
id: review-06
track: review
expect: violation
rule: provider-boundary
---
// app/(dashboard)/contracts/sign-actions.ts  ("use server")
import { createHash } from "node:crypto";

export async function completeSignature(contractId: string, clauses: unknown[]) {
  // services/signature 의 Provider 인터페이스를 거치지 않고 서명 결과를 직접 조립한다.
  const docHash = createHash("sha256").update(JSON.stringify(clauses)).digest("hex");
  const signatureMeta = { provider: "v1", legalEffect: "record" };

  const supabase = await createClient();
  await supabase
    .from("contracts")
    .update({ status: "signed", doc_hash: docHash, signature_meta: signatureMeta })
    .eq("id", contractId);
  revalidatePath(`/contracts/${contractId}`);
}
