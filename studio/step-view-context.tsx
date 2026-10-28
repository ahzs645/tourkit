import { BuilderSelect } from "../ui/builder-select";
import { Button } from "../ui/button";
import type { TutorialRecordingStep } from "../recording/types";
import { useTutorialStudioEnvironment } from "./environment";
import { tutorialContextMatches, type TutorialViewState } from "../core/view-context";

export function StepViewContext({ step, index, liveView, onChange, onGoToView }: {
  step: TutorialRecordingStep; index: number; liveView?: TutorialViewState;
  onChange: (patch: Partial<TutorialRecordingStep>) => void; onGoToView?: () => void;
}) {
  const { viewContext } = useTutorialStudioEnvironment();
  const current = viewContext(liveView ?? {});
  const matches = tutorialContextMatches(step.context, liveView);
  return <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
    <p className="font-medium">View context</p>
    <BuilderSelect aria-label={`Step ${index + 1} view scope`} value={step.context ? "view" : "any"}
      options={[{ value: "any", label: "Any view" }, { value: "view", label: "This view only", disabled: !current && !step.context }]}
      onChange={(value) => onChange({ context: value === "any" ? undefined : step.context ?? current })} />
    {step.context ? <>
      <p>Required: <strong>{step.context.label}</strong></p>
      <p role="status" className={matches ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}>
        {matches ? "The stage is on this step’s view." : "The stage is on another view. This step’s highlight is hidden."}
      </p>
      <Button size="sm" variant="secondary" disabled={!onGoToView} onClick={onGoToView}>Go to step’s view</Button>
      <Button size="sm" variant="ghost" disabled={!current} onClick={() => onChange({ context: current })}>Use current view</Button>
    </> : <p>Highlights and completion can follow this control across views. Choose “This view only” for a specific page or panel.</p>}
    <p className="text-slate-500">Current: {current?.label ?? "Waiting for the stage…"}</p>
  </div>;
}

