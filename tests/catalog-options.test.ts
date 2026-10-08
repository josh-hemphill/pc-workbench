import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Component, Specs } from '../shared/types';
import { catalogSuggestions, normalizeCatalogValue, normalizeCatalogValues, catalogNumericValuesRule, catalogComponentArrayRule } from '../shared/catalog-options';
const component = (id: string, specs: Component['specs'], manufacturer = ''): Component => ({ id, specs, manufacturer, name: id, category: 'Motherboard', source: '', verified: false });

test('socket and form-factor suggestions share scalar and supported-list vocabulary, preserving catalogue spelling', () => {
  const db = { components: [component('board', { socket: ' am5 ', formFactor: 'micro-atx' }), component('case', { supportedForms: ['ATX', 'Micro-ATX', 'Custom Form'] }), component('cooler', { supportsSockets: ['AM5', 'Custom Socket'] })] };
  assert.deepEqual(catalogSuggestions(db, 'socket'), catalogSuggestions(db, 'supportsSockets'));
  assert.deepEqual(catalogSuggestions(db, 'formFactor'), catalogSuggestions(db, 'supportedForms'));
  assert.equal(catalogSuggestions(db, 'socket').filter(v => String(v).toLowerCase() === 'am5').length, 1);
  assert.equal(normalizeCatalogValue(' AM5 ', catalogSuggestions(db, 'socket')), 'am5');
  assert.ok(catalogSuggestions(db, 'socket').includes('Custom Socket'));
  assert.equal(normalizeCatalogValue(' MICRO-ATX ', catalogSuggestions(db, 'supportedForms')), 'micro-atx');
});

test('text chips trim, deduplicate case-insensitively and retain novel entries and punctuation', () => {
  assert.deepEqual(normalizeCatalogValues([' windows 11 ', 'WINDOWS 11', '', null, 'Vendor OS, Enterprise', 'vendor os, enterprise'], ['Windows 11']), ['Windows 11', 'Vendor OS, Enterprise']);
  assert.equal(normalizeCatalogValue(' Novel socket ', ['AM5']), 'Novel socket');
  assert.equal(normalizeCatalogValue('  '), undefined);
  assert.deepEqual(normalizeCatalogValues(null), []);
  assert.throws(() => normalizeCatalogValues([{ title: 'AM5' }]), /text value/);
});

test('numeric chip normalization preserves typed numbers and rejects invalid dimensions without dropping them', () => {
  assert.deepEqual(normalizeCatalogValues(['80', ' 080 ', 80, '96', '110.0', '', null], [], { numeric: true }), [80, 96, 110]);
  for (const invalid of ['abc', '80mm', -1, 1.5, Infinity, 10001, {}, '0x50']) assert.throws(() => normalizeCatalogValues([80, invalid], [], { numeric: true }));
  assert.equal(catalogNumericValuesRule([30, '96']), true);
  assert.match(String(catalogNumericValuesRule(['invalid'])), /whole millimetre/);
});

test('parent save validation rejects invalid main and nested numeric drafts, and accepts unset capabilities', () => {
  assert.equal(catalogComponentArrayRule({}), true);
  assert.equal(catalogComponentArrayRule({ m2Lengths: [80], driveTargets: [{ id: 'sled', mount: 'rear-sled', m2Lengths: [110] }] }), true);
  assert.match(String(catalogComponentArrayRule({ m2Lengths: ['bad'] } as unknown as Specs)), /Motherboard M\.2 lengths/);
  assert.match(String(catalogComponentArrayRule({ driveTargets: [{ id: 'rear sled', mount: 'rear-sled', m2Lengths: [80, 'bad'] }] } as unknown as Specs)), /Drive target rear sled/);
});

test('nested targets and slot capabilities contribute reusable suggestions alongside common defaults', () => {
  const db = { components: [component('board', { m2Lengths: [80], m2Length: 96, memoryType: 'ECC DDR5', slots: [{ id: 'SLOT', bus: 'PCIe', physical: 16, lanes: 16, generation: 4, position: 1, bifurcationModes: ['x4/x4/x8'] }], driveTargets: [{ id: 'BAY', mount: 'rear-sled', m2Lengths: [110], driveSizes: ['U.2'], interfaces: ['Custom bus'] }] }, 'Lab Vendor')] };
  assert.deepEqual(catalogSuggestions(db, 'm2Lengths'), [96, 80, 110, 30, 42, 60]);
  assert.ok(catalogSuggestions(db, 'driveSizes').includes('U.2'));
  assert.ok(catalogSuggestions(db, 'interfaces').includes('Custom bus'));
  assert.ok(catalogSuggestions(db, 'bifurcationModes').includes('x4/x4/x8'));
  assert.ok(catalogSuggestions(db, 'memoryType').includes('ECC DDR5'));
  assert.deepEqual(catalogSuggestions(db, 'manufacturer'), ['Lab Vendor']);
});
