// Encodes a SnapshotPayload to a gzip+base64url token and decodes it back.
// Falls back to plain base64url if gzip produces a larger result.

const GZIP_PREFIX = "gz:";
const MAX_TOKEN_CHARACTERS = 6_000_000;
const MAX_JSON_UTF8_BYTES = 4 * 1024 * 1024;

function tokenLimitError(): Error {
  return new Error(
    `Submission token exceeds the maximum size of ${MAX_TOKEN_CHARACTERS.toLocaleString("en-US")} characters.`
  );
}

function jsonLimitError(): Error {
  return new Error("Submission JSON exceeds the maximum UTF-8 size of 4 MiB.");
}

function assertTokenLength(token: string): void {
  if (token.length > MAX_TOKEN_CHARACTERS) throw tokenLimitError();
}

function encodeJsonBytes(value: string) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength > MAX_JSON_UTF8_BYTES) throw jsonLimitError();
  return bytes;
}

function toBase64Url(str: string): string {
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(str: string): string {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  return s;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return toBase64Url(btoa(binary));
}

function base64UrlToUint8Array(
  token: string,
  decodedByteLimit: number | null = MAX_JSON_UTF8_BYTES
) {
  assertTokenLength(token);
  const binary = atob(fromBase64Url(token));
  if (decodedByteLimit !== null && binary.length > decodedByteLimit) {
    throw jsonLimitError();
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function gzipCompressToBase64Url(str: string): Promise<string> {
  const inputBytes = encodeJsonBytes(str);
  const compressedStream = new Blob([inputBytes])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const buffer = await new Response(compressedStream).arrayBuffer();
  return uint8ArrayToBase64Url(new Uint8Array(buffer));
}

async function readUtf8StreamWithLimit(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_JSON_UTF8_BYTES) {
        const error = jsonLimitError();
        try { await reader.cancel(error); } catch { /* preserve the size error */ }
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function gzipDecompressFromBase64Url(token: string): Promise<string> {
  // The 4 MiB ceiling applies to JSON output. Compressed input is bounded by
  // the separate token-character limit and may be slightly larger than JSON.
  const compressedBytes = base64UrlToUint8Array(token, null);
  const decompressedStream = new Blob([compressedBytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const output = await readUtf8StreamWithLimit(
    decompressedStream as ReadableStream<Uint8Array>
  );
  return new TextDecoder().decode(output);
}

export type EncodeResult = {
  token: string;
  mode: "gzip" | "plain";
};

export async function encodeToken(payload: unknown): Promise<EncodeResult> {
  const json = JSON.stringify(payload);
  if (typeof json !== "string") {
    throw new Error("Submission payload is not JSON-serializable.");
  }
  const inputBytes = encodeJsonBytes(json);
  const plainToken = uint8ArrayToBase64Url(inputBytes);

  try {
    const compressed = await gzipCompressToBase64Url(json);
    const gzipToken = GZIP_PREFIX + compressed;
    if (gzipToken.length < plainToken.length) {
      return { token: gzipToken, mode: "gzip" };
    }
  } catch {
    // CompressionStream unavailable or failed — fall through to plain
  }

  return { token: plainToken, mode: "plain" };
}

export async function decodeToken(token: string): Promise<unknown> {
  const raw = token.trim();
  if (!raw) throw new Error("Empty token.");
  assertTokenLength(raw);

  if (raw.startsWith(GZIP_PREFIX)) {
    const json = await gzipDecompressFromBase64Url(raw.slice(GZIP_PREFIX.length));
    return JSON.parse(json);
  }

  const bytes = base64UrlToUint8Array(raw);
  return JSON.parse(new TextDecoder().decode(bytes));
}
