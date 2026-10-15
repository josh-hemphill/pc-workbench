import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetPalettes, paletteTheme } from '../shared/theme-palettes.ts';

function luminance(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('review presets preserve readable text and distinguishable controls in both modes', () => {
  for (const [name, variants] of Object.entries(presetPalettes)) {
    for (const [mode, p] of Object.entries(variants)) {
      const check = (fg: string, bg: string, minimum: number, label: string) =>
        assert.ok(contrast(fg, bg) >= minimum, `${name}/${mode} ${label}: ${contrast(fg, bg).toFixed(2)} < ${minimum}`);
      for (const surface of ['background', 'sidebar', 'surface', 'soft'] as const) {
        for (const text of ['text', 'muted', 'primary'] as const) check(p[text], p[surface], 4.5, `${text} on ${surface}`);
        check(p.focus, p[surface], 3, `focus on ${surface}`);
      }
      check(p['on-primary'], p.primary, 4.5, 'button label');
      check(p['control-border'], p.surface, 3, 'control boundary');
      check(p.warning, p['warning-surface'], 4.5, 'warning label');
      check(p.error, p['error-surface'], 4.5, 'error label');
      const colors = paletteTheme(name as keyof typeof presetPalettes, mode as 'light' | 'dark', p).colors!;
      for (const role of ['secondary', 'success', 'info', 'warning', 'error'] as const) {
        check(String(colors[`on-${role}`]), String(colors[role]), 4.5, `${role} label`);
      }
    }
  }
});
