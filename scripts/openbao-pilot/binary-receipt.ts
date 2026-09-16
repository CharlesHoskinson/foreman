import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { cleanFailure } from "./lifecycle.js";
import { hash } from "./provenance.js";

const identities = {
  release: "v2.6.2",
  releaseUrl: "https://github.com/openbao/openbao/releases/tag/v2.6.2",
  assetUrl: "https://github.com/openbao/openbao/releases/download/v2.6.2/openbao_2.6.2_linux_amd64.tar.gz",
  publicKeyUrl: "https://openbao.org/assets/openbao-gpg-pub-20240618.asc",
  primaryKeyFingerprint: "66D15FDD87287219C8E15478D200CD702853E6D0",
  signingSubkeyFingerprint: "E617DCD4065C2AFC0B2CF7A7BA8BC08C0F691F94",
} as const;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** The private runtime is owned by this invocation. Same-UID/root tampering remains a host boundary. */
export function snapshotBinary(binary: string, expectedHash: string, runtime: string) {
  return Effect.tryPromise({ try: async signal => {
    const info = await stat(binary);
    if (!info.isFile() || !(info.mode & 0o111)) throw cleanFailure("SpawnFailed");
    const bytes = await readFile(binary, { signal });
    if (hash(bytes) !== expectedHash) throw cleanFailure("InvalidProvenance");
    const executable = join(runtime, "verified-bao");
    await writeFile(executable, bytes, { mode: 0o500, flag: "wx", signal });
    return executable;
  }, catch: error => {
    if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "PilotRunFailure" && "code" in error && (error.code === "SpawnFailed" || error.code === "InvalidProvenance")) return cleanFailure(error.code);
    return cleanFailure("SnapshotIOFailed");
  } });
}

/** Binds an externally verified receipt; does not run GPG or establish trust in caller pins. */
export function bindBinaryReceipt(input: { readonly binary: string; readonly binarySha256: string; readonly receiptSha256: string }) {
  return Effect.tryPromise({
    try: async signal => {
      if (!digest(input.binarySha256) || !digest(input.receiptSha256)) throw cleanFailure("InvalidProvenance");
      const bytes = await readFile(join(dirname(input.binary), "provenance.json"), { signal });
      if (hash(bytes) !== input.receiptSha256 || hash(await readFile(input.binary, { signal })) !== input.binarySha256) throw cleanFailure("InvalidProvenance");
      const receipt: unknown = JSON.parse(bytes.toString("utf8"));
      if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt)) throw cleanFailure("InvalidProvenance");
      const record = receipt as Record<string, unknown>;
      if (record.schemaVersion !== 1 || record.binary !== input.binary || record.binarySha256 !== input.binarySha256 || record.signatureVerified !== true || !digest(record.archiveSha256) || Object.entries(identities).some(([key, value]) => record[key] !== value) || ["integrityEvidence", "signatureEvidence", "trustBoundary"].some(key => typeof record[key] !== "string" || !record[key])) throw cleanFailure("InvalidProvenance");
      return { verificationScope: "externally-verified-receipt-binding", executable: input.binary, binarySha256: input.binarySha256, receiptSha256: input.receiptSha256, archiveSha256: record.archiveSha256, ...identities };
    },
    catch: () => cleanFailure("InvalidProvenance"),
  });
}
