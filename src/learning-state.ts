// A read-only bridge for optional recommendation extensions. It never captures,
// grades, restores or changes state, and withholds results during deferred Send.
export interface LearningReadContext {
  ready: boolean;
  grading: boolean;
  deferFeedback: boolean;
  courseUrl: string;
  courseVersion: string;
  payload: { s: Array<{ h: string; quiz?: unknown; quizEval?: unknown; survey?: unknown }> } | null;
  liveState?: unknown;
  manualAwards: Record<string, string>;
}

export interface LearningLiveStateV1 {
  version: 1;
  slides: Record<string, Array<{
    taskIndex: number;
    nativeIndex: number;
    table: 'quiz' | 'survey';
    outcome: 'correct' | 'wrong' | 'resolved' | 'open';
    trial: number;
  }>>;
}

function liveLearningState(value: unknown): LearningLiveStateV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.version !== 1 || !source.slides || typeof source.slides !== 'object' ||
      Array.isArray(source.slides)) return null;
  const slides: LearningLiveStateV1['slides'] = {};
  for (const [hash, rawTasks] of Object.entries(source.slides as Record<string, unknown>)) {
    if (!/^#\d+$/.test(hash) || !Array.isArray(rawTasks)) continue;
    const tasks: LearningLiveStateV1['slides'][string] = [];
    for (const rawTask of rawTasks) {
      if (!rawTask || typeof rawTask !== 'object' || Array.isArray(rawTask)) continue;
      const task = rawTask as Record<string, unknown>;
      const taskIndex = Number(task.taskIndex);
      const nativeIndex = Number(task.nativeIndex);
      const trial = Number(task.trial);
      if (!Number.isSafeInteger(taskIndex) || taskIndex < 0 ||
          !Number.isSafeInteger(nativeIndex) || nativeIndex < 0 ||
          !Number.isSafeInteger(trial) || trial < 0 ||
          (task.table !== 'quiz' && task.table !== 'survey') ||
          !['correct', 'wrong', 'resolved', 'open'].includes(String(task.outcome))) continue;
      tasks.push({
        taskIndex, nativeIndex, trial,
        table: task.table as 'quiz' | 'survey',
        outcome: task.outcome as 'correct' | 'wrong' | 'resolved' | 'open',
      });
    }
    if (tasks.length) slides[hash] = tasks;
  }
  return { version: 1, slides };
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
  liveState?: LearningLiveStateV1 | null;
  payload?: { s: Array<{ h: string; quiz?: unknown; quizEval?: unknown; survey?: unknown }> };
  manualAwards?: Record<string, string>;
} {
  const phase: 'unavailable' | 'live' | 'collect' | 'grading' | 'review' = !context.ready ? 'unavailable' : context.grading ? 'grading'
    : context.payload ? 'review' : context.deferFeedback ? 'collect' : 'live';
  const identity = { version: 1 as const, courseUrl: context.courseUrl,
    courseVersion: context.courseVersion, phase };
  if (phase === 'live') return { ...identity, liveState: liveLearningState(context.liveState) };
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
