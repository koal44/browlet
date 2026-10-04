import type { DOMElement as Element } from '../../infra/index';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { SelectletContext } from '../context';
import { getStrictMatchResolver } from './match';

// equivalent of w3c 'closest' method
export function queryClosest(selector: string, element: Element, ctx: SelectletContext): Element | null {
  const resolver = getStrictMatchResolver(selector, ctx);

  ctx.update(element, true /*updateScope*/);

  let rc: RuntimeCache | null = null;
  if (resolver.usesCache && (ctx.dom.treeVersion !== undefined)) {
    ctx.syncRuntimeCache(element);
    rc = ctx.runtimeCache;
  }

  let el: Element | null = element;
  while (el) {
    if (resolver.match(el, rc)) return el;
    el = ctx.dom.parentElement(el);
  }

  return null;
}
