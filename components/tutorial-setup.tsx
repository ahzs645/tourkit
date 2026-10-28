import type { TutorialSetup } from "../core/schema";

export const TUTORIAL_SETUP_KINDS = {
  orientation: "Orientation",
  navigation: "Navigation practice",
  task: "Task practice",
  overview: "Workflow overview",
} as const;

/** Learners can inspect the exercise's scope before launching it. */
export function TutorialSetupDetails({ setup }: { setup?: TutorialSetup }) {
  if (!setup) return null;
  return (
    <details className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300" data-testid="tutorial-setup">
      <summary className="cursor-pointer font-medium text-sky-700 dark:text-sky-300">Lesson setup · {TUTORIAL_SETUP_KINDS[setup.kind]}</summary>
      <dl className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
        <div><dt className="font-semibold">Goal</dt><dd>{setup.goal}</dd></div>
        {setup.audience.length > 0 ? <div><dt className="font-semibold">For</dt><dd>{setup.audience.join("; ")}</dd></div> : null}
        {setup.access.length > 0 ? <div><dt className="font-semibold">Access and preparation</dt><dd>{setup.access.join("; ")}</dd></div> : null}
        <div><dt className="font-semibold">Starting screen</dt><dd>{setup.startingScreen}{setup.scenarioDate ? ` · training date ${setup.scenarioDate}` : ""}</dd></div>
        {setup.applicationVersion ? <div><dt className="font-semibold">Interface version</dt><dd>{setup.applicationVersion}</dd></div> : null}
        {setup.sources.length > 0 ? <div><dt className="font-semibold">References</dt><dd>{setup.sources.map((source, index) => <p key={index}>{source.title} · {source.version}{source.articleIds.length ? ` · articles ${source.articleIds.join(", ")}` : ""}{source.capturedAt ? ` · archive date ${source.capturedAt}` : ""}</p>)}</dd></div> : null}
        {setup.limitations.length > 0 ? <div><dt className="font-semibold">What completion means</dt><dd><ul className="list-disc pl-4">{setup.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></dd></div> : null}
      </dl>
    </details>
  );
}

