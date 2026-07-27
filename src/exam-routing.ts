export interface ExamHeadingRef {
  h: string;
  t: string;
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

/**
 * Builds the complete H1-H6 section index used by LiaScript's numeric hashes.
 * This is intentionally separate from the H1/H2 list used by the Freeze UI.
 */
export function parseExamHeadingIndex(markdown: string): ExamHeadingRef[] {
  const headings: ExamHeadingRef[] = [];
  const commentState = { inComment: false };
  let fence: { kind: string; length: number } | null = null;

  for (const rawLine of String(markdown || "").split(/\r?\n/)) {
    if (fence) {
      const marker = rawLine.match(/^\s*((?:\x60){3,}|~{3,})/);
      if (
        marker
        && fence.kind === marker[1][0]
        && marker[1].length >= fence.length
        && rawLine.slice((marker.index || 0) + marker[0].length).trim() === ""
      ) {
        fence = null;
      }
      continue;
    }

    const line = visibleOutsideHtmlComments(rawLine, commentState);
    const marker = line.match(/^\s*((?:\x60){3,}|~{3,})/);
    if (marker) {
      const kind = marker[1][0];
      fence = { kind, length: marker[1].length };
      continue;
    }

    const match = line.match(/^(#{1,6})[ \t]+(.+?)\s*$/);
    if (!match) continue;
    const title = match[2].replace(/[ \t]+#+[ \t]*$/, "").trim();
    if (!title) continue;
    headings.push({ h: "#" + (headings.length + 1), t: title });
  }
  return headings;
}

/**
 * Mirrors LiaScript's generateIndex transformation for section titles:
 * lowercase, turn hyphens into spaces, split on literal spaces, remove empty
 * parts and join with hyphens. Punctuation and diacritics stay untouched.
 */
export function liaSectionTitleHash(title: string): string | null {
  const plain = String(title || "").trim();
  // LiaScript stringifies a parsed inline AST before generating this hash.
  // Without that parser, formatting, macros and smart symbols can collide with
  // a different real section. Resolve only a conservative plain-text subset;
  // all other named fragments fail closed in the Exam guard.
  if (!plain
    || !/^[\p{L}\p{M}\p{N} \t,.!?&\/+\-]+$/u.test(plain)
    || plain.includes("--")
    || plain.includes("...")) return null;

  const fragment = plain
    .toLowerCase()
    .replace(/-/g, " ")
    .split(" ")
    .filter(Boolean)
    .join("-");
  return fragment ? "#" + fragment : null;
}

/**
 * Resolves LiaScript's numeric and named location fragments to a numeric
 * section hash. Unknown named fragments return null so Exam can fail closed.
 */
export function resolveLiaSectionHash(
  rawHash: string,
  headings: ExamHeadingRef[],
): string | null {
  let fragment = String(rawHash || "").replace(/^#/, "");
  try { fragment = decodeURIComponent(fragment); } catch { /* keep raw */ }

  if (/^\d+$/.test(fragment)) {
    const section = parseInt(fragment, 10);
    if (!Number.isSafeInteger(section) || section <= 0) return null;
    return "#" + section;
  }
  if (!fragment) return "#1";

  const needle = "#" + fragment.toLowerCase();
  return headings.find(entry => {
    const titleHash = liaSectionTitleHash(entry.t);
    return titleHash !== null && titleHash === needle;
  })?.h ?? null;
}
