// Language handling for the Freeze-owned interface. The consuming LiaScript
// course is authoritative; browser/document language is only a startup and
// legacy-link fallback until the course header or frozen metadata is available.

export type FreezeLanguage = "en" | "de";

const EN = {
  submissionHeading: "Create Submission Link",
  nameLabel: "Name",
  namePlaceholder: "Enter your name",
  createLink: "Create Link",
  creatingLink: "Creating link…",
  copyLink: "Copy Link",
  savePdf: "Save course and evaluation as PDF",
  savePdfTitle: "Open the print dialog and choose Save as PDF",
  submissionLink: "Submission Link",
  linkPlaceholder: "Your link will appear here",
  submissionFrozen: "Submission frozen",
  submissionLinkCreated: "Submission link created.",
  frozenNoteHtml: "This is a <strong>frozen submission</strong>. Tasks and inputs are locked. The table of contents, display mode, and layout can still be used. The PDF button opens the browser print dialog.",
  firstSlide: "First slide",
  previousSlide: "Previous slide",
  nextSlide: "Next slide",
  evaluationSlide: "Go to evaluation slide",
  printEvaluation: "Print evaluation or save as PDF",
  printEvaluationTitle: "Print evaluation / save as PDF",
  frozenSubmissionReport: "Frozen submission",
  studentName: "Student name",
  submissionDate: "Submission date",
  courseVersion: "Course version",
  linkCopied: "Link copied to clipboard.",
  copyFailed: "Copy failed — please copy manually.",
  timeLeft: "Time left: {time}",
  exam: "Exam",
  examIntro: "Clicking \"Start Exam\" begins the working time of <strong><span style=\"color:#c1121f;\">{duration} minutes</span></strong> and switches the course to fullscreen mode.",
  startExam: "Start Exam",
  sendGrading: "The submission is being frozen and then evaluated …",
  creatingSubmissionLink: "Creating submission link…",
  submissionFailed: "The submission link could not be created. Please try again.",
  preparingPdf: "Preparing all slides for PDF...",
  openingPrintDialog: "Opening print dialog…",
  printDialogClosed: "Print dialog closed.",
  printDialogFailed: "The print dialog could not be opened.",
  canvasImageAlt: "Canvas",
  answerSaved: "Answer saved. Check clicks: {count}. The evaluation takes place after submission.",
  sendCheckButton: "Submit",
  quizStatus: "Quiz status",
  taskNumber: "Task {number}",
  quiz: "Quiz",
  awardedPoints: "Awarded points (maximum {maximum})",
  valueNotProvided: "Not provided",
  valueNotStored: "Not stored in the Freeze link",
} as const;

export type FreezeTextKey = keyof typeof EN;

const DE: Record<FreezeTextKey, string> = {
  submissionHeading: "Abgabelink erstellen",
  nameLabel: "Name",
  namePlaceholder: "Gib deinen Namen ein",
  createLink: "Link erstellen",
  creatingLink: "Link wird erstellt…",
  copyLink: "Link kopieren",
  savePdf: "Kurs und Auswertung als PDF speichern",
  savePdfTitle: "Druckdialog öffnen und „Als PDF speichern“ wählen",
  submissionLink: "Abgabelink",
  linkPlaceholder: "Dein Link erscheint hier",
  submissionFrozen: "Abgabe eingefroren",
  submissionLinkCreated: "Abgabelink wurde erstellt.",
  frozenNoteHtml: "Dies ist eine <strong>eingefrorene Abgabe</strong>. Aufgaben und Eingaben sind gesperrt. Inhaltsverzeichnis, Ansichtsmodus und Layout können weiterhin verwendet werden. Die PDF-Schaltfläche öffnet den Druckdialog des Browsers.",
  firstSlide: "Erste Folie",
  previousSlide: "Vorherige Folie",
  nextSlide: "Nächste Folie",
  evaluationSlide: "Zur Auswertung",
  printEvaluation: "Auswertung drucken oder als PDF speichern",
  printEvaluationTitle: "Auswertung drucken / als PDF speichern",
  frozenSubmissionReport: "Eingefrorene Abgabe",
  studentName: "Schülername",
  submissionDate: "Abgabedatum",
  courseVersion: "Kursversion",
  linkCopied: "Link wurde in die Zwischenablage kopiert.",
  copyFailed: "Kopieren fehlgeschlagen — bitte kopiere den Link manuell.",
  timeLeft: "Verbleibende Zeit: {time}",
  exam: "Prüfung",
  examIntro: "Mit „Prüfung starten“ beginnt die Bearbeitungszeit von <strong><span style=\"color:#c1121f;\">{duration} Minuten</span></strong> und der Kurs wechselt in den Vollbildmodus.",
  startExam: "Prüfung starten",
  sendGrading: "Die Abgabe wird eingefroren und anschließend ausgewertet …",
  creatingSubmissionLink: "Abgabelink wird erstellt…",
  submissionFailed: "Der Abgabelink konnte nicht erstellt werden. Bitte versuche es erneut.",
  preparingPdf: "Alle Folien werden für das PDF vorbereitet...",
  openingPrintDialog: "Druckdialog wird geöffnet…",
  printDialogClosed: "Druckdialog wurde geschlossen.",
  printDialogFailed: "Der Druckdialog konnte nicht geöffnet werden.",
  canvasImageAlt: "Zeichenfläche",
  answerSaved: "Antwort gespeichert. Prüfen-Klicks: {count}. Die Auswertung erfolgt nach der Abgabe.",
  sendCheckButton: "Abschicken",
  quizStatus: "Aufgabenstatus",
  taskNumber: "Aufgabe {number}",
  quiz: "Aufgabe",
  awardedPoints: "Vergebene Punkte (maximal {maximum})",
  valueNotProvided: "Nicht angegeben",
  valueNotStored: "Nicht im Freezelink gespeichert",
};

