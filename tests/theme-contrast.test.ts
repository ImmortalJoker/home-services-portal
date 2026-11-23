import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync('src/theme.css', 'utf8');

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/.{2}/g)!.map(byte => parseInt(byte, 16) / 255);
  const linear = rgb.map(channel => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

it.each([
  ['light', ':root'],
  ['dark', ":root[data-theme='dark']"],
])('%s theme meets contrast targets for text, controls and metric bars', (_theme, selector) => {
  const block = css.split(`${selector} {`)[1].split('}')[0];
  const colors = new Map([...block.matchAll(/--portal-([\w-]+): (#[0-9a-f]{6});/gi)]
    .map(([, name, hex]) => [name, hex]));

  function check(foreground: string, background: string, minimum: number) {
    const values = [foreground, background].map(name => {
      expect(colors.get(name), name).toBeDefined();
      return luminance(colors.get(name)!);
    });
    const ratio = (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
    expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum);
  }

  for (const surface of ['page', 'surface', 'inset', 'hover']) {
    for (const text of ['text', 'muted', 'link', 'success', 'warning', 'error']) check(text, surface, 4.5);
    check('focus', surface, 3);
    check('control-border', surface, 3);
  }
  for (const fill of ['accent', 'accent-hover', 'accent-pressed']) check('on-accent', fill, 4.5);
  check('meter', 'track', 3);
  check('track', 'inset', 3);
});
