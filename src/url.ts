// Builds and parses the submission URL that embeds the snapshot token,
// and persists/retrieves the token via sessionStorage between page loads.
import { encodeToken, decodeToken } from "./codec";

const PARAM_NAME = "submission";
const STORAGE_PREFIX = "__lia_freeze_v2__:";

// ---- Internal helpers ----

function getCourseUrl(): string {
  const search = window.location.search;
  if (!search || search === "?") return "";
  try {
    return decodeURIComponent(search.slice(1));
  } catch {
    return search.slice(1);
  }
}

function stripSubmission(courseUrl: string): string {
  if (!courseUrl) return "";
  try {
    const u = new URL(courseUrl, window.location.href);
    if (String(u.hash).replace(/^#/, "").startsWith(PARAM_NAME + "=")) u.hash = "";
    return u.toString();
  } catch {
    return courseUrl.replace(new RegExp("#" + PARAM_NAME + "=[^#]*$"), "");
  }
}

function storageKey(): string {
  const courseUrl = getCourseUrl();
  const base = (() => {
    const stripped = stripSubmission(courseUrl);
    try {
      const u = new URL(stripped, window.location.href);
      u.hash = "";
      return u.toString();
    } catch {
      return stripped.replace(/#.*$/, "");
    }
  })();
  return STORAGE_PREFIX + base;
}

function tokenFromCourseUrl(): string | null {
  const courseUrl = getCourseUrl();
  if (!courseUrl) return null;
  try {
    const frag = String(new URL(courseUrl, window.location.href).hash).replace(/^#/, "");
    if (!frag.startsWith(PARAM_NAME + "=")) return null;
    return decodeURIComponent(frag.slice((PARAM_NAME + "=").length));
  } catch {
    const m = courseUrl.match(new RegExp("#" + PARAM_NAME + "=([^#]+)$"));
    return m ? decodeURIComponent(m[1]) : null;
  }
}

function tokenFromViewerHash(): string | null {
  const h = window.location.hash;
  if (!h) return null;
  // New format: #7&submission=TOKEN
  const m = h.match(/[?&]submission=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

// ---- Public API ----

export function getSubmissionToken(): string | null {
  const direct = tokenFromCourseUrl() || tokenFromViewerHash();
  if (direct) {
    storeToken(direct);
    return direct;
  }
  try {
    return sessionStorage.getItem(storageKey()) || null;
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try { sessionStorage.setItem(storageKey(), token); } catch { /* storage unavailable */ }
}

export function clearToken(): void {
  try { sessionStorage.removeItem(storageKey()); } catch { /* storage unavailable */ }
}

export function getCurrentHash(): string {
  // Strip any embedded submission token from the viewer hash
  const raw = window.location.hash;
  const clean = raw.match(/^(#\d+)&submission=/)?.[1] ?? raw;
  return /^#\d+$/.test(clean) ? clean : "#1";
}

/**
 * LiaScript's native arrows sometimes build their next URL by appending #8 to
 * the decoded course URL. For a shared link that course URL ends in
 * #submission=TOKEN, so the browser receives #submission=TOKEN#8 and the
 * viewer falls back to its title slide. Keep the original encoded course URL
 * (and its fragment-only token) in the query, with only #8 as viewer hash.
 */
export function normalizeViewerNavigationUrl<T extends string | URL | null | undefined>(url: T): T | string {
  if (url == null) return url;
  const token = tokenFromCourseUrl();
  if (!token) return url;

  let target: URL;
  try {
    target = new URL(String(url), window.location.href);
  } catch {
    return url;
  }
  if (target.origin !== window.location.origin || target.pathname !== window.location.pathname)
    return url;

  const match = target.hash.match(/^#submission=([^#]+)#(\d+)$/);
  if (!match) return url;
  try {
    if (decodeURIComponent(match[1]) !== token) return url;
  } catch {
    return url;
  }
  return window.location.href.split("#")[0] + "#" + match[2];
}

export async function buildLink(payload: unknown & { sh?: string }): Promise<string> {
  const baseCourseUrl = stripSubmission(getCourseUrl());
  if (!baseCourseUrl) return window.location.href;

  const { token } = await encodeToken(payload);

  // Persist tokens only when a shared link is actually opened. Storing the
  // freshly generated token in the live student tab would make a later reload
  // of the original course enter shared-link mode even though its URL contains
  // no submission token.

  const viewerBase = window.location.href.split("?")[0].split("#")[0];
  const slideHash =
    /^#\d+$/.test(String((payload as Record<string, unknown>)?.sh ?? ""))
      ? String((payload as Record<string, unknown>).sh)
      : "#1";

  // Token lives inside the encoded course URL so LiaScript can use the
  // viewer hash (#7) normally without clobbering our submission param.
  const courseUrlWithToken =
    stripSubmission(baseCourseUrl) + "#" + PARAM_NAME + "=" + token;

  return viewerBase + "?" + encodeURIComponent(courseUrlWithToken) + slideHash;
}

export async function loadPayload(): Promise<unknown | null> {
  const token = getSubmissionToken();
  if (!token) return null;
  try {
    const obj = await decodeToken(token);
    if (!obj || typeof obj !== "object" || !Array.isArray((obj as Record<string, unknown>).s))
      return null;
    return obj;
  } catch {
    return null;
  }
}