let activeLanguage: FreezeLanguage = "en";

export function normalizeCourseLanguage(value: unknown): FreezeLanguage | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (/^de(?:-|$)/.test(normalized) || normalized === "german" || normalized === "deutsch") {
    return "de";
  }
  if (/^en(?:-|$)/.test(normalized) || normalized === "english" || normalized === "englisch") {
    return "en";
  }
  return null;
}

export function parseCourseLanguage(courseMarkdown: string): FreezeLanguage | null {
  const header = String(courseMarkdown || "").match(/^\uFEFF?\s*<!--([\s\S]*?)-->/)?.[1] ?? "";
  for (const line of header.split(/\r?\n/)) {
    const match = line.match(/^\s*language\s*:\s*(.*?)\s*$/i);
    if (!match) continue;
    // An authored but unsupported language is still authoritative and falls
    // back to English instead of inheriting an unrelated browser language.
    return normalizeCourseLanguage(match[1]) ?? "en";
  }
  return null;
}

export function detectDocumentLanguage(targetDocument: Document): FreezeLanguage {
  const authoredCandidates = [
    targetDocument.documentElement?.getAttribute("lang"),
    targetDocument.body?.getAttribute("lang"),
  ];
  for (const candidate of authoredCandidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    return normalizeCourseLanguage(candidate) ?? "en";
  }
  return normalizeCourseLanguage(
    typeof navigator !== "undefined" ? navigator.language : ""
  ) ?? "en";
}

export function setFreezeLanguage(value: unknown): FreezeLanguage {
  activeLanguage = normalizeCourseLanguage(value) ?? "en";
  return activeLanguage;
}

export function getFreezeLanguage(): FreezeLanguage {
  return activeLanguage;
}

export function localeForLanguage(language: FreezeLanguage = activeLanguage): string {
  return language === "de" ? "de-DE" : "en-US";
}

export function freezeText(
  key: FreezeTextKey,
  values: Record<string, string | number> = {},
  language: FreezeLanguage = activeLanguage,
): string {
  const template = (language === "de" ? DE : EN)[key];
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
  );
}

function setText(element: Element | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

function setAttribute(element: Element | null, name: string, value: string): void {
  if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/** Localize rendered @Abgabe markup, including markup produced before the bundle loaded. */
export function localizeSubmissionUi(
  root: ParentNode,
  language: FreezeLanguage = activeLanguage,
): void {
  root.querySelectorAll<HTMLElement>(".lia-submit-box").forEach(box => {
    setText(box.querySelector("h2"), freezeText("submissionHeading", {}, language));
    setText(box.querySelector('label[for="lia-name"]'), freezeText("nameLabel", {}, language));
    setAttribute(box.querySelector("#lia-name"), "placeholder", freezeText("namePlaceholder", {}, language));

    const create = box.querySelector("#lia-create-link");
    const createState = create?.getAttribute("data-lia-freeze-state");
    const createKey = createState === "frozen"
      ? "submissionFrozen"
      : createState === "creating"
        ? "creatingLink"
        : "createLink";
    setText(create, freezeText(createKey, {}, language));
    setText(box.querySelector("#lia-copy-link"), freezeText("copyLink", {}, language));

    const print = box.querySelector("#lia-print-pdf");
    setText(print, freezeText("savePdf", {}, language));
    setAttribute(print, "title", freezeText("savePdfTitle", {}, language));

    setText(box.querySelector('label[for="lia-link"]'), freezeText("submissionLink", {}, language));
    setAttribute(box.querySelector("#lia-link"), "placeholder", freezeText("linkPlaceholder", {}, language));

    const note = box.querySelector<HTMLElement>("#lia-frozen-note");
    if (note?.getAttribute("data-lia-freeze-state") === "frozen") {
      const html = freezeText("frozenNoteHtml", {}, language);
      if (note.innerHTML !== html) note.innerHTML = html;
    }
  });
}
