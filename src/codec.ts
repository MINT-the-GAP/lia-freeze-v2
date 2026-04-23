const GZIP_PREFIX = "gz:";

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

function base64UrlToUint8Array(token: string): Uint8Array {
  const binary = atob(fromBase64Url(token));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function gzipCompressToBase64Url(str: string): Promise<string> {
  const inputBytes = new TextEncoder().encode(str);
  const compressedStream = new Blob([inputBytes])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const buffer = await new Response(compressedStream).arrayBuffer();
  return uint8ArrayToBase64Url(new Uint8Array(buffer));
}

export async function gzipDecompressFromBase64Url(token: string): Promise<string> {
  const compressedBytes = base64UrlToUint8Array(token);
  const decompressedStream = new Blob([compressedBytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const buffer = await new Response(decompressedStream).arrayBuffer();
  return new TextDecoder().decode(new Uint8Array(buffer));
}

export type EncodeResult = {
  token: string;
  mode: "gzip" | "plain";
};

export async function encodeToken(payload: unknown): Promise<EncodeResult> {
  const json = JSON.stringify(payload);
  const plainToken = toBase64Url(btoa(unescape(encodeURIComponent(json))));

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

  if (raw.startsWith(GZIP_PREFIX)) {
    const json = await gzipDecompressFromBase64Url(raw.slice(GZIP_PREFIX.length));
    return JSON.parse(json);
  }

  return JSON.parse(decodeURIComponent(escape(atob(fromBase64Url(raw)))));
}
