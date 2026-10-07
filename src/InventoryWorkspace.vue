<script setup lang="ts">
import { computed, ref } from 'vue';
import { mdiPlus, mdiMagnify, mdiArrowLeft, mdiArrowRight, mdiDownload, mdiMemory, mdiCheckCircleOutline, mdiAlertCircleOutline, mdiClose, mdiInformationOutline } from '@mdi/js';
import type { Database, InventoryPC, StockAllocation, StockRecord } from '../shared/types';
import { checkInstalledPC, pcAllocations, planDifferences, stockCounts, stockReadiness } from '../shared/inventory';

const props = defineProps<{ db: Database; mode: 'stock' | 'pcs' }>();
const emit = defineEmits<{ reload: []; notify: [message: string]; editPc: [pc?: InventoryPC] }>();
const search = ref(''), tracking = ref('All tracking'), condition = ref('All conditions');
const stockId = ref(''), pcId = ref(''), tab = ref('parts'), stockTab = ref('allocations');
const draft = ref<StockRecord | null>(null), busy = ref(false);
const operation = ref<{
  action: 'reserve' | 'install' | 'install-reserved' | 'release' | 'remove' | 'configure';
  stockId: string; pcId: string; allocationId: string; quantity: number; plannedPlacementId: string;
  slotId: string; role: StockAllocation['role']; mount: StockAllocation['mount']; notes: string;
} | null>(null);
const adjustment = ref<{ stockId: string; quantity: number; notes: string } | null>(null);
const transfer = ref<{ stockId: string; quantity: number; assetTag: string; location: string; condition: StockRecord['condition']; notes: string } | null>(null);
const part = (id: string) => props.db.components.find(c => c.id === id);
const pcName = (id: string) => props.db.pcs.find(p => p.id === id)?.name || id;
const stockLabel = (s: StockRecord) => `${part(s.componentId)?.name || s.componentId} · ${s.serial || s.assetTag || s.id.slice(0, 8)} · ${stockCounts(s).available} available`;
const selectedStock = computed(() => props.db.inventory.find(s => s.id === stockId.value));
const selectedPC = computed(() => props.db.pcs.find(p => p.id === pcId.value));
const template = computed(() => props.db.configurations.find(c => c.id === selectedPC.value?.configurationId));
const allocations = computed(() => pcAllocations(pcId.value, props.db));
const readiness = computed(() => template.value ? stockReadiness(template.value, props.db, pcId.value) : []);
const differences = computed(() => selectedPC.value ? planDifferences(selectedPC.value, props.db) : []);
const installedReport = computed(() => selectedPC.value ? checkInstalledPC(selectedPC.value, props.db) : null);
const stocks = computed(() => props.db.inventory.filter(s =>
  `${part(s.componentId)?.name} ${s.serial} ${s.assetTag} ${s.location}`.toLowerCase().includes(search.value.toLowerCase()) &&
  (tracking.value === 'All tracking' || s.tracking === tracking.value) && (condition.value === 'All conditions' || s.condition === condition.value)));
const pcs = computed(() => props.db.pcs.filter(p => `${p.name} ${p.serial} ${p.location}`.toLowerCase().includes(search.value.toLowerCase())));
const totals = computed(() => props.db.inventory.reduce((n, s) => { const c = stockCounts(s); return { available: n.available + c.available, reserved: n.reserved + c.reserved, installed: n.installed + c.installed }; }, { available: 0, reserved: 0, installed: 0 }));
const movements = computed(() => props.db.inventory.flatMap(stock => stock.history.filter(e => e.pcId === pcId.value).map(event => ({ stock, event }))).sort((a, b) => b.event.at.localeCompare(a.event.at)));
const operationStock = computed(() => props.db.inventory.find(s => s.id === operation.value?.stockId));
const operationPC = computed(() => props.db.pcs.find(p => p.id === operation.value?.pcId));
const operationTemplate = computed(() => props.db.configurations.find(c => c.id === operationPC.value?.configurationId));
const plannedLines = computed(() => operationTemplate.value?.placements.filter(p => p.componentId === operationStock.value?.componentId) || []);
const stockChoices = computed(() => props.db.inventory.filter(s => stockCounts(s).available > 0));
const operationAllocation = computed(() => operationStock.value?.allocations.find(a => a.id === operation.value?.allocationId));
const operationLimit = computed(() => Math.min(32, operationAllocation.value?.quantity ?? (operationStock.value ? stockCounts(operationStock.value).available : 0)));
const isNewAllocation = computed(() => operation.value?.action === 'reserve' || operation.value?.action === 'install');
const showPlacement = computed(() => isNewAllocation.value || operation.value?.action === 'configure');
const operationTitles = { reserve: 'Reserve components', install: 'Record installation', 'install-reserved': 'Install reserved components', release: 'Release reservation', remove: 'Remove installed components', configure: 'Edit installed placement' };
const roleItems = [{ title: 'General component', value: 'general' }, { title: 'Boot drive', value: 'boot' }, { title: 'Data drive', value: 'data' }];
const mountItems = [{ title: 'Automatic / onboard', value: 'auto' }, { title: 'Internal bay', value: 'internal' }, { title: 'Front hot-swap bay', value: 'front-hot-swap' }, { title: 'Rear PCIe NVMe sled', value: 'rear-sled' }];

