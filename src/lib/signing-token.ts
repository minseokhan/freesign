// server-only: signing request tokens are generated and hashed only on the server.
import { createHash, randomBytes } from "node:crypto";

export function generateSigningToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSigningToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
