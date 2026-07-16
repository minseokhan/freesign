// server-only: document hashes use Node crypto and are produced by server actions/routes.
import { createHash } from "node:crypto";

export type Clause = Record<string, unknown>;

export interface V1SignatureInput {
  clauses: readonly Clause[];
  signatureImagePath: string;
}

export interface V1SignatureResult {
  provider: "v1";
  docHash: string;
  signatureImagePath: string;
  legalEffect: "record" | "mutual";
}

export interface SignatureProvider {
  computeDocHash(clauses: readonly Clause[]): string;
  computeFileHash(bytes: Uint8Array): string;
  createSignatureResult(input: V1SignatureInput): V1SignatureResult;
}

export function createV1SignatureProvider(): SignatureProvider {
  return {
    computeDocHash(clauses) {
      return createHash("sha256")
        .update(canonicalStringify(clauses), "utf8")
        .digest("hex");
    },
    computeFileHash(bytes) {
      return createHash("sha256").update(bytes).digest("hex");
    },
    createSignatureResult(input) {
      return {
        provider: "v1",
        docHash: this.computeDocHash(input.clauses),
        signatureImagePath: input.signatureImagePath,
        legalEffect: "record",
      };
    },
  };
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(toCanonicalJsonValue(value));
}

function toCanonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toCanonicalJsonValue(item));
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return Object.fromEntries(
    entries.map(([key, entryValue]) => [key, toCanonicalJsonValue(entryValue)]),
  );
}
