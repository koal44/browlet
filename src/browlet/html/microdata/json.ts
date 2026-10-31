import { serializeURL } from '../../../url/index';

import type { NodeImpl } from '../../dom/nodes/index';
import { HTMLElementImpl } from '../../dom/nodes/html/index';

/** Serialize the supplied top-level items to compact JSON, preserving input order and repetitions. */
// https://html.spec.whatwg.org/multipage/microdata.html#extracting-json
export function extractMicrodataJSON(nodes: NodeImpl[]): string {
  const items: ItemObject[] = [];
  for (const node of nodes) {
    if (HTMLElementImpl.is(node) && node.isTopLevelMicrodataItem()) items.push(getObject(node));
  }
  return JSON.stringify({ items });
}

interface ItemObject {
  type?: string[];
  id?: string;
  properties: Record<string, (string | ItemObject)[]>;
}

/** Build an item's JSON object, replacing cycles in the current ancestor path with "ERROR". */
// https://html.spec.whatwg.org/multipage/microdata.html#get-the-object
function getObject(item: HTMLElementImpl, memory: HTMLElementImpl[] = []): ItemObject {
  memory.push(item);
  const types = item.getItemTypes();
  const id = item.getItemGlobalIdentifier();
  // Property names such as __proto__ and constructor are ordinary data keys.
  const properties = Object.create(null) as ItemObject['properties'];

  for (const element of item.getItemProperties().properties) {
    const propertyValue = element.getPropertyValue()!;
    const value = typeof propertyValue === 'string' ? propertyValue :
      memory.includes(propertyValue) ? 'ERROR' : getObject(propertyValue, [...memory]);
    for (const name of element.getPropertyNames()) {
      (properties[name] ??= []).push(value);
    }
  }

  return {
    ...(types.length > 0 ? { type: types } : {}),
    ...(id !== null ? { id: serializeURL(id) } : {}),
    properties,
  };
}
