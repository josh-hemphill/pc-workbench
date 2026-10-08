import type { Database, Specs } from './types';

export type CatalogOption = string | number;
const defaults: Record<string, CatalogOption[]> = {
  socket: ['AM5', 'AM4', 'LGA1851', 'LGA1700', 'LGA1200', 'LGA1151', 'sTR5', 'sTRX4', 'TR4', 'SP5', 'SP3'],
  formFactor: ['ATX', 'Micro-ATX', 'Mini-ITX', 'E-ATX'],
  memoryType: ['DDR5', 'DDR4', 'DDR3', 'DDR2', 'DDR', 'LPDDR5', 'LPDDR4'],
  supportedOS: ['Windows 11', 'Windows 10', 'Windows Server 2025', 'Ubuntu', 'Debian', 'Red Hat Enterprise Linux', 'Linux', 'macOS'],
  m2Lengths: [30, 42, 60, 80, 110],
  driveSizes: ['2.5', '3.5', 'M.2'],
  interfaces: ['SATA', 'NVMe', 'SAS'],
  bifurcationModes: ['x16', 'x8/x8', 'x8/x4/x4', 'x4/x4/x4/x4', 'x4/x4'],
};
const aliases: Record<string, string> = { supportsSockets: 'socket', supportedForms: 'formFactor', m2Length: 'm2Lengths', driveSize: 'driveSizes', driveInterface: 'interfaces', bifurcationMode: 'bifurcationModes' };
function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') throw TypeError('Choose or enter a text value.');
  const trimmed = String(value).trim();
  return trimmed || undefined;
}
function entries(value: unknown): unknown[] { return Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]; }

/** Reuse exact catalogue spelling without guessing aliases for different engineering values. */
export function normalizeCatalogValue(value: unknown, preferred: readonly unknown[] = []): string | undefined {
  const normalized = text(value);
  if (!normalized) return undefined;
  const key = normalized.toLowerCase();
  const match = preferred.find(item => (typeof item === 'string' || typeof item === 'number') && String(item).trim().toLowerCase() === key);
  return match === undefined ? normalized : String(match).trim();
}

function millimetres(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.0+)?$/.test(value.trim()))) throw TypeError('Use whole millimetre values from 0 to 10,000.');
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 10000) throw RangeError('Use whole millimetre values from 0 to 10,000.');
  return number;
}

export function normalizeCatalogValues(value: unknown, preferred?: readonly unknown[], options?: { numeric?: false }): string[];
export function normalizeCatalogValues(value: unknown, preferred: readonly unknown[], options: { numeric: true }): number[];
export function normalizeCatalogValues(value: unknown, preferred: readonly unknown[], options: { numeric: boolean }): CatalogOption[];
export function normalizeCatalogValues(value: unknown, preferred: readonly unknown[] = [], options: { numeric?: boolean } = {}): CatalogOption[] {
  const result: CatalogOption[] = [], seen = new Set<string>();
  for (const item of entries(value)) {
    const normalized = options.numeric ? millimetres(item) : normalizeCatalogValue(item, preferred);
    if (normalized === undefined) continue;
    const key = String(normalized).toLowerCase();
    if (!seen.has(key)) { seen.add(key); result.push(normalized); }
  }
  return result;
}

/** Suitable for Vuetify rules; normalization throws instead of silently dropping invalid lengths. */
export function catalogNumericValuesRule(value: unknown): true | string {
  try { normalizeCatalogValues(value, [], { numeric: true }); return true; }
  catch (error) { return error instanceof Error ? error.message : 'Enter valid whole millimetre values.'; }
}

/** Validate pending numeric chips in the component draft before saving its parent editor. */
export function catalogComponentArrayRule(specs: Specs): true | string {
  const main = catalogNumericValuesRule(specs.m2Lengths);
  if (main !== true) return `Motherboard M.2 lengths: ${main}`;
  for (const target of specs.driveTargets || []) {
    const result = catalogNumericValuesRule(target.m2Lengths);
    if (result !== true) return `Drive target ${target.id || '(unnamed)'}: ${result}`;
  }
  return true;
}

export function catalogSuggestions(db: Pick<Database, 'components'>, field: 'm2Lengths' | 'm2Length'): number[];
export function catalogSuggestions(db: Pick<Database, 'components'>, field: string): CatalogOption[];
export function catalogSuggestions(db: Pick<Database, 'components'>, field: string): CatalogOption[] {
  const vocabulary = aliases[field] || field, values: unknown[] = [];
  for (const component of db.components) {
    const specs = component.specs;
    if (field === 'manufacturer') values.push(component.manufacturer);
    else if (vocabulary === 'socket') values.push(specs.socket, ...specs.supportsSockets || []);
    else if (vocabulary === 'formFactor') values.push(specs.formFactor, ...specs.supportedForms || []);
    else if (vocabulary === 'm2Lengths') values.push(specs.m2Length, ...specs.m2Lengths || [], ...(specs.driveTargets || []).flatMap(target => target.m2Lengths || []));
    else if (vocabulary === 'driveSizes') values.push(specs.driveSize, ...(specs.driveTargets || []).flatMap(target => target.driveSizes || []));
    else if (vocabulary === 'interfaces') values.push(specs.driveInterface, ...(specs.driveTargets || []).flatMap(target => target.interfaces || []));
    else if (vocabulary === 'bifurcationModes') values.push(specs.bifurcationMode, ...(specs.slots || []).flatMap(slot => slot.bifurcationModes || []));
    else values.push(...entries((specs as Record<string, unknown>)[field]));
  }
  // Catalogue values precede defaults: the first stored spelling remains the preferred spelling.
  return normalizeCatalogValues([...values, ...defaults[vocabulary] || []], [], { numeric: vocabulary === 'm2Lengths' });
}
