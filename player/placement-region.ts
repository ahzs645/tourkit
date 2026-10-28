import { visibleBoxOf } from "./anchor";

/** Keep the context needed to interpret a control visible, without enlarging its ring. */
export function tutorialPlacementRegion(control: HTMLElement): HTMLElement {
  // Hosts may name a particular working panel. Otherwise semantic containers
  // supply context: a cell's table, an option's list, or a field's labelled group.
  const explicit = control.closest<HTMLElement>("[data-tutorial-card-region]");
  if (explicit) return explicit;
  return control.closest<HTMLElement>('table, [role="grid"], [role="table"], [role="listbox"], [role="menu"], fieldset, [role="group"]')
    ?? visibleBoxOf(control);
}

