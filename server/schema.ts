import { z } from 'zod';
import { categories } from '../shared/types';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), str=z.string().max(10000), count=z.number().int().min(0).max(10000), quantity=z.number().int().min(1).max(32);
const slot=z.object({id,bus:z.enum(['PCI','PCIe']),physical:z.number().int().min(1).max(16),lanes:z.number().int().min(1).max(16),generation:z.number().int().min(1).max(7),position:z.number().int().min(1).max(32)}).strict();
const specs=z.object({
 socket:str.optional(),formFactor:str.optional(),supportedForms:z.array(str).max(20).optional(),memoryType:str.optional(),dimmSlots:count.optional(),maxMemoryGb:count.optional(),capacityGb:z.number().min(0).max(10000000).optional(),
 slots:z.array(slot).max(32).refine(s=>new Set(s.map(x=>x.id)).size===s.length,'Slot IDs must be unique').refine(s=>new Set(s.map(x=>x.position)).size===s.length,'Slot positions must be unique').optional(),slotBus:z.enum(['PCI','PCIe']).optional(),slotWidth:z.number().int().min(1).max(16).optional(),requiredLanes:z.number().int().min(1).max(16).optional(),minGeneration:z.number().int().min(1).max(7).optional(),bracketWidth:z.number().int().min(1).max(8).optional(),
 lengthMm:count.optional(),heightMm:count.optional(),widthMm:count.optional(),maxCardLengthMm:count.optional(),maxCardHeightMm:count.optional(),maxCoolerHeightMm:count.optional(),rearSlots:count.optional(),bays25:count.optional(),bays35:count.optional(),hotSwapBays:count.optional(),sataPorts:count.optional(),m2Slots:count.optional(),m2Lengths:z.array(count).max(20).optional(),sataPower:count.optional(),
 usbA:count.optional(),usbC:count.optional(),ethernet:count.optional(),powerW:count.optional(),capacityW:count.optional(),driveInterface:z.enum(['SATA','NVMe']).optional(),driveSize:z.enum(['2.5','3.5','M.2']).optional(),m2Length:count.optional(),sledDrives:count.optional(),requiresBifurcation:z.boolean().optional(),bifurcation:z.boolean().optional(),sledHotSwap:z.boolean().optional(),supportsSockets:z.array(str).max(20).optional(),notes:str.optional()
}).strict();
export const schemas={
 components:z.object({id,name:z.string().min(1).max(200),category:z.enum(categories),manufacturer:str,specs,source:str,verified:z.boolean()}).strict(),
 systems:z.object({id,name:z.string().min(1).max(200),location:str,description:str,connections:z.array(z.object({id,name:z.string().min(1).max(200),usbA:count,usbC:count,ethernet:count,notes:str}).strict()).max(200)}).strict(),
 configurations:z.object({id,name:z.string().min(1).max(200),description:str,systemId:z.union([id,z.literal('')]),status:z.enum(['Draft','In review','Approved']),updatedAt:z.iso.datetime(),placements:z.array(z.object({id,componentId:id,quantity,slotId:str,role:z.enum(['boot','data','general']),mount:z.enum(['auto','internal','front-hot-swap','rear-sled']),group:str}).strict()).max(200).refine(p=>new Set(p.map(x=>x.id)).size===p.length,'Placement IDs must be unique'),storage:z.object({raid:z.enum(['none','mirror','raid5','raid6','raid10']),bootMirror:z.boolean()}).strict(),notes:str}).strict(),
 pcs:z.object({id,name:z.string().min(1).max(200),serial:str,location:str,configurationId:z.union([id,z.literal('')]),notes:str}).strict()
};
export type Collection=keyof typeof schemas;
