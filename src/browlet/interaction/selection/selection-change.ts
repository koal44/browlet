import { userInteractionTaskSource } from '../../scripting/index';
import type { DocumentImpl } from '../../dom/nodes/index';
import type { HTMLInputElementImpl, HTMLTextAreaElementImpl } from '../../dom/nodes/html/forms/index';

/** Coalesce notifications for one target; a listener may schedule a later notification. */
// https://w3c.github.io/selection-api/#scheduling-selectionchange-event
export function scheduleSelectionChange(target: SelectionChangeTarget): void {
  if (target.selectionChangeScheduled) return;
  target.selectionChangeScheduled = true;
  const document = target.nodeDocument;
  const bubbles = target.isElement();
  // SPEC_GAP(selection-change-task-owner): The draft omits task ownership. Use the current node Document's loop.
  // Document notifications retain their activity gate. Control tasks retain the target across adoption/removal.
  // SPEC_CLASH(selection-control-inactive): Follow Firefox's delivery for controls in removed frames; Chromium/WebKit suppress it.
  document.env.responsibleEventLoop.queueTask(userInteractionTaskSource, bubbles ? null : document, {
    run: () => {
      // https://w3c.github.io/selection-api/#firing-selectionchange-event
      target.selectionChangeScheduled = false;
      // SPEC_CLASH(selection-control-shadow): Follow the draft/Firefox/WebKit's control target; Chromium redirects to Document.
      target.fireEvent('selectionchange', undefined, (event) => { event.bubbles = bubbles; });
    },
  });
}

type SelectionChangeTarget = DocumentImpl | HTMLInputElementImpl | HTMLTextAreaElementImpl;
