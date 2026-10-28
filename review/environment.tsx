"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createReviewInboxStore, type ReviewInboxStore } from "./inbox-store";
import { REVIEW_PART_NOUN, reviewSubjectTitle, type ReviewSubjectKind } from "./model";
import { createReviewStorage, type ReviewBrowserStorage, type ReviewStorageSource } from "./review-storage";

export interface ReviewSubjectLabels {
  title: string;
  one: string;
  changed: string;
  removed: string;
}
export interface ReviewEnvironment {
  storage: ReviewBrowserStorage;
  inbox: ReviewInboxStore;
  labels(kind: ReviewSubjectKind): ReviewSubjectLabels;
  attachmentConfirmation: string;
  snapshotNotice: string;
  exportReturnHint: string;
  rolePlaceholder: string;
}

export function reviewSubjectLabels(kind: ReviewSubjectKind): ReviewSubjectLabels {
  const known = Object.hasOwn(REVIEW_PART_NOUN, kind) ? REVIEW_PART_NOUN[kind] : undefined;
  const title = reviewSubjectTitle(kind);
  return { title, ...(known ?? { one: "part", changed: "Part changed since", removed: "Part no longer present" }) };
}

/** Create once per host/app/user and share with layers and the inbox. */
export function createReviewEnvironment(options: {
  namespace?: string;
  storage?: ReviewStorageSource;
  reviewerStorage?: ReviewBrowserStorage;
  inbox?: ReviewInboxStore;
  kinds?: readonly ReviewSubjectKind[];
  labels?: ReviewEnvironment["labels"];
  attachmentConfirmation?: string;
  snapshotNotice?: string;
  exportReturnHint?: string;
  rolePlaceholder?: string;
} = {}): ReviewEnvironment {
  const namespace = options.namespace ?? "tourkit-review";
  return {
    storage: options.reviewerStorage ?? createReviewStorage({ namespace, storage: options.storage }),
    inbox: options.inbox ?? createReviewInboxStore({ namespace, storage: options.storage, kinds: options.kinds }),
    labels: options.labels ?? reviewSubjectLabels,
    // noPatientData is the historical wire field; this stricter neutral wording
    // confirms it without putting clinical instructions in another product.
    attachmentConfirmation: options.attachmentConfirmation ?? "This picture contains no private or sensitive information.",
    snapshotNotice: options.snapshotNotice ?? "Page pictures are included in the HTML, PDF and ZIP, including text entered on the page. Use demonstration data.",
    exportReturnHint: options.exportReturnHint ?? "HTML and ZIP can be opened again in the review tools. The PDF is for reading.",
    rolePlaceholder: options.rolePlaceholder ?? "e.g. Editor, project lead",
  };
}

export const DEFAULT_REVIEW_ENVIRONMENT = createReviewEnvironment();
const ReviewEnvironmentContext = createContext<ReviewEnvironment>(DEFAULT_REVIEW_ENVIRONMENT);
export function ReviewEnvironmentProvider({ value, children }: { value: ReviewEnvironment; children: ReactNode }) {
  return <ReviewEnvironmentContext.Provider value={value}>{children}</ReviewEnvironmentContext.Provider>;
}
export function useReviewEnvironment(): ReviewEnvironment {
  return useContext(ReviewEnvironmentContext);
}
