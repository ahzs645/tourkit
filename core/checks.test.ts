import { describe, expect, it } from "vitest";

import { evaluateTutorialCheck, evaluateTutorialCheckForCatchUp, readTutorialStatePath } from "./checks";
import { TutorialAliasStore } from "./references";
import { TutorialCheckSchema } from "./schema";

function snapshot(fields: Array<{ id: string; type: string; required?: boolean }>, activeTab = "builder") {
  return {
    workspace: { activeTab, pdfDock: { mode: "inline", open: false } },
    builder: {
      fields: fields.map((field) => ({ ...field, required: field.required === true })),
      selectedFieldIds: [],
    },
  };
}

const addTextField = TutorialCheckSchema.parse({
  description: "the form contains a new text field.",
  all: [{ path: "builder.fields", where: { type: "text" }, mode: "delta", captureAlias: "textField" }],
});

describe("tutorial state checks", () => {
  it("reads dotted snapshot paths and reports missing ones as undefined", () => {
    const state = snapshot([{ id: "a", type: "text" }]);
    expect(readTutorialStatePath(state, "workspace.activeTab")).toBe("builder");
    expect(readTutorialStatePath(state, "builder.fields.0.type")).toBe("text");
    expect(readTutorialStatePath(state, "builder.missing.deep")).toBeUndefined();
    expect(readTutorialStatePath(state, "builder.__proto__")).toBeUndefined();
  });

  it("accepts any route to the outcome, including converting an existing field's type", () => {
    const baseline = snapshot([]);
    // Route one: the palette adds the text field directly.
    expect(evaluateTutorialCheck(addTextField, snapshot([{ id: "a", type: "text" }]), baseline).satisfied)
      .toBe(true);
    // Route two: a number field is added first, then converted with the
    // inspector Type control. The intermediate state is not yet done.
    expect(evaluateTutorialCheck(addTextField, snapshot([{ id: "a", type: "number" }]), baseline).satisfied)
      .toBe(false);
    expect(evaluateTutorialCheck(addTextField, snapshot([{ id: "a", type: "text" }]), baseline).satisfied)
      .toBe(true);
  });

  it("requires a new match in delta mode and captures it for later references", () => {
    const baseline = snapshot([{ id: "existing", type: "text" }]);
    expect(evaluateTutorialCheck(addTextField, baseline, baseline).satisfied).toBe(false);

    const evaluation = evaluateTutorialCheck(
      addTextField,
      snapshot([{ id: "existing", type: "text" }, { id: "fresh", type: "text" }]),
      baseline,
    );
    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.captures.textField).toMatchObject({ id: "fresh", type: "text" });
  });

  it("bounds delta counts by the change since the baseline, not the absolute total", () => {
    const exactlyOneMore = TutorialCheckSchema.parse({
      all: [{ path: "builder.fields", where: { type: "text" }, mode: "delta", count: { min: 1, max: 1 } }],
    });
    const baseline = snapshot([{ id: "a", type: "text" }, { id: "b", type: "text" }]);
    // Two text fields already existed; adding exactly one more satisfies
    // max: 1 even though the absolute total is three.
    expect(evaluateTutorialCheck(
      exactlyOneMore,
      snapshot([{ id: "a", type: "text" }, { id: "b", type: "text" }, { id: "c", type: "text" }]),
      baseline,
    ).satisfied).toBe(true);
    expect(evaluateTutorialCheck(
      exactlyOneMore,
      snapshot([
        { id: "a", type: "text" },
        { id: "b", type: "text" },
        { id: "c", type: "text" },
        { id: "d", type: "text" },
      ]),
      baseline,
    ).satisfied).toBe(false);
  });

  it("compares scalars with equals and requires every clause to hold", () => {
    const check = TutorialCheckSchema.parse({
      all: [
        { path: "workspace.activeTab", equals: "preview" },
        { path: "builder.fields", where: { type: "choice", required: true } },
      ],
    });
    expect(evaluateTutorialCheck(check, snapshot([{ id: "c", type: "choice" }], "preview")).satisfied)
      .toBe(false);
    expect(
      evaluateTutorialCheck(check, snapshot([{ id: "c", type: "choice", required: true }], "preview")).satisfied,
    ).toBe(true);
  });

  it("resolves aliases in clauses and stays unsatisfied when one is unknown", () => {
    const check = TutorialCheckSchema.parse({
      all: [{ path: "builder.fields", where: { id: { $ref: "choiceField.id" }, required: true } }],
    });
    const state = snapshot([{ id: "field-1", type: "choice", required: true }]);

    const missing = evaluateTutorialCheck(check, state, undefined, new TutorialAliasStore());
    expect(missing.satisfied).toBe(false);
    expect(missing.unresolved).toContain("builder.fields");

    const aliases = new TutorialAliasStore({ choiceField: { id: "field-1" } });
    expect(evaluateTutorialCheck(check, state, undefined, aliases).satisfied).toBe(true);
  });

  it("never throws on an unknown path", () => {
    const check = TutorialCheckSchema.parse({ all: [{ path: "builder.nope", where: { type: "text" } }] });
    expect(evaluateTutorialCheck(check, snapshot([]), undefined)).toMatchObject({
      satisfied: false,
      unresolved: ["builder.nope"],
    });
  });

  it("catches up a delta step only when the item it captured is still there", () => {
    // Make a field conditional: step 1 adds a Yes/No, step 3 adds a second.
    // With no "before" for step 3, the first Yes/No must not count for it.
    const secondYesNo = TutorialCheckSchema.parse({
      all: [{ path: "builder.fields", where: { type: "booleanYesNo" }, mode: "delta", captureAlias: "secondYesNo" }],
    });
    const oneYesNo = snapshot([{ id: "first", type: "booleanYesNo" }]);
    expect(evaluateTutorialCheckForCatchUp(secondYesNo, oneYesNo).satisfied).toBe(false);

    // A resumed run that remembers the second Yes/No, and still has it.
    const aliases = new TutorialAliasStore();
    aliases.set("secondYesNo", { id: "second", type: "booleanYesNo" });
    const both = snapshot([{ id: "first", type: "booleanYesNo" }, { id: "second", type: "booleanYesNo" }]);
    expect(evaluateTutorialCheckForCatchUp(secondYesNo, both, aliases).satisfied).toBe(true);
    // …or remembers it, but the workspace lost it.
    expect(evaluateTutorialCheckForCatchUp(secondYesNo, oneYesNo, aliases).satisfied).toBe(false);

    // Absolute clauses are judged as they always were.
    const hasText = TutorialCheckSchema.parse({ all: [{ path: "builder.fields", where: { type: "text" } }] });
    expect(evaluateTutorialCheckForCatchUp(hasText, snapshot([{ id: "a", type: "text" }])).satisfied).toBe(true);
  });
});

