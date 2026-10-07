export type Category = 'Chassis'|'Motherboard'|'CPU'|'Memory'|'GPU'|'Scientific card'|'Network card'|'Storage adapter'|'Drive'|'PSU'|'Cooler';
export const categories: Category[] = ['Chassis','Motherboard','CPU','Memory','GPU','Scientific card','Network card','Storage adapter','Drive','PSU','Cooler'];
export type Bus = 'PCI'|'PCIe';
export type PciVoltage = '3.3V'|'5V'|'universal';
export type PortKind = 'USB-A'|'USB-C'|'Ethernet';
export interface Port { id: string; kind: PortKind; protocol?: string; speedMbps?: number; powerW?: number; isolated?: boolean }
export interface PortRequirement { id: string; kind: PortKind; quantity: number; protocol?: string; minSpeedMbps?: number; minPowerW?: number; isolated?: boolean }
export interface PortMapping { connectionId: string; requirementId: string; placementId: string; instance: number; portId: string }
export interface SoftwareSettings { os?: string; image?: string; equipmentSoftware?: string; equipmentConfiguration?: string; bios?: string; drivers?: Record<string,string>; firmware?: Record<string,string> }
export interface Slot { id: string; bus: Bus; physical: number; lanes: number; generation: number; position: number; bifurcationModes?: string[]; pciVoltage?: PciVoltage; pciBits?: 32|64 }
export interface DriveTarget { id: string; mount: Placement['mount']; driveSizes?: string[]; interfaces?: string[]; m2Lengths?: number[]; hotSwap?: boolean; bootable?: boolean }
export interface LaneRule { id: string; slots: string[]; maxLanes?: number; exclusive?: boolean; disableM2Slots?: number; disableSataPorts?: number }
export interface Specs {
  ports?: Port[]; driveTargets?: DriveTarget[]; laneRules?: LaneRule[]; pciVoltage?: PciVoltage; pciBits?: 32|64; bifurcationMode?: string; supportedOS?: string[]; requiredDriver?: string; requiredFirmware?: string; bootable?: boolean; hotPlug?: boolean;
  socket?: string; formFactor?: string; supportedForms?: string[]; memoryType?: string; dimmSlots?: number; maxMemoryGb?: number; capacityGb?: number;
  slots?: Slot[]; slotBus?: Bus; slotWidth?: number; requiredLanes?: number; minGeneration?: number; bracketWidth?: number;
  lengthMm?: number; heightMm?: number; widthMm?: number; maxCardLengthMm?: number; maxCardHeightMm?: number; maxCoolerHeightMm?: number; rearSlots?: number;
  bays25?: number; bays35?: number; hotSwapBays?: number; sataPorts?: number; m2Slots?: number; m2Lengths?: number[]; sataPower?: number;
  usbA?: number; usbC?: number; ethernet?: number; powerW?: number; capacityW?: number; driveInterface?: 'SATA'|'NVMe'; driveSize?: '2.5'|'3.5'|'M.2'; m2Length?: number;
  sledDrives?: number; requiresBifurcation?: boolean; bifurcation?: boolean; sledHotSwap?: boolean; supportsSockets?: string[]; notes?: string;
}
export interface Component { id: string; name: string; category: Category; manufacturer: string; specs: Specs; source: string; verified: boolean }
export interface Connection { id: string; name: string; usbA: number; usbC: number; ethernet: number; notes: string; requirements?: PortRequirement[] }
export interface System { id: string; name: string; location: string; description: string; connections: Connection[] }
export interface Placement { id: string; componentId: string; quantity: number; slotId: string; role: 'boot'|'data'|'general'; mount: 'auto'|'internal'|'front-hot-swap'|'rear-sled'; group: string; targetId?: string; adapterPlacementId?: string; controllerPlacementId?: string }
export type Raid = 'none'|'mirror'|'raid5'|'raid6'|'raid10';
export interface StorageGroup { id: string; name: string; raid: Raid; controllerPlacementId?: string; notes?: string }
export interface StoragePlan { raid: Raid; bootMirror: boolean; groups?: StorageGroup[] }
export interface Configuration { approvalHistory?: {revision:number;at:string;configuration:Pick<Configuration,'id'|'name'|'description'|'systemId'|'status'|'updatedAt'|'placements'|'storage'|'notes'|'software'|'portMappings'>;components:Component[];system:System|null}[]; revision?: number; approvalSnapshot?: {at:string;components:Component[];system:System|null}; id: string; name: string; description: string; systemId: string; status: 'Draft'|'In review'|'Approved'; updatedAt: string; placements: Placement[]; storage: StoragePlan; notes: string; software?: SoftwareSettings; portMappings?: PortMapping[] }
export interface PCBuildSettings { systemId: string; storage: StoragePlan; notes: string; software?: SoftwareSettings; portMappings?: PortMapping[] }
export interface InstalledStockIdentity { stockId:string;componentId:string;serial:string;assetTag:string;allocationId:string;quantity:number;role:Placement['role'];mount:Placement['mount'];slotId:string;group?:string;targetId?:string }
export interface CommissionedSnapshot { at:string;configuration:Configuration;components:Component[];system:System|null;installedStock?:InstalledStockIdentity[] }
export interface InventoryPC { id: string; name: string; serial: string; location: string; configurationId: string; notes: string; buildSettings: PCBuildSettings | null; lifecycle?: 'Planning'|'Building'|'Commissioned'|'In service'|'Maintenance'|'Retired'; software?: SoftwareSettings; commissioning?: {at:string;by:string;checks:string[];notes:string}; timeline?: {id:string;at:string;kind:string;summary:string;actor:string}[]; snapshots?: CommissionedSnapshot[]; snapshot?: CommissionedSnapshot }
export interface StockAllocation {
  id: string; pcId: string; quantity: number; state: 'reserved'|'installed';
  plannedPlacementId: string; slotId: string; role: Placement['role']; mount: Placement['mount'];
  group?: string; targetId?: string; adapterPlacementId?: string; controllerPlacementId?: string; owner?: string; workOrder?: string; dueAt?: string; expiresAt?: string;
  notes: string; createdAt: string; updatedAt: string;
}
export interface StockEvent {
  id: string; at: string; action: 'receive'|'adjust'|'edit'|'reserve'|'install'|'release'|'remove'|'configure'|'transfer-in'|'transfer-out';
  quantity: number; pcId: string; pcName: string; allocationId: string; sourceAllocationId?: string; targetStockId?: string; sourceStockId?: string; actor?: string; notes: string;
}
export interface StockRecord {
  id: string; componentId: string; tracking: 'serialized'|'bulk'; serial: string; assetTag: string;
  quantity: number; location: string; condition: 'Serviceable'|'Quarantined'|'Repair'|'Retired'; notes: string;
  supplier?: string; purchaseOrder?: string; repairReference?: string; supplierReturnReference?: string; reorderLevel?: number;
  allocations: StockAllocation[]; history: StockEvent[];
}
export interface Database { components: Component[]; systems: System[]; configurations: Configuration[]; pcs: InventoryPC[]; inventory: StockRecord[] }
export interface Finding { severity: 'error'|'warning'|'pass'; title: string; detail: string }
export interface Resource { name: string; used: number; available: number; unit?: string }
export interface Report { findings: Finding[]; resources: Resource[]; status: 'Compatible'|'Needs review'|'Conflicts'; usableDataGb: number; bootGb: number; slotAssignments: Record<string,string>; storageGroups?: {id:string;name:string;raid:Raid;driveCount:number;usableGb:number}[] }
