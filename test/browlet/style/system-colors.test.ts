import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { absoluteColorFromRgba, createSystemColorPalette } from '../../../src/stylelet/index';

describe('Browlet system-color configuration', () => {
  it('exposes configured initial and explicit system colors through getComputedStyle', async () => {
    const systemColors = createSystemColorPalette({
      canvastext: absoluteColorFromRgba(0x123456ff),
      canvas: absoluteColorFromRgba(0xabcdefff),
    });
    const browlet = new Browlet({ route: () => '', systemColors });
    const read = () => {
      const main = document.createElement('main');
      const child = document.createElement('span');
      main.style.backgroundColor = 'Canvas';
      child.style.color = 'CanvasText';
      main.append(child);
      document.body.append(main);
      return [
        getComputedStyle(document.documentElement).color,
        getComputedStyle(main).backgroundColor,
        getComputedStyle(child).color,
      ];
    };
    expect(await browlet.evaluate(read)).toEqual(['rgb(18, 52, 86)', 'rgb(171, 205, 239)', 'rgb(18, 52, 86)']);

    systemColors.set('canvastext', absoluteColorFromRgba(0x654321ff));
    expect(await browlet.evaluate(read)).toEqual(['rgb(101, 67, 33)', 'rgb(171, 205, 239)', 'rgb(101, 67, 33)']);
  });
});
