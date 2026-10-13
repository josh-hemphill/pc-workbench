// Public contract of build-backend.ts's generated, self-contained server bundle.
import type { Application } from './backend.ts';
export interface Asset { data: Uint8Array; mime: string }
export interface RuntimeConfig {
  configFile: string; userSettingsFile: string; cacheDir: string; dataDir: string; port: number; defaultDataDir: string; homeDir: string;
  overrides: { dataDir: boolean; port: boolean; configFile: boolean; userSettingsFile: boolean; cacheDir: boolean };
}
export function createApp(dataDir: string, options?: {assets?: Record<string, Asset>; runtimeConfig?: RuntimeConfig}): Application;
export function resolveRuntimeConfig(options: {standalone: boolean}): RuntimeConfig;
export function assertSettingsSeparation(config: RuntimeConfig): void;
export const assets: Record<string, Asset>;
