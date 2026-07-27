// Pure parsing and validation helpers for the printable submission header.
// Keeping this layer independent from the DOM makes frozen-link metadata
// deterministic, testable, and safe to consume before any UI is mounted.

export interface CourseDocumentIdentity {
  title: string;
  courseVersion: string;
}

export interface SubmissionDocumentMetadataV1 {
  v: 1;
  at: number;
  title?: string;
  courseVersion?: string;
}

export interface PrintableSubmissionHeaderModel {
  name: string;
  date: string;
  version: string;
  title: string;
  metadataStatus: "frozen" | "legacy";
}

export interface PrintableSubmissionHeaderOptions {
  locale?: string;
  timeZone?: string;
}

export const PRINTABLE_VALUE_NOT_PROVIDED = "Nicht angegeben";
export const PRINTABLE_VALUE_NOT_STORED = "Nicht im Freezelink gespeichert";

const MAX_TITLE_LENGTH = 1_000;
const MAX_VERSION_LENGTH = 300;
const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

function normalizeSpace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeAuthoredText(value: string, maximumLength: number): string {
  const shortened = normalizeSpace(value).slice(0, maximumLength);
  return /[\uD800-\uDBFF]$/.test(shortened)
    ? shortened.slice(0, -1)
    : shortened;
}

function leadingHeaderComment(markdown: string): string {
  const match = String(markdown || "").match(/^\uFEFF?\s*<!--([\s\S]*?)-->/);
  return match ? match[1] : "";
}

function visibleOutsideHtmlComments(
  line: string,
  state: { inComment: boolean },
): string {
  let rest = line;
  let visible = "";

  while (rest) {
    if (state.inComment) {
      const end = rest.indexOf("-->");
      if (end < 0) return visible;
      state.inComment = false;
      rest = rest.slice(end + 3);
      continue;
    }

    const start = rest.indexOf("<!--");
    if (start < 0) return visible + rest;
    visible += rest.slice(0, start);
    state.inComment = true;
    rest = rest.slice(start + 4);
  }

  return visible;
}

function firstVisibleH1(markdown: string): string {
  const lines = String(markdown || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const commentState = { inComment: false };
  let fence: { kind: string; length: number } | null = null;

  for (const rawLine of lines) {
    const line = visibleOutsideHtmlComments(rawLine, commentState);
    const marker = line.match(/^\s{0,3}((?:\x60){3,}|~{3,})(.*)$/);

    if (fence) {
      if (
        marker
        && marker[1][0] === fence.kind
        && marker[1].length >= fence.length
        && marker[2].trim() === ""
      ) {
        fence = null;
      }
      continue;
    }

    if (marker) {
      fence = { kind: marker[1][0], length: marker[1].length };
      continue;
    }

    const heading = line.match(/^\s{0,3}#(?!#)\s+(.+?)\s*$/);
    if (!heading) continue;
    return normalizeSpace(heading[1].replace(/\s+#+\s*$/, ""));
  }

  return "";
}

export function parseCourseDocumentIdentity(
  courseMarkdown: string,
): CourseDocumentIdentity {
  let courseVersion = "";
  const header = leadingHeaderComment(courseMarkdown);

  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^\s*version\s*:\s*(.*?)\s*$/i);
    if (!match) continue;
    courseVersion = normalizeSpace(match[1]);
    if (courseVersion) break;
  }

  return {
    title: firstVisibleH1(courseMarkdown),
    courseVersion,
  };
}

function readOptionalText(
  value: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | undefined | null {
  const raw = value[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length > maximumLength) return null;
  const normalized = normalizeSpace(raw);
  return normalized || undefined;
}

export function readSubmissionDocumentMetadata(
  value: unknown,
): SubmissionDocumentMetadataV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1) return null;

  const at = raw.at;
  if (
    typeof at !== "number"
    || !Number.isSafeInteger(at)
    || at < 0
    || at > MAX_DATE_TIMESTAMP
  ) {
    return null;
  }

  const title = readOptionalText(raw, "title", MAX_TITLE_LENGTH);
  const courseVersion = readOptionalText(raw, "courseVersion", MAX_VERSION_LENGTH);
  if (title === null || courseVersion === null) return null;

  return {
    v: 1,
    at,
    ...(title ? { title } : {}),
    ...(courseVersion ? { courseVersion } : {}),
  };
}

export function buildSubmissionDocumentMetadata(
  source: CourseDocumentIdentity | string,
  createdAt: number = Date.now(),
): SubmissionDocumentMetadataV1 {
  const identity = typeof source === "string"
    ? parseCourseDocumentIdentity(source)
    : source;
  const metadata = readSubmissionDocumentMetadata({
    v: 1,
    at: createdAt,
    title: normalizeAuthoredText(identity.title, MAX_TITLE_LENGTH),
    courseVersion: normalizeAuthoredText(
      identity.courseVersion,
      MAX_VERSION_LENGTH,
    ),
  });
  if (!metadata) throw new Error("Invalid submission document metadata.");
  return metadata;
}

function printableName(value: unknown): string {
  if (typeof value !== "string") return PRINTABLE_VALUE_NOT_PROVIDED;
  return normalizeSpace(value) || PRINTABLE_VALUE_NOT_PROVIDED;
}

function formatSubmissionDate(
  timestamp: number,
  options: PrintableSubmissionHeaderOptions,
): string {
  try {
    return new Intl.DateTimeFormat(options.locale || "de-DE", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
}

export function buildPrintableSubmissionHeaderModel(
  payload: { n?: unknown; doc?: unknown },
  options: PrintableSubmissionHeaderOptions = {},
): PrintableSubmissionHeaderModel {
  const metadata = readSubmissionDocumentMetadata(payload?.doc);
  const name = printableName(payload?.n);

  if (!metadata) {
    return {
      name,
      date: PRINTABLE_VALUE_NOT_STORED,
      version: PRINTABLE_VALUE_NOT_STORED,
      title: PRINTABLE_VALUE_NOT_STORED,
      metadataStatus: "legacy",
    };
  }

  return {
    name,
    date: formatSubmissionDate(metadata.at, options),
    version: metadata.courseVersion || PRINTABLE_VALUE_NOT_PROVIDED,
    title: metadata.title || PRINTABLE_VALUE_NOT_PROVIDED,
    metadataStatus: "frozen",
  };
}
