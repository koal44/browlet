import { matchStrict } from './match';

// equivalent of w3c 'closest' method
export function queryClosest(selector: string, element: Element, snap: Snapshot): Element | null {
  let el: Element | null = element;
  snap.update(element, true /*updateScope*/);
  while (el) {
    if (matchStrict(selector, el, snap, null)) break;
    el = el.parentElement;
  }
  return el;
}
