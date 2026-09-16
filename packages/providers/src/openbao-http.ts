import { X509Certificate } from "node:crypto";
import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from "node:https";
import { isCoreFailure, parseJsonRejectDuplicateKeys } from "@foreman/core";
import { Effect, Redacted } from "effect";
import type { CredentialStoreFailure, OpenBaoCredentialStoreConfig } from "./credential-store.js";

const MAX_BYTES = 64 * 1024;
const component = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const failureCodes = new Set<CredentialStoreFailure["code"]>(["InvalidInput", "InvalidResponse", "Denied", "NotFound", "Conflict", "Unavailable", "Timeout"]);
const failure = (code: CredentialStoreFailure["code"]): CredentialStoreFailure => ({ _tag: "CredentialStoreFailure", code });
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isComponent = (value: string): boolean => component.exec(value)?.[0] === value;
const sanitizeFailure = (value: unknown): CredentialStoreFailure => object(value) && value._tag === "CredentialStoreFailure" && typeof value.code === "string" && failureCodes.has(value.code as CredentialStoreFailure["code"])
  ? failure(value.code as CredentialStoreFailure["code"])
  : failure("Unavailable");

export interface OpenBaoHttpSession {
  readonly request: (
    method: "GET" | "POST", path: string, body?: Buffer,
  ) => Effect.Effect<Buffer, CredentialStoreFailure>;
}

export interface OpenBaoHttpClient {
  readonly run: <A>(
    validate: () => boolean,
    operation: (session: OpenBaoHttpSession) => Effect.Effect<A, CredentialStoreFailure>,
    deadline: number,
  ) => Effect.Effect<A, CredentialStoreFailure>;
}

function originOf(endpoint: string, synthetic: boolean): URL | undefined {
  try {
    const url = new URL(endpoint);
    const validProtocol = synthetic ? url.protocol === "http:" && url.hostname === "127.0.0.1" && !!url.port : url.protocol === "https:";
    if (!validProtocol || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.origin !== endpoint) return undefined;
    return url;
  } catch { return undefined; }
}

function validConfig(config: OpenBaoCredentialStoreConfig, synthetic: boolean): URL | undefined {
  const origin = originOf(config.endpoint, synthetic);
  const namespace = config.namespace;
  if (!origin || !isComponent(config.mount) || (namespace !== undefined && (!namespace || !namespace.split("/").every(isComponent)))) return undefined;
  return origin;
}

function validDeadline(deadline: number): boolean { return Number.isFinite(deadline) && deadline > Date.now(); }

export function encodeOpenBaoJson(value: unknown): Buffer | undefined {
  try { const bytes = Buffer.from(JSON.stringify(value)); return bytes.length <= MAX_BYTES ? bytes : undefined; } catch { return undefined; }
}

export function decodeOpenBaoJson(bytes: Buffer): unknown {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return undefined; }
  const parsed = parseJsonRejectDuplicateKeys(text);
  return isCoreFailure(parsed) ? undefined : parsed;
}

function statusFailure(status: number, body: Buffer): CredentialStoreFailure {
  if (status === 403) return failure("Denied");
  if (status === 404) return failure("NotFound");
  if (status === 409 || (status === 400 && body.toString("utf8").toLowerCase().includes("check-and-set parameter did not match"))) return failure("Conflict");
  if ([502, 503, 504].includes(status)) return failure("Unavailable");
  return failure("InvalidResponse");
}

