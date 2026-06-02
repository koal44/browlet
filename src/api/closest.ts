import { getStrictMatchResolver } from './match';

// equivalent of w3c 'closest' method
export function queryClosest(selector: string, element: Element, snap: Snapshot): Element | null {
  const resolver = getStrictMatchResolver(selector, snap);

  snap.update(element, true /*updateScope*/);

  // let rc: RuntimeCache | null = null;
  // if (resolver.usesCache && snap.hasTreeVersion) {
  //   snap.syncRuntimeCache(element);
  //   rc = snap.runtimeCache;
  // }

  let el: Element | null = element;
  while (el) {
    if (resolver.match(el, null)) return el;
    el = el.parentElement;
  }

  return null;
}
