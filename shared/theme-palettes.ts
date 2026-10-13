import type { ThemeDefinition } from 'vuetify';

export const paletteChoices = [
  { title: 'Bench green', value: 'bench' },
  { title: 'Slate blue', value: 'slate' },
  { title: 'Graphite', value: 'graphite' },
] as const;
export type PaletteName = typeof paletteChoices[number]['value'];
export type PaletteMode = 'light' | 'dark';
export const colorRoles = [
  'background', 'sidebar', 'surface', 'soft', 'text', 'muted', 'primary',
  'on-primary', 'border', 'control-border', 'focus', 'warning',
  'warning-surface', 'error', 'error-surface',
] as const;
export type ColorRole = typeof colorRoles[number];
export type Palette = Record<ColorRole, string>;

const benchLight: Palette = {
  background: '#f6f7f4', sidebar: '#fbfcfa', surface: '#ffffff', soft: '#f0f4ed',
  text: '#26322b', muted: '#465647', primary: '#284d37', 'on-primary': '#ffffff',
  border: '#d8dfd4', 'control-border': '#738171', focus: '#175d88',
  warning: '#755017', 'warning-surface': '#fbf5e8', error: '#922f28', 'error-surface': '#fbefe7',
};
const benchDark: Palette = {
  background: '#141c17', sidebar: '#19231d', surface: '#202c24', soft: '#29392e',
  text: '#e3ede5', muted: '#bdcfc1', primary: '#a2dbb7', 'on-primary': '#10271a',
  border: '#405747', 'control-border': '#91aa99', focus: '#8dccff',
  warning: '#f3ce8d', 'warning-surface': '#42351e', error: '#ffb4ad', 'error-surface': '#422720',
};
export const presetPalettes: Record<PaletteName, Record<PaletteMode, Palette>> = {
  bench: { light: benchLight, dark: benchDark },
  slate: {
    light: { ...benchLight, background: '#f4f6f9', sidebar: '#f9fbfd', soft: '#eaf0f7', text: '#243247', muted: '#43536a', primary: '#294f78', border: '#d4dce7', 'control-border': '#6b7f99', focus: '#175d88' },
    dark: { ...benchDark, background: '#151c27', sidebar: '#1a2432', surface: '#202d3d', soft: '#293c51', text: '#e3ebf5', muted: '#becddd', primary: '#a4c9f2', 'on-primary': '#132b46', border: '#405570', 'control-border': '#91a8c3' },
  },
  graphite: {
    light: { ...benchLight, background: '#f5f5f5', sidebar: '#fafafa', soft: '#ededed', text: '#292929', muted: '#505050', primary: '#414141', border: '#d9d9d9', 'control-border': '#797979' },
    dark: { ...benchDark, background: '#181818', sidebar: '#202020', surface: '#282828', soft: '#353535', text: '#eeeeee', muted: '#c5c5c5', primary: '#d0d0d0', 'on-primary': '#222222', border: '#505050', 'control-border': '#a0a0a0' },
  },
};

export function paletteTheme(name: PaletteName, mode: PaletteMode, palette: Palette) {
  const dark = mode === 'dark';
  return {
    dark,
    colors: {
      ...palette,
      'on-background': palette.text, 'on-surface': palette.text,
      'surface-bright': palette.surface, 'surface-light': palette.soft,
      'surface-variant': palette.soft, 'on-surface-variant': palette.text,
      secondary: name === 'bench' ? (dark ? '#bdd0c2' : '#435743') : palette.muted,
      'on-secondary': dark ? palette.background : '#ffffff',
      success: dark ? '#a2dbb7' : '#284d37', 'on-success': dark ? '#10271a' : '#ffffff',
      info: palette.focus, 'on-info': dark ? palette.background : '#ffffff',
      'on-warning': dark ? '#352409' : '#ffffff', 'on-error': dark ? '#41100b' : '#ffffff',
    },
  } satisfies ThemeDefinition;
}

export function paletteCssVariables(palette: Palette, mode: PaletteMode): Record<string, string> {
  return {
    ...Object.fromEntries(colorRoles.map(role => [`--bench-${role}`, palette[role]])),
    '--bench-shadow': mode === 'dark' ? '#00000038' : '#24331d06',
  };
}
