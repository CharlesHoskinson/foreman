import { Effect, Stream } from "effect";
import type { Scope } from "effect";
import type { ProviderFailure } from "../errors.js";

export interface ApiHttpRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal?: AbortSignal;
}
export interface ApiHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Stream.Stream<Uint8Array, ProviderFailure>;
}
/** Only this boundary sees resolved credential headers. It must never log requests. */
export interface ApiHttpPort {
  readonly request: (
    request: ApiHttpRequest,
  ) => Effect.Effect<ApiHttpResponse, ProviderFailure, Scope.Scope>;
}
export const apiFailure = (
  tag:
    | "MalformedEvent"
    | "OutputIncomplete"
    | "OutcomeUnknown"
    | "UnsupportedCapability"
    | "CapabilityUnverified"
    | "ContinuationMismatch"
    | "ResumeUnavailable"
    | "ModelMismatch"
    | "OutputInvalid"
    | "ProbeUnknown"
    | "AuthenticationRequired"
    | "ModelUnavailable",
  message: string,
  fieldPath?: string,
): ProviderFailure => ({
  _tag: tag,
  retryClass: "never",
  message,
  ...(fieldPath ? { fieldPath } : {}),
});
const disconnected = (): ProviderFailure => ({
  _tag: "TransportDisconnected",
  retryClass: "transient",
  message: "Provider connection closed before its outcome was observed",
});
export function createFetchHttpPort(
  fetchImpl: typeof fetch = fetch,
): ApiHttpPort {
  return {
    request: (request) =>
      Effect.gen(function* () {
        const controller = new AbortController();
        yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
        const signal = request.signal
          ? AbortSignal.any([controller.signal, request.signal])
          : controller.signal;
        const response = yield* Effect.tryPromise({
          try: () =>
            fetchImpl(request.url, {
              method: request.method,
              headers: request.headers,
              ...(request.body === undefined ? {} : { body: request.body }),
              signal,
              redirect: "manual",
            }),
          catch: disconnected,
        });
        const body = response.body;
        if (!body) return yield* Effect.fail(disconnected());
        const reader = body.getReader();
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            try {
              await reader.cancel();
            } catch {
              /* cleanup is independent of remote outcome */
            }
          }),
        );
        const iterable: AsyncIterable<Uint8Array> = {
          async *[Symbol.asyncIterator]() {
            for (;;) {
              const item = await reader.read();
              if (item.done) return;
              yield item.value;
            }
          },
        };
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: Stream.fromAsyncIterable(iterable, disconnected),
        };
      }),
  };
}
export interface SseFrame {
  readonly id?: string;
  readonly event?: string;
  readonly data: string;
}
/** Incremental UTF-8 / SSE decoder; neither hidden content nor parse errors enter diagnostics. */
export function decodeSse(
  input: Stream.Stream<Uint8Array, ProviderFailure>,
  maxFrameBytes = 1024 * 1024,
): Stream.Stream<SseFrame, ProviderFailure> {
  return Stream.unwrap(
    Effect.sync(() => {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "";
      const consume = (
        chunk: Uint8Array,
      ): Effect.Effect<readonly SseFrame[], ProviderFailure> =>
        Effect.try({
          try: () => {
            buffer += decoder.decode(chunk, { stream: true });
            const frames: SseFrame[] = [];
            for (;;) {
              const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
              if (!match) break;
              const raw = buffer.slice(0, match.index);
              buffer = buffer.slice(match.index + match[0].length);
              if (Buffer.byteLength(raw) > maxFrameBytes) throw new Error();
              const lines = raw.split(/\r\n|\r|\n/);
              let id: string | undefined;
              let event: string | undefined;
              const data: string[] = [];
              for (const line of lines) {
                if (line.startsWith(":")) continue;
                const colon = line.indexOf(":");
                const name = colon < 0 ? line : line.slice(0, colon);
                const value =
                  colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
                if (name === "data") data.push(value);
                if (name === "event") event = value;
                if (name === "id" && !value.includes("\0")) id = value;
              }
              if (data.length)
                frames.push({
                  data: data.join("\n"),
                  ...(id === undefined ? {} : { id }),
                  ...(event === undefined ? {} : { event }),
                });
            }
            if (Buffer.byteLength(buffer) > maxFrameBytes) throw new Error();
            return frames;
          },
          catch: () =>
            apiFailure("MalformedEvent", "Invalid or oversized provider event"),
        });
      const finish = Stream.fromEffect(
        Effect.try({
          try: () => {
            buffer += decoder.decode();
            if (buffer.trim()) throw new Error();
            return [] as readonly SseFrame[];
          },
          catch: () =>
            apiFailure(
              "OutputIncomplete",
              "Provider event stream ended inside an event",
            ),
        }),
      );
      return Stream.concat(input.pipe(Stream.mapEffect(consume)), finish).pipe(
        Stream.flatMap(Stream.fromIterable),
      );
    }),
  );
}
export function readApiJson(
  response: ApiHttpResponse,
  maxBytes = 4 * 1024 * 1024,
): Effect.Effect<Record<string, unknown>, ProviderFailure> {
  let size = 0;
  const chunks: Uint8Array[] = [];
  return Stream.runForEach(response.body, (chunk) =>
    Effect.suspend(() => {
      size += chunk.length;
      if (size > maxBytes)
        return Effect.fail(
          apiFailure("MalformedEvent", "Provider response exceeds byte limit"),
        );
      chunks.push(chunk);
      return Effect.void;
    }),
  ).pipe(
    Effect.flatMap(() =>
      Effect.try({
        try: () => {
          const value: unknown = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          );
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error();
          return value as Record<string, unknown>;
        },
        catch: () =>
          apiFailure("MalformedEvent", "Provider returned invalid JSON"),
      }),
    ),
  );
}
