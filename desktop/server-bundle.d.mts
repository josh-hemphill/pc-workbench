// Public contract of build-backend.ts's generated, self-contained server bundle.
import type { Application } from './backend.ts';
export interface Asset { data: Uint8Array; mime: string }
export function createApp(dataDir: string, options?: {assets?: Record<string, Asset>}): Application;
export function resolveRuntimeConfig(options: {standalone: boolean}): {dataDir: string; port: number};
export const assets: Record<string, Asset>;
