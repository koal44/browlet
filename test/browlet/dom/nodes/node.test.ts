import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';

describe('Node text content', () => {
  // Approved DOM TODO: observed undefined while testing navigation; neither the
  // Node implementation nor its Web IDL declaration provides textContent yet.
  it.todo('reads descendant text through the projected Node.textContent attribute', async () => {
    const browlet = new Browlet({ route: () => '<p>Local page</p>' });

    await browlet.navigate('https://example.test/');

    expect(Reflect.get(browlet.document.body!, 'textContent')).toBe('Local page');
  });
});