async function request(url: string, body: unknown, method = 'POST') {
  busy.value = true;
  try {
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Request failed');
    emit('reload'); return true;
  } catch (error) { emit('notify', String(error)); return false; }
  finally { busy.value = false; }
}
function editStock(stock?: StockRecord) {
  draft.value = stock ? structuredClone(JSON.parse(JSON.stringify(stock))) : {
    id: crypto.randomUUID(), componentId: '', tracking: 'serialized', serial: '', assetTag: '',
    quantity: 1, location: '', condition: 'Serviceable', notes: '', allocations: [], history: [],
  };
}
async function saveStock() {
  if (!draft.value) return;
  if (await request(`/api/inventory/${draft.value.id}`, draft.value, 'PUT')) {
    stockId.value = draft.value.id; draft.value = null; emit('notify', 'Stock record saved to CSV.');
  }
}
function openAllocation(stock?: StockRecord, targetPC = '', componentId = '') {
  const candidate = stock || stockChoices.value.find(s => s.componentId === componentId);
  operation.value = {
    action: 'reserve', stockId: candidate?.id || '', pcId: targetPC, allocationId: '', quantity: 1,
    plannedPlacementId: '', role: part(candidate?.componentId || '')?.category === 'Drive' ? 'data' : 'general',
    mount: 'auto', slotId: '', notes: '',
  };
}
function resetPlacement() {
  if (!operation.value) return;
  operation.value.plannedPlacementId = ''; operation.value.slotId = ''; operation.value.mount = 'auto';
  operation.value.role = part(operationStock.value?.componentId || '')?.category === 'Drive' ? 'data' : 'general';
  operation.value.quantity = 1;
}
function applyPlannedPlacement() {
  const p = plannedLines.value.find(p => p.id === operation.value?.plannedPlacementId);
  if (p && operation.value) { operation.value.slotId = p.slotId; operation.value.role = p.role; operation.value.mount = p.mount; }
}
function openOperation(stock: StockRecord, allocation: StockAllocation, action: 'install-reserved'|'release'|'remove'|'configure') {
  operation.value = { ...allocation, stockId: stock.id, allocationId: allocation.id, action, notes: action === 'configure' ? allocation.notes : '' };
}
async function performOperation() {
  const op = operation.value;
  if (!op) return;
  const body = isNewAllocation.value ? { action: op.action, pcId: op.pcId, quantity: op.quantity, plannedPlacementId: op.plannedPlacementId, slotId: op.slotId, role: op.role, mount: op.mount, notes: op.notes }
    : op.action === 'configure' ? { action: op.action, allocationId: op.allocationId, slotId: op.slotId, role: op.role, mount: op.mount, notes: op.notes }
    : { action: op.action, allocationId: op.allocationId, quantity: op.quantity, notes: op.notes };
  if (await request(`/api/inventory/${op.stockId}/action`, body)) { operation.value = null; emit('notify', 'Inventory movement recorded.'); }
}
async function adjustCount() {
  const a = adjustment.value;
  if (a && await request(`/api/inventory/${a.stockId}/adjust`, { quantity: a.quantity, notes: a.notes })) { adjustment.value = null; emit('notify', 'Count adjustment recorded.'); }
}
async function transferLot() {
  const t = transfer.value;
  if (t && await request(`/api/inventory/${t.stockId}/transfer`, { quantity:t.quantity,assetTag:t.assetTag,location:t.location,condition:t.condition,notes:t.notes })) {
    transfer.value = null; emit('notify', 'Bulk transfer recorded; both lots saved together.');
  }
}
function openPC(pc: InventoryPC) { pcId.value = pc.id; tab.value = 'parts'; }
function installedCount(id: string) { return pcAllocations(id, props.db).filter(r => r.allocation.state === 'installed').reduce((n, r) => n + r.allocation.quantity, 0); }
function date(at: string) { return new Date(at).toLocaleString(); }
</script>

