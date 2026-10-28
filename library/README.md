# Published tutorial library

`TutorialLibrary` renders ordered lesson collections as cards or compact rows,
with search, setup/type and status filters, prerequisites, section navigation,
duration/level labels, progress badges, and Practice/Watch controls.
`TutorialLibraryProgress` supplies the overall progress and suggested next lesson.

The caller owns the catalog, section IDs/order, introductory copy, routing,
storage scope, optional menus and export environment. Sections can represent any
course categories; they do not need to match manifest v1's track enum.

```tsx
import { TutorialLibrary, TutorialLibraryProgress } from "tourkit/library";

const sections = [
  { id: "purchasing", title: "Purchasing", tutorials: purchasingLessons },
  { id: "stock-control", title: "Stock control", tutorials: inventoryLessons },
];

<TutorialLibrary
  sections={sections}
  statuses={statuses}
  onLaunch={(tutorial, mode) => startTraining(tutorial, mode)}
  layout="rows"
/>
```

Use `launchHref(tutorial, mode)` instead of `onLaunch` for ordinary links.
The mode is `practice` or `autoplay`. Keep routes in the consumer; the library
does not assume a hash, router, stage registry or Studio environment.
`renderMenu(tutorial, onNotice)` can supply the existing `TutorialCardMenu`
inside the consumer's environment, or a menu owned by a different application.
`tutorialLibraryExportGroups(sections)` preserves the same grouping for
`TutorialBulkExport`. This keeps export capability optional.

## Live status

`statuses` is a read-only record keyed by tutorial ID, with optional
`completedAt` and 1-based `inProgressStep`. To adapt persistent stores, use
`createTutorialLibraryStatusSource({ readCompletions, readProgress, subscribe })`
and `useTutorialLibraryStatuses(tutorialIds, source)`.

The source's cache is scoped to its instance and the actual ordered IDs, so a
new catalog of the same length does not reuse another catalog's status. The
underlying `subscribe` should report both same-document writes and cross-tab
changes. A host without an observable store can call `source.invalidate()`
after a write. Create a separate source when the app/user/tenant scope changes.
The server snapshot is empty; client storage is read after hydration.

Completion takes priority over a retained interrupted run. Suggested lessons
prefer unfinished progress, then the first unstarted lesson in collection
order. A repeated lesson counts once in the overall progress summary.

A host adapter supplies its own stores, launch URLs, menus, lesson catalogs,
tabs and fixture links. This directory has no application imports.

`library.test.tsx` covers unrelated warehouse and observatory collections,
same-length catalog changes, persistence-source changes, live writes, export
grouping, filtering, prerequisites, menus and launch callbacks/links.
