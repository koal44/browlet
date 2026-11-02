import { afterEach, describe, expect, it, vi } from 'vitest';

import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../src/infra/index';
import type { Document } from '../../../src/browlet/platform';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { createDocumentState } from '../../../src/browlet/browsing/navigation/state/index';
import type { ElementImpl } from '../../../src/browlet/dom/nodes/element';
import { domManipulationTaskSource } from '../../../src/browlet/scripting/tasks';
import { createManualUserAgent } from '../../support/browlet-agent';
import { getRelevantRealm, project, unwrap } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('queue an element task', () => {
  it.each([
    { namespace: HTML_NAMESPACE, name: 'div' },
    { namespace: SVG_NAMESPACE, name: 'rect' },
  ])('queues $name tasks with global tasks in source order', ({ namespace, name }) => {
    const source = createWindow();
    const element = unwrap<ElementImpl>(source.document.createElementNS(namespace, name));
    const observed: string[] = [];

    element.queueTask(domManipulationTaskSource, () => { observed.push('element:first'); });
    source.realm.queueGlobalTask(domManipulationTaskSource, () => { observed.push('global'); });
    element.queueTask(domManipulationTaskSource, () => { observed.push('element:last'); });

    expect(observed).toEqual([]);
    for (const task of source.loop.getTaskQueue(domManipulationTaskSource)) {
      expect(task.source).toBe(domManipulationTaskSource);
      expect(task.document).toBe(source.documentImpl);
    }
    expect(source.loop.runTaskTurn()).toBe(true);
    expect(observed).toEqual(['element:first']);
    expect(source.loop.runTaskTurn()).toBe(true);
    expect(source.loop.runTaskTurn()).toBe(true);
    expect(source.loop.runTaskTurn()).toBe(false);
    expect(observed).toEqual(['element:first', 'global', 'element:last']);
  });

  it('uses the creation Window document when the node document has no browsing context', () => {
    const source = createWindow();
    const detachedDocument = source.document.implementation.createHTMLDocument();
    const platform = detachedDocument.createElement('div');
    const element = unwrap<ElementImpl>(platform);
    const steps = vi.fn();
    expect(detachedDocument.defaultView).toBeNull();
    expect(getRelevantRealm(platform)).toBe(source.realm);
    expect(element.nodeDocument.isFullyActive()).toBe(false);

    element.queueTask(domManipulationTaskSource, steps);

    const [task] = source.loop.getTaskQueue(domManipulationTaskSource);
    expect(task?.document).toBe(source.documentImpl);
    expect(source.loop.runTaskTurn()).toBe(true);
    expect(steps).toHaveBeenCalledOnce();
  });

  it.each(['neither', 'source', 'destination'])(
    'retains the creation global before and after adoption (inactive: %s)',
    (inactive) => {
      const source = createWindow();
      const destination = createWindow();
      const platform = source.document.createElement('div');
      const element = unwrap<ElementImpl>(platform);
      const observed: string[] = [];
      expect(destination.loop).not.toBe(source.loop);

      element.queueTask(domManipulationTaskSource, () => { observed.push('before adoption'); });
      expect(destination.document.adoptNode(platform)).toBe(platform);
      expect(platform.ownerDocument).toBe(destination.document);
      expect(getRelevantRealm(platform)).toBe(source.realm);
      element.queueTask(domManipulationTaskSource, () => { observed.push('after adoption'); });

      const paused = inactive === 'source' ? source : inactive === 'destination' ? destination : null;
      const activeEntry = paused?.traversable.activeSessionHistoryEntry;
      if (paused !== null && activeEntry !== undefined) {
        paused.traversable.activeSessionHistoryEntry = {
          ...activeEntry, documentState: createDocumentState(null),
        };
        expect(paused.documentImpl.isFullyActive()).toBe(false);
      }

      const tasks = [...source.loop.getTaskQueue(domManipulationTaskSource)];
      expect(tasks).toHaveLength(2);
      for (const task of tasks) expect(task.document).toBe(source.documentImpl);
      expect(destination.loop.getTaskQueue(domManipulationTaskSource).size).toBe(0);
      expect(destination.loop.runTaskTurn()).toBe(false);

      if (inactive === 'source') {
        expect(source.loop.runTaskTurn()).toBe(false);
        expect(observed).toEqual([]);
        source.traversable.activeSessionHistoryEntry = activeEntry!;
      }
      expect(source.loop.runTaskTurn()).toBe(true);
      expect(source.loop.runTaskTurn()).toBe(true);
      expect(source.loop.runTaskTurn()).toBe(false);
      expect(observed).toEqual(['before adoption', 'after adoption']);
    },
  );
});

function createWindow() {
  const traversable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const documentImpl = traversable.activeDocument!;
  const realm = documentImpl.env.realm;
  return {
    traversable, documentImpl, realm,
    document: project(documentImpl) as Document,
    loop: realm.agent.eventLoop,
  };
}