<template>
  <template v-if="mode === 'stock' && !selectedStock">
    <div class="page-heading">
      <div><div class="eyebrow">FROM THE STOCKROOM TO THE SYSTEM</div><h1>Component inventory</h1><p>Individual serialized parts and bulk lots, with an accountable path into each PC.</p></div>
      <div class="heading-actions"><v-btn variant="outlined" :prepend-icon="mdiDownload" href="/api/export/inventory">Export CSV</v-btn><v-btn color="primary" :prepend-icon="mdiPlus" @click="editStock()">Receive stock</v-btn></div>
    </div>
    <div class="overview-grid inventory-stats">
      <div class="stat-card"><div>Stock records</div><strong>{{db.inventory.length}}</strong><small>Units and bulk lots</small></div>
      <div class="stat-card"><div>Available units</div><strong>{{totals.available}}</strong><small>Serviceable, unallocated stock</small></div>
      <div class="stat-card"><div>Reserved units</div><strong>{{totals.reserved}}</strong><small>Held for registered PCs</small></div>
      <div class="stat-card"><div>Installed units</div><strong>{{totals.installed}}</strong><small>Recorded in built systems</small></div>
    </div>
    <div class="catalog-toolbar"><v-text-field v-model="search" label="Search inventory" placeholder="Part, serial, lot or location" :prepend-inner-icon="mdiMagnify" hide-details /><v-select v-model="tracking" label="Tracking" :items="['All tracking','serialized','bulk']" hide-details /><v-select v-model="condition" label="Condition" :items="['All conditions','Serviceable','Quarantined','Retired']" hide-details /></div>
    <section class="panel table-panel"><v-table><thead><tr><th>COMPONENT / IDENTITY</th><th>TRACKING</th><th>STOCK LOCATION</th><th>TOTAL</th><th>AVAILABLE</th><th>RESERVED</th><th>INSTALLED</th><th>CONDITION</th></tr></thead><tbody>
      <tr v-for="stock in stocks" :key="stock.id"><td><button class="table-name" @click="stockId=stock.id">{{part(stock.componentId)?.name}}</button><small>{{stock.serial ? `Serial: ${stock.serial}` : `Lot: ${stock.assetTag || stock.id.slice(0,8)}`}}<template v-if="stock.serial && stock.assetTag"> · {{stock.assetTag}}</template></small></td><td><span class="category-tag">{{stock.tracking}}</span></td><td>{{stock.location || 'Not recorded'}}</td><td>{{stock.quantity}}</td><td>{{stockCounts(stock).available}}</td><td>{{stockCounts(stock).reserved}}</td><td>{{stockCounts(stock).installed}}</td><td><span :class="['inventory-condition', stock.condition.toLowerCase()]">{{stock.condition}}</span></td></tr>
    </tbody></v-table><div v-if="!stocks.length" class="empty-state"><v-icon :icon="mdiMemory" size="32" /><h3>No physical stock recorded</h3><p>Receive serialized units or a bulk lot. Catalog entries describe part types; they do not create stock.</p><v-btn color="primary" class="mt-5" @click="editStock()">Receive stock</v-btn></div></section>
    <div class="info-callout"><v-icon :icon="mdiInformationOutline" size="19" />Total includes reserved and installed units. Quarantined and retired records contribute no available stock. Each lot has one home stock location; installed units are located at their assigned PC.</div>
  </template>

  <template v-else-if="mode === 'stock' && selectedStock">
    <div class="detail-back"><button @click="stockId=''"><v-icon :icon="mdiArrowLeft" size="16" />All component inventory</button><span>Saved to inventory.csv</span></div>
    <div class="page-heading"><div><div class="eyebrow">{{selectedStock.tracking.toUpperCase()}} STOCK RECORD</div><h1>{{part(selectedStock.componentId)?.name}}</h1><p>{{selectedStock.serial ? `Serial: ${selectedStock.serial}` : `Lot: ${selectedStock.assetTag || selectedStock.id.slice(0,8)}`}} · {{selectedStock.condition}} · {{selectedStock.location || 'No stock location'}}</p></div><div class="heading-actions"><v-btn variant="outlined" @click="editStock(selectedStock)">Edit record</v-btn><v-btn v-if="selectedStock.tracking==='bulk'" variant="outlined" @click="adjustment={stockId:selectedStock.id,quantity:selectedStock.quantity,notes:''}">Adjust count</v-btn><v-btn v-if="selectedStock.tracking==='bulk'" variant="outlined" :disabled="selectedStock.condition==='Retired'||!stockCounts(selectedStock).unallocated" @click="transfer={stockId:selectedStock.id,quantity:1,assetTag:'',location:selectedStock.location,condition:selectedStock.condition,notes:''}">Split / move lot</v-btn><v-btn color="primary" :prepend-icon="mdiPlus" :disabled="!stockCounts(selectedStock).available" @click="openAllocation(selectedStock)">Allocate stock</v-btn></div></div>
    <div class="port-summary stock-counts"><div><strong>{{selectedStock.quantity}}</strong><span>Total units</span></div><div><strong>{{stockCounts(selectedStock).available}}</strong><span>Available</span></div><div><strong>{{stockCounts(selectedStock).reserved}}</strong><span>Reserved</span></div><div><strong>{{stockCounts(selectedStock).installed}}</strong><span>Installed</span></div></div>
    <v-tabs v-model="stockTab" color="primary" class="content-tabs"><v-tab value="allocations">Allocations</v-tab><v-tab value="history">Movement history</v-tab></v-tabs>
    <section v-if="stockTab==='allocations'" class="panel table-panel"><v-table><thead><tr><th>PC</th><th>STATE</th><th>QUANTITY</th><th>PLACEMENT</th><th>PHYSICAL LOCATION</th><th>ACTIONS</th></tr></thead><tbody><tr v-for="a in selectedStock.allocations" :key="a.id"><td>{{pcName(a.pcId)}}</td><td><span class="category-tag">{{a.state}}</span></td><td>{{a.quantity}}</td><td>{{a.role}} · {{a.mount}}<small>{{a.slotId || 'Auto slot / onboard'}}</small></td><td>{{a.state==='installed' ? db.pcs.find(p=>p.id===a.pcId)?.location || 'PC location not recorded' : selectedStock.location || 'Stock location not recorded'}}</td><td><div class="inventory-row-actions"><v-btn v-if="a.state==='reserved'" size="small" variant="text" color="primary" @click="openOperation(selectedStock,a,'install-reserved')">Install</v-btn><v-btn v-if="a.state==='installed'" size="small" variant="text" @click="openOperation(selectedStock,a,'configure')">Placement</v-btn><v-btn size="small" variant="text" color="error" @click="openOperation(selectedStock,a,a.state==='reserved'?'release':'remove')">{{a.state==='reserved'?'Release':'Remove'}}</v-btn></div></td></tr></tbody></v-table><div v-if="!selectedStock.allocations.length" class="empty-state"><h3>No active allocations</h3><p>This stock is not reserved for or installed in a PC.</p></div></section>
    <section v-else class="panel table-panel"><v-table><thead><tr><th>WHEN</th><th>ACTION</th><th>QUANTITY</th><th>PC</th><th>DETAILS / REASON</th></tr></thead><tbody><tr v-for="event in [...selectedStock.history].reverse()" :key="event.id"><td>{{date(event.at)}}</td><td>{{event.action}}</td><td>{{event.quantity}}</td><td>{{event.pcName || '—'}}</td><td class="movement-notes">{{event.notes || '—'}}</td></tr></tbody></v-table></section>
    <div class="bottom-note"><v-icon :icon="mdiInformationOutline" size="16" />{{selectedStock.notes || 'No stock notes recorded.'}} Stock records with movement history are retained; release/remove allocations before retiring a record.</div>
  </template>

  <template v-else-if="!selectedPC">
    <div class="page-heading"><div><div class="eyebrow">PLANNED, BUILT AND MAINTAINED</div><h1>PC inventory</h1><p>Track actual installed parts, reservations, build readiness and configuration drift.</p></div><v-btn color="primary" :prepend-icon="mdiPlus" @click="emit('editPc')">Register PC</v-btn></div>
    <v-text-field v-model="search" label="Search PCs" placeholder="Name, serial or location" :prepend-inner-icon="mdiMagnify" hide-details class="system-search" />
    <section class="panel table-panel"><v-table><thead><tr><th>PC / ASSET NAME</th><th>SERIAL / LOCATION</th><th>PLANNED CONFIGURATION</th><th>INSTALLED</th><th>DRIFT</th><th></th></tr></thead><tbody><tr v-for="pc in pcs" :key="pc.id"><td><button class="table-name" @click="openPC(pc)">{{pc.name}}</button></td><td>{{pc.serial || '—'}}<small>{{pc.location || 'No location'}}</small></td><td>{{db.configurations.find(c=>c.id===pc.configurationId)?.name || 'Unassigned'}}</td><td>{{installedCount(pc.id)}} parts</td><td><span class="category-tag">{{installedCount(pc.id) ? `${planDifferences(pc,db).length} differences` : 'No install records'}}</span></td><td><v-btn variant="text" size="small" @click="emit('editPc',pc)">Edit PC</v-btn></td></tr></tbody></v-table><div v-if="!pcs.length" class="empty-state"><h3>No PCs found</h3><p>Register a PC, link a planned configuration, then allocate physical stock.</p></div></section>
  </template>

  <template v-else>
    <div class="detail-back"><button @click="pcId=''"><v-icon :icon="mdiArrowLeft" size="16" />All PCs</button><span>Recorded installed hardware</span></div>
    <div class="page-heading"><div><div class="eyebrow">BUILT SYSTEM</div><h1>{{selectedPC.name}}</h1><p>{{selectedPC.serial || 'No serial'}} · {{selectedPC.location || 'No location'}} · Planned: {{template?.name || 'Unassigned'}}</p></div><div class="heading-actions"><v-btn variant="outlined" @click="emit('editPc',selectedPC)">Edit PC & settings</v-btn><v-btn color="primary" :prepend-icon="mdiPlus" :disabled="!stockChoices.length" @click="openAllocation(undefined,selectedPC.id)">Allocate from stock</v-btn></div></div>
    <div class="installed-summary panel"><div><strong>{{installedCount(selectedPC.id)}} installed parts</strong><span>{{allocations.filter(r=>r.allocation.state==='reserved').reduce((n,r)=>n+r.allocation.quantity,0)}} reserved · {{differences.length}} differences from plan</span></div><div><strong>{{selectedPC.buildSettings ? 'Recorded equipment & storage settings' : 'Build settings not yet recorded'}}</strong><span>{{selectedPC.buildSettings ? `${db.systems.find(s=>s.id===selectedPC?.buildSettings?.systemId)?.name || 'No equipment linked'} · ${selectedPC.buildSettings.storage.raid} data layout` : 'Use Edit PC & settings to capture or enter them.'}}</span></div></div>
    <v-tabs v-model="tab" color="primary" class="content-tabs"><v-tab value="parts">Parts & reservations</v-tab><v-tab value="readiness">Build readiness</v-tab><v-tab value="report">Installed compatibility</v-tab><v-tab value="history">History</v-tab></v-tabs>
    <section v-if="tab==='parts'" class="panel table-panel"><v-table><thead><tr><th>ACTUAL COMPONENT / STOCK</th><th>QTY</th><th>STATE</th><th>RECORDED PLACEMENT</th><th>ACTIONS</th></tr></thead><tbody><tr v-for="{stock,allocation:a} in allocations" :key="a.id"><td>{{part(stock.componentId)?.name}}<small>{{stock.serial ? `Serial: ${stock.serial}` : `Lot: ${stock.assetTag || stock.id.slice(0,8)}`}} · {{stock.condition}}</small></td><td>{{a.quantity}}</td><td><span class="category-tag">{{a.state}}</span></td><td>{{a.role}} · {{a.mount}}<small>{{a.slotId || 'Auto / onboard'}}</small></td><td><div class="inventory-row-actions"><v-btn v-if="a.state==='reserved'" variant="text" color="primary" size="small" @click="openOperation(stock,a,'install-reserved')">Install</v-btn><v-btn v-if="a.state==='installed'" variant="text" size="small" @click="openOperation(stock,a,'configure')">Placement</v-btn><v-btn variant="text" color="error" size="small" @click="openOperation(stock,a,a.state==='reserved'?'release':'remove')">{{a.state==='reserved'?'Release':'Remove'}}</v-btn></div></td></tr></tbody></v-table><div v-if="!allocations.length" class="empty-state"><h3>No physical parts allocated</h3><p>A linked configuration is a plan. Reserve or install stock to record this machine’s actual components.</p></div></section>
    <template v-if="tab==='readiness'">
      <section class="panel table-panel"><v-table><thead><tr><th>COMPONENT TYPE</th><th>PLAN QTY</th><th>INSTALLED</th><th>RESERVED</th><th>FREE STOCK</th><th>SHORTAGE</th><th></th></tr></thead><tbody><tr v-for="row in readiness" :key="row.componentId"><td>{{part(row.componentId)?.name}}<small v-if="row.blocked">{{row.blocked}} allocated units are not serviceable</small></td><td>{{row.required}}</td><td>{{row.installed}}</td><td>{{row.reserved}}</td><td>{{row.available}}</td><td :class="{'stock-shortage':row.shortage>0}">{{row.shortage}}</td><td><v-btn variant="text" color="primary" size="small" :disabled="!row.available" @click="openAllocation(undefined,selectedPC.id,row.componentId)">Allocate</v-btn></td></tr></tbody></v-table><div v-if="!readiness.length" class="empty-state"><h3>No build plan linked</h3><p>Choose a planned configuration in Edit PC & settings.</p></div></section>
      <section class="panel inventory-differences"><h3>Planned versus installed</h3><p class="form-hint">Reservations are not installed components. Slot, mount and drive role differences are tracked separately from type-level stock readiness.</p><div v-for="(difference,i) in differences" :key="i"><v-icon :icon="mdiAlertCircleOutline" size="17" />{{difference}}</div><div v-if="!differences.length"><v-icon :icon="mdiCheckCircleOutline" size="17" />Recorded hardware and build settings match the plan.</div></section>
    </template>
    <section v-if="tab==='report'" class="panel builder-section"><div class="section-head"><div><h2>Installed compatibility: {{installedReport?.status}}</h2><p>Uses recorded installations and PC-specific settings, not template components or reservations.</p></div></div><div v-for="(finding,i) in installedReport?.findings" :key="i" :class="['finding',finding.severity]"><v-icon :icon="finding.severity==='pass'?mdiCheckCircleOutline:mdiAlertCircleOutline" size="20" /><div><strong>{{finding.title}}</strong><p>{{finding.detail}}</p></div><span>{{finding.severity==='error'?'Conflict':finding.severity==='warning'?'Review':'Pass'}}</span></div></section>
    <section v-if="tab==='history'" class="panel table-panel"><v-table><thead><tr><th>WHEN</th><th>ACTION</th><th>COMPONENT / SERIAL OR LOT</th><th>QTY</th><th>DETAILS</th></tr></thead><tbody><tr v-for="{stock,event} in movements" :key="event.id"><td>{{date(event.at)}}</td><td>{{event.action}}</td><td>{{part(stock.componentId)?.name}}<small>{{stock.serial || stock.assetTag || stock.id.slice(0,8)}}</small></td><td>{{event.quantity}}</td><td class="movement-notes">{{event.notes}}</td></tr></tbody></v-table><div v-if="!movements.length" class="empty-state"><h3>No component movements yet</h3><p>Reservations, installations, removals and placement changes will appear here.</p></div></section>
    <div class="info-callout"><v-icon :icon="mdiInformationOutline" size="19" />Changing a planned configuration does not alter installed parts or captured settings. Record physical changes with Install, Remove and Placement. Retired/quarantined components are excluded from buildable stock.</div>
  </template>

  <v-dialog :model-value="!!draft" max-width="720" persistent><v-card v-if="draft" class="editor-dialog"><div class="dialog-head"><div><span class="eyebrow">PHYSICAL COMPONENT STOCK</span><h2>{{db.inventory.some(s=>s.id===draft?.id)?'Edit stock record':'Receive stock'}}</h2></div><v-btn :icon="mdiClose" variant="text" aria-label="Close stock editor" @click="draft=null" /></div><div class="dialog-body"><div class="form-grid"><v-select v-model="draft.componentId" label="Component type *" :items="db.components.map(c=>({title:c.name,value:c.id}))" :disabled="db.inventory.some(s=>s.id===draft?.id)" /><v-select v-model="draft.tracking" label="Tracking mode" :items="['serialized','bulk']" :disabled="db.inventory.some(s=>s.id===draft?.id)" @update:model-value="draft.serial='';draft.quantity=1" /><v-text-field v-if="draft.tracking==='serialized'" v-model="draft.serial" label="Serial number *" /><v-text-field v-model="draft.assetTag" :label="draft.tracking==='bulk'?'Lot / batch tag':'Asset tag (optional)'" /><v-text-field v-model.number="draft.quantity" label="Total units" type="number" min="0" :disabled="draft.tracking==='serialized'||db.inventory.some(s=>s.id===draft?.id)" /><v-text-field v-model="draft.location" label="Home stock location" /><v-select v-model="draft.condition" label="Condition" :items="['Serviceable','Quarantined','Retired']" /></div><v-textarea v-model="draft.notes" label="Receipt, supplier, condition or stock notes" rows="3" class="mt-5" /><div class="info-callout"><v-icon :icon="mdiInformationOutline" />A serialized unit has quantity 1 and a unique serial within its component type. Bulk quantities are individual units. Condition applies to the entire record; separate lots for different locations or conditions.</div></div><div class="dialog-footer"><v-btn variant="text" @click="draft=null">Cancel</v-btn><v-btn color="primary" :loading="busy" :disabled="!draft.componentId||(draft.tracking==='serialized'&&!draft.serial.trim())" @click="saveStock">Save stock</v-btn></div></v-card></v-dialog>

  <v-dialog :model-value="!!operation" max-width="730" persistent><v-card v-if="operation" class="editor-dialog"><div class="dialog-head"><h2>{{operationTitles[operation.action]}}</h2><v-btn :icon="mdiClose" variant="text" aria-label="Close inventory action" @click="operation=null" /></div><div class="dialog-body"><template v-if="isNewAllocation"><v-select v-model="operation.stockId" label="Physical stock *" :items="stockChoices.map(s=>({title:stockLabel(s),value:s.id}))" class="mb-5" @update:model-value="resetPlacement" /><div class="form-grid"><v-select v-model="operation.pcId" label="Target PC *" :items="db.pcs.map(p=>({title:p.name,value:p.id}))" @update:model-value="resetPlacement" /><v-select v-model="operation.action" label="Action" :items="[{title:'Reserve for build',value:'reserve'},{title:'Record as installed',value:'install'}]" /></div><v-select v-model="operation.plannedPlacementId" label="Planned BOM placement (optional)" :items="[{title:'Unplanned / manually placed',value:''},...plannedLines.map(p=>({title:`${p.quantity} × ${part(p.componentId)?.name} · ${p.role} · ${p.mount}`,value:p.id}))]" class="mt-5" @update:model-value="applyPlannedPlacement" /></template><template v-else><p class="inventory-action-context">{{part(operationStock?.componentId||'')?.name}} · {{operationStock?.serial || operationStock?.assetTag || 'Bulk lot'}}<br>{{pcName(operation.pcId)}}</p></template><v-text-field v-if="operation.action!=='configure'" v-model.number="operation.quantity" :label="`Units (maximum ${operationLimit})`" type="number" min="1" :max="operationLimit" :disabled="operationStock?.tracking==='serialized'" class="my-5" /><div v-if="showPlacement" class="form-grid"><v-select v-model="operation.role" label="Recorded role" :items="roleItems" /><v-select v-model="operation.mount" label="Mount / drive access" :items="mountItems" /><v-text-field v-model="operation.slotId" label="Reserved / installed slot ID (blank = auto)" /></div><v-textarea v-model="operation.notes" label="Movement or service notes" rows="2" class="mt-5" /><div class="info-callout"><v-icon :icon="mdiInformationOutline" />{{operation.action==='remove'?'Removed units return to this record’s home stock location. Change a serialized unit’s condition or split returned bulk units into a quarantined lot if they are faulty.':operation.action==='release'?'Released quantities become available again if the stock is serviceable.':operation.action==='reserve'?'Reservations reduce free stock but do not count as installed hardware.':'This records the physical state. Review installed compatibility and the planned-versus-installed report afterward.'}}</div></div><div class="dialog-footer"><v-btn variant="text" @click="operation=null">Cancel</v-btn><v-btn color="primary" :loading="busy" :disabled="!operation.stockId||!operation.pcId||(operation.action!=='configure'&&(!Number.isInteger(operation.quantity)||operation.quantity<1||operation.quantity>operationLimit))" @click="performOperation">{{operation.action==='reserve'?'Reserve stock':operation.action==='configure'?'Save placement':'Record movement'}}</v-btn></div></v-card></v-dialog>

  <v-dialog :model-value="!!transfer" max-width="650" persistent><v-card v-if="transfer" class="editor-dialog"><div class="dialog-head"><h2>Split or move bulk units</h2><v-btn :icon="mdiClose" variant="text" aria-label="Close bulk transfer" @click="transfer=null" /></div><div class="dialog-body"><p class="form-hint">Move unallocated units into a separate lot with its own location and condition. The source and new lot are saved together, with linked movement history.</p><div class="form-grid"><v-text-field v-model.number="transfer.quantity" label="Units to transfer" type="number" min="1" /><v-text-field v-model="transfer.assetTag" label="New lot / batch tag" /><v-text-field v-model="transfer.location" label="New stock location" /><v-select v-model="transfer.condition" label="New lot condition" :items="['Serviceable','Quarantined','Retired']" /></div><v-textarea v-model="transfer.notes" label="Transfer / condition change reason *" rows="3" class="mt-5" /></div><div class="dialog-footer"><v-btn variant="text" @click="transfer=null">Cancel</v-btn><v-btn color="primary" :loading="busy" :disabled="!transfer.notes.trim()||!Number.isInteger(transfer.quantity)||transfer.quantity<1" @click="transferLot">Record transfer</v-btn></div></v-card></v-dialog>
  <v-dialog :model-value="!!adjustment" max-width="500" persistent><v-card v-if="adjustment" class="editor-dialog"><div class="dialog-head"><h2>Adjust bulk count</h2><v-btn :icon="mdiClose" variant="text" aria-label="Close count adjustment" @click="adjustment=null" /></div><div class="dialog-body"><v-text-field v-model.number="adjustment.quantity" label="New total units (including allocations)" type="number" min="0" /><v-textarea v-model="adjustment.notes" label="Reason * (receipt, correction, damage or disposal)" rows="3" class="mt-5" /><p class="form-hint">Counts cannot fall below reserved plus installed units. The change and reason are retained in movement history.</p></div><div class="dialog-footer"><v-btn variant="text" @click="adjustment=null">Cancel</v-btn><v-btn color="primary" :loading="busy" :disabled="!adjustment.notes.trim()" @click="adjustCount">Record adjustment</v-btn></div></v-card></v-dialog>
