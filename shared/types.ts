export type Category = 'Chassis'|'Motherboard'|'CPU'|'Memory'|'GPU'|'Scientific card'|'Network card'|'Storage adapter'|'Drive'|'PSU'|'Cooler';
export const categories: Category[] = ['Chassis','Motherboard','CPU','Memory','GPU','Scientific card','Network card','Storage adapter','Drive','PSU','Cooler'];
export type Bus = 'PCI'|'PCIe';
export interface Slot { id: string; bus: Bus; physical: number; lanes: number; generation: number; position: number }
export interface Specs {
  socket?: string; formFactor?: string; supportedForms?: string[]; memoryType?: string; dimmSlots?: number; maxMemoryGb?: number; capacityGb?: number;
  slots?: Slot[]; slotBus?: Bus; slotWidth?: number; requiredLanes?: number; minGeneration?: number; bracketWidth?: number;
  lengthMm?: number; heightMm?: number; widthMm?: number; maxCardLengthMm?: number; maxCardHeightMm?: number; maxCoolerHeightMm?: number; rearSlots?: number;
  bays25?: number; bays35?: number; hotSwapBays?: number; sataPorts?: number; m2Slots?: number; m2Lengths?: number[]; sataPower?: number;
  usbA?: number; usbC?: number; ethernet?: number; powerW?: number; capacityW?: number; driveInterface?: 'SATA'|'NVMe'; driveSize?: '2.5'|'3.5'|'M.2'; m2Length?: number;
  sledDrives?: number; requiresBifurcation?: boolean; bifurcation?: boolean; sledHotSwap?: boolean; supportsSockets?: string[]; notes?: string;
}
export interface Component { id: string; name: string; category: Category; manufacturer: string; specs: Specs; source: string; verified: boolean }
export interface Connection { id: string; name: string; usbA: number; usbC: number; ethernet: number; notes: string }
export interface System { id: string; name: string; location: string; description: string; connections: Connection[] }
export interface Placement { id: string; componentId: string; quantity: number; slotId: string; role: 'boot'|'data'|'general'; mount: 'auto'|'internal'|'front-hot-swap'|'rear-sled'; group: string }
export interface StoragePlan { raid: 'none'|'mirror'|'raid5'|'raid6'|'raid10'; bootMirror: boolean }
export interface Configuration { id: string; name: string; description: string; systemId: string; status: 'Draft'|'In review'|'Approved'; updatedAt: string; placements: Placement[]; storage: StoragePlan; notes: string }
export interface PCBuildSettings { systemId: string; storage: StoragePlan; notes: string }
export interface InventoryPC { id: string; name: string; serial: string; location: string; configurationId: string; notes: string; buildSettings: PCBuildSettings | null }
export interface StockAllocation {
  id: string; pcId: string; quantity: number; state: 'reserved'|'installed';
  plannedPlacementId: string; slotId: string; role: Placement['role']; mount: Placement['mount'];
  notes: string; createdAt: string; updatedAt: string;
}
export interface StockEvent {
  id: string; at: string; action: 'receive'|'adjust'|'edit'|'reserve'|'install'|'release'|'remove'|'configure'|'transfer-in'|'transfer-out';
  quantity: number; pcId: string; pcName: string; allocationId: string; notes: string;
}
export interface StockRecord {
  id: string; componentId: string; tracking: 'serialized'|'bulk'; serial: string; assetTag: string;
  quantity: number; location: string; condition: 'Serviceable'|'Quarantined'|'Retired'; notes: string;
  allocations: StockAllocation[]; history: StockEvent[];
}
export interface Database { components: Component[]; systems: System[]; configurations: Configuration[]; pcs: InventoryPC[]; inventory: StockRecord[] }
export interface Finding { severity: 'error'|'warning'|'pass'; title: string; detail: string }
export interface Resource { name: string; used: number; available: number; unit?: string }
export interface Report { findings: Finding[]; resources: Resource[]; status: 'Compatible'|'Needs review'|'Conflicts'; usableDataGb: number; bootGb: number; slotAssignments: Record<string,string> }