function transport(origin: URL, config: OpenBaoCredentialStoreConfig, token: Redacted.Redacted<string>, method: string, path: string, body: Buffer | undefined, deadline: number): Effect.Effect<Buffer, CredentialStoreFailure> {
  return Effect.async<Buffer, CredentialStoreFailure>(resume => {
    let settled = false; let response: IncomingMessage | undefined; let active: ClientRequest | undefined;
    const close = () => { response?.destroy(); active?.destroy(); };
    const finish = (result: Effect.Effect<Buffer, CredentialStoreFailure>, destroy = false) => { if (settled) return; settled = true; clearTimeout(timer); if (destroy) close(); resume(result); };
    const timer = setTimeout(() => finish(Effect.fail(failure("Timeout")), true), Math.max(0, deadline - Date.now()));
    const hostname = origin.hostname.startsWith("[") ? origin.hostname.slice(1, -1) : origin.hostname;
    const options: RequestOptions = { protocol: origin.protocol, hostname, port: origin.port || undefined, method, path, agent: false, headers: { accept: "application/json", "x-vault-token": Redacted.value(token), ...(config.namespace ? { "x-vault-namespace": config.namespace } : {}), ...(body ? { "content-type": "application/json", "content-length": body.length } : {}) } };
    if (origin.protocol === "https:") {
      const secure = options as HttpsRequestOptions;
      secure.rejectUnauthorized = true;
      if (config.caPem !== undefined) secure.ca = config.caPem;
      // Node 24's DNS ASCII normalization can reject IPv6 before IP SAN matching.
      // Chain verification stays enabled. Match the exact IPv6 address against IP SANs.
      if (origin.hostname.startsWith("[")) secure.checkServerIdentity = (_hostname, certificate) => {
        try { if (new X509Certificate(certificate.raw).checkIP(hostname)) return undefined; } catch { /* Refuse malformed certificates. */ }
        return new Error("TLS IP identity mismatch");
      };
    }
    try {
      active = (origin.protocol === "https:" ? httpsRequest : httpRequest)(options, incoming => {
        response = incoming;
        if ((incoming.statusCode ?? 0) >= 300 && (incoming.statusCode ?? 0) < 400) return finish(Effect.fail(failure("InvalidResponse")), true);
        const declared = incoming.headers["content-length"];
        if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) return finish(Effect.fail(failure("InvalidResponse")), true);
        const chunks: Buffer[] = []; let size = 0;
        incoming.on("data", (chunk: Buffer) => { if (settled) return; size += chunk.length; if (size > MAX_BYTES) return finish(Effect.fail(failure("InvalidResponse")), true); chunks.push(chunk); });
        incoming.on("end", () => { if (settled) return; const bytes = Buffer.concat(chunks, size); const status = incoming.statusCode ?? 0; finish(status >= 200 && status < 300 ? Effect.succeed(bytes) : Effect.fail(statusFailure(status, bytes))); });
        incoming.on("aborted", () => finish(Effect.fail(failure("Unavailable")), true)); incoming.on("error", () => finish(Effect.fail(failure("Unavailable")), true));
      });
      active.on("error", () => finish(Effect.fail(failure("Unavailable")), true)); active.end(body);
    } catch { finish(Effect.fail(failure("InvalidInput")), true); }
    return Effect.sync(() => { if (!settled) { settled = true; clearTimeout(timer); close(); } });
  });
}

export function makeOpenBaoHttpClient(config: OpenBaoCredentialStoreConfig, synthetic: boolean): OpenBaoHttpClient {
  const snapshot: OpenBaoCredentialStoreConfig = { endpoint: config.endpoint, mount: config.mount, ...(config.namespace === undefined ? {} : { namespace: config.namespace }), ...(config.caPem === undefined ? {} : { caPem: config.caPem }), token: config.token };
  return {
    run: <A>(validate: () => boolean, operation: (session: OpenBaoHttpSession) => Effect.Effect<A, CredentialStoreFailure>, deadline: number): Effect.Effect<A, CredentialStoreFailure> => Effect.suspend(() => {
      const origin = validConfig(snapshot, synthetic); const now = Date.now();
      if (!origin || !validDeadline(deadline) || !validate()) return Effect.fail(failure("InvalidInput"));
      const effective = Math.min(deadline, now + 5_000);
      const token = Effect.try({ try: snapshot.token, catch: () => failure("Unavailable") }).pipe(
        Effect.flatMap(value => value),
        Effect.catchAll(error => Effect.fail(sanitizeFailure(error))),
        Effect.catchAllDefect(() => Effect.fail(failure("Unavailable"))),
      );
      return token.pipe(
        Effect.flatMap(value => Effect.try({ try: () => Redacted.value(value), catch: () => failure("Unavailable") }).pipe(
          Effect.flatMap(raw => {
            if (typeof raw !== "string") return Effect.fail(failure("Unavailable"));
            if (raw.length === 0 || raw.length > 32 * 1024 || /[^\x21-\x7e]/.test(raw)) return Effect.fail(failure("InvalidInput"));
            const session: OpenBaoHttpSession = {
              request: (method, path, body) => transport(origin, snapshot, value, method, path, body, effective),
            };
            return operation(session);
          }),
        )),
        Effect.timeoutFail({ duration: Math.max(1, effective - Date.now()), onTimeout: () => failure("Timeout") }),
      );
    }),
  };
}
