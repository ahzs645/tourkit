"use client";

import { useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Modal } from "../ui/modal";
import {
  currentRound,
  liveItems,
  mergeReviewBundles,
  personLabel,
  startNextRound,
  type ReviewFeedbackBundle,
  type ReviewPerson,
} from "./model";

import { useReviewEnvironment } from "./environment";

/** Optional name and role, stamped on the round and on each item. */
export function ReviewIdentityDialog({
  open,
  person,
  onClose,
  onSave,
}: {
  open: boolean;
  person: ReviewPerson;
  onClose: () => void;
  onSave: (person: ReviewPerson) => void;
}) {
  return open ? <IdentityForm person={person} onClose={onClose} onSave={onSave} /> : null;
}

function IdentityForm({ person, onClose, onSave }: { person: ReviewPerson; onClose: () => void; onSave: (person: ReviewPerson) => void }) {
  const environment = useReviewEnvironment();
  const [name, setName] = useState(person.name ?? "");
  const [role, setRole] = useState(person.role ?? "");
  return (
    <Modal open onClose={onClose} size="sm">
      <Modal.Header title="Who is reviewing?" description="Optional. Your name goes on this round and on each comment you add, so the author knows who to ask." />
      <Modal.Body className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Jordan Lee" autoFocus />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Role</span>
          <Input value={role} onChange={(event) => setRole(event.target.value)} placeholder={environment.rolePlaceholder} />
        </label>
      </Modal.Body>
      <Modal.Footer className="justify-between">
        <Button variant="ghost" onClick={() => onSave({})}>Stay anonymous</Button>
        <Button variant="primary" onClick={() => onSave({ name: name.trim() || undefined, role: role.trim() || undefined })}>Save</Button>
      </Modal.Footer>
    </Modal>
  );
}

/**
 * A review file was opened: add to its last round, or start the next one.
 * When this browser already holds feedback for the form, the two are merged.
 */
export function ReviewLoadedDialog({
  loaded,
  current,
  hasCurrent,
  me,
  onClose,
  onApply,
}: {
  loaded: { bundle: ReviewFeedbackBundle; mismatch: boolean } | null;
  current: ReviewFeedbackBundle | null;
  hasCurrent: boolean;
  me: ReviewPerson;
  onClose: () => void;
  onApply: (bundle: ReviewFeedbackBundle) => void;
}) {
  if (!loaded) return null;
  const incoming = loaded.bundle;
  const canMerge = current && hasCurrent && !loaded.mismatch;
  const merged = canMerge ? mergeReviewBundles(current, incoming) : incoming;
  const last = currentRound(merged);
  const count = liveItems(incoming).length;
  const continueRound = () => {
    const rounds = merged.rounds.map((round) => (round.number === last.number ? { ...round, closedAt: null } : round));
    onApply({ ...merged, rounds });
  };
  return (
    <Modal open onClose={onClose} size="sm">
      <Modal.Header title="Review opened" description={`${incoming.form.name}: ${count} item${count === 1 ? "" : "s"} over ${incoming.rounds.length} round${incoming.rounds.length === 1 ? "" : "s"}.`} />
      <Modal.Body className="space-y-2 text-sm">
        <ul className="space-y-1 text-slate-600 dark:text-slate-300">
          {incoming.rounds.map((round) => (
            <li key={round.number}>Round {round.number}: {personLabel(round.reviewer)}{round.closedAt ? " (closed)" : ""}</li>
          ))}
        </ul>
        {loaded.mismatch ? (
          <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
            This feedback was given on “{incoming.form.name}”. Comments on parts absent from this view are listed but not pinned.
          </p>
        ) : null}
        {canMerge ? <p className="text-slate-600 dark:text-slate-300">It will be merged with the feedback already in this browser.</p> : null}
      </Modal.Body>
      <Modal.Footer className="justify-between">
        <Button variant="secondary" onClick={continueRound}>Add to round {last.number}</Button>
        <Button variant="primary" onClick={() => onApply(startNextRound(merged, me))}>Start round {last.number + 1}</Button>
      </Modal.Footer>
    </Modal>
  );
}

