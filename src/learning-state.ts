// A read-only bridge for optional recommendation extensions. It never captures,
// grades, restores or changes state, and withholds results during deferred Send.
export interface LearningReadContext {
  ready: boolean;
  grading: boolean;
  deferFeedback: boolean;
  courseUrl: string;
  courseVersion: string;
  payload: { s: Array<{ h: string; quiz?: unknown; quizEval?: unknown; survey?: unknown }> } | null;
  manualAwards: Record<string, string>;
}

/** A legacy frozen payload without document metadata must never inherit the
 * currently fetched course version, because that could validate stale answers
 * against a newer course. Live mode may use the current source identity. */
export function resolveLearningCourseVersion(
  hasFrozenPayload: boolean,
  frozenCourseVersion: string | undefined,
  liveCourseVersion: string,
): string {
  return hasFrozenPayload ? frozenCourseVersion || '' : liveCourseVersion;
}

export function readLearningSnapshot(context: LearningReadContext): {
  version: 1;
  courseUrl: string;
  courseVersion: string;
  phase: 'unavailable' | 'live' | 'collect' | 'grading' | 'review';
  payload?: { s: Array<{ h: string; quiz?: unknown; quizEval?: unknown; survey?: unknown }> };
  manualAwards?: Record<string, string>;
} {
  const phase: 'unavailable' | 'live' | 'collect' | 'grading' | 'review' = !context.ready ? 'unavailable' : context.grading ? 'grading'
    : context.payload ? 'review' : context.deferFeedback ? 'collect' : 'live';
  const identity = { version: 1 as const, courseUrl: context.courseUrl,
    courseVersion: context.courseVersion, phase };
  if (phase !== 'review' || !context.payload) return identity;
  // Do not expose submission identity, security logs, answers from code blocks,
  // or mutable references to Freeze's authoritative data structures.
  return JSON.parse(JSON.stringify({ ...identity,
    payload: { s: context.payload.s.map(({ h, quiz, quizEval, survey }) => ({ h, quiz, quizEval, survey })) },
    manualAwards: context.manualAwards,
  }));
}

export function installLearningStateReader(
  target: object,
  readContext: () => LearningReadContext,
): void {
  const key = '__liaFreezeLearningStateV1__';
  if (Object.prototype.hasOwnProperty.call(target, key)) return;
  Object.defineProperty(target, key, {
    value: Object.freeze({ read: () => readLearningSnapshot(readContext()) }),
    configurable: false,
    writable: false,
  });
}