</template>

<style scoped>
.inventory-condition{font-size:10px;padding:5px 7px;border-radius:5px;background:#f0f5e9;color:#668254;white-space:nowrap}
.inventory-condition.quarantined{background:#fcf4e5;color:#a58a55}.inventory-condition.retired{background:#eee;color:#8a8a8a}
.inventory-row-actions{display:flex;white-space:nowrap;gap:3px}.inventory-row-actions .v-btn{font-size:10px!important;padding:0 7px}
.stock-shortage{color:#a55d45;font-weight:600}.movement-notes{max-width:400px;white-space:normal;overflow-wrap:anywhere;font-size:10px;line-height:1.8;padding-top:12px!important;padding-bottom:12px!important}
.installed-summary{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:22px;margin-bottom:22px}.installed-summary strong{font-size:12px;font-weight:500;color:#597247;display:block}.installed-summary span{font-size:10px;color:#98a489;line-height:1.8;display:block;margin-top:7px}
.inventory-differences{padding:24px;margin-top:20px}.inventory-differences>div{font-size:11px;color:#8c987f;display:flex;gap:9px;margin-top:13px;line-height:1.8}.inventory-differences .v-icon{flex-shrink:0;margin-top:2px}.inventory-action-context{font-size:13px;line-height:1.8;color:#718961}
.stock-counts{background:#fff}.catalog-toolbar .v-input{min-width:170px}
@media(max-width:760px){.installed-summary{grid-template-columns:1fr}.page-heading .heading-actions{max-width:135px}.stock-counts strong{font-size:21px}.stock-counts span{font-size:9px}.content-tabs :deep(.v-tab){font-size:9px!important;padding:0 9px}}
</style>
