"use client";

import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "../ui/button";
import {
  createReviewEnvironment,
  ReviewEnvironmentProvider,
  ReviewFeedbackLayer,
  ReviewInboxHost,
  type ReviewSurface,
  type ReviewableField,
} from "../review";

const environment = createReviewEnvironment({
  namespace: "tourkit-review-demo",
  kinds: ["proposal"],
  labels: () => ({ title: "Proposal", one: "paragraph", changed: "Paragraph edited", removed: "Paragraph removed" }),
});

/** An unrelated document editor proving that review is an optional host adapter. */
function ProposalReviewExample() {
  const [revised, setRevised] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const description = revised
    ? "Run a six-week pilot, measure time saved each week, and publish the results."
    : "Run a six-week pilot to explore a better way to share project updates.";
  const parts = useMemo<ReviewableField[]>(() => [
    { id: "overview", label: "Project overview", type: "paragraph", options: [description] },
    { id: "outcomes", label: "Expected outcomes", type: "paragraph", options: ["One shared progress view", "A repeatable handover"] },
  ], [description]);
  const surface = useMemo<ReviewSurface>(() => ({
    kind: "proposal", subjectId: "community-project", name: "Community project proposal", target: "preview", shareUrl: typeof window === "undefined" ? null : window.location.href.split("#")[0],
    anchorAttributes: ["data-proposal-part"], parts,
    place: (pick) => ({ partId: pick?.value ?? null, label: parts.find((part) => part.id === pick?.value)?.label ?? null, page: "Proposal" }),
  }), [parts]);
  const openInbox = () => {
    const bundle = environment.storage.readStoredReview(environment.storage.reviewKey(surface));
    if (!bundle) { setError("Add feedback to the proposal first."); return; }
    environment.inbox.import(bundle, { open: ["proposal"] });
    setError(null);
  };

  return <ReviewEnvironmentProvider value={environment}>
    <main className="mx-auto max-w-4xl px-4 py-6 text-slate-900 dark:text-slate-100 sm:px-8 sm:py-10">
      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-sky-700 dark:text-sky-300">Tourkit · optional review tools</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Review a project proposal</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">Pin a comment to a paragraph, sketch a change, and send back an editable review file.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={openInbox}>Open saved review in inbox</Button>
          <Button variant="secondary" onClick={() => setRevised((value) => !value)}>{revised ? "Restore proposal wording" : "Revise proposal wording"}</Button>
        </div>
        {error ? <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
      </header>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900" aria-label="Proposal preview">
        <ReviewFeedbackLayer surface={surface}>
          <article className="min-h-[520px] space-y-7 p-6 pb-32 sm:p-10 sm:pb-28">
            <div className="flex items-center justify-between border-b border-slate-200 pb-5 dark:border-slate-700">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Community project</p>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">Draft for review</span>
            </div>
            <section data-proposal-part="overview" className="space-y-2 rounded-lg">
              <h2 className="text-xl font-semibold">Project overview</h2>
              <p className="leading-relaxed text-slate-700 dark:text-slate-200">{description}</p>
            </section>
            <section data-proposal-part="outcomes" className="space-y-2 rounded-lg">
              <h2 className="text-lg font-semibold">Expected outcomes</h2>
              <ul className="list-disc space-y-1 pl-5 text-slate-700 dark:text-slate-200">
                <li>One shared progress view for the project team.</li>
                <li>A repeatable handover to the next coordinator.</li>
              </ul>
            </section>
            <p className="text-xs text-slate-500 dark:text-slate-400">Demonstration content · no account or server required</p>
          </article>
        </ReviewFeedbackLayer>
      </section>
      <p className="mt-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Reviews stay in this browser until you export them. HTML and ZIP files preserve the comments, drawings, replies, and rounds.</p>
    </main>
    <ReviewInboxHost kinds={["proposal"]} dropHint="open it here" partsFor={() => new Map(parts.map((part) => [part.id, part]))} />
  </ReviewEnvironmentProvider>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<ProposalReviewExample />);
