import { z } from 'zod';
import { colorRoles, paletteChoices } from './theme-palettes';
import { themePreferences } from './appearance';

const paletteNames = paletteChoices.map(choice => choice.value) as ['bench', 'slate', 'graphite'];
const colors = z.object(Object.fromEntries(colorRoles.map(role => [role, z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()]))).strict();
const variants = z.object({ light: colors.optional(), dark: colors.optional() }).strict();
export const appearanceSchema = z.object({
  theme: z.enum(themePreferences), palette: z.enum(paletteNames),
  customColors: z.object({ bench: variants.optional(), slate: variants.optional(), graphite: variants.optional() }).strict(),
}).strict();
export const userSettingsSchema = z.object({ version: z.literal(1), appearance: appearanceSchema }).strict();
export type AppearanceSettings = z.infer<typeof appearanceSchema>;
export type UserSettings = z.infer<typeof userSettingsSchema>;
export const defaultUserSettings: UserSettings = { version: 1, appearance: { theme: 'system', palette: 'bench', customColors: {} } };
export interface SettingsSnapshot<T> { value: T; revision: string; exists: boolean }
export interface AppSettings { version: 1; dataDir: string; port: number }
export interface AppSettingsSnapshot extends SettingsSnapshot<AppSettings> {
  effective: { dataDir: string; port: number };
  nextLaunch: { dataDir: string; port: number };
  locations: { configFile: string; userSettingsFile: string; cacheDir: string };
  overrides: { dataDir: boolean; port: boolean; configFile: boolean; userSettingsFile: boolean; cacheDir: boolean };
  restartRequired: boolean;
}
