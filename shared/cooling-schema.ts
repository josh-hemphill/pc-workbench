import {z} from 'zod';
import {coolingControls,coolingPowerConnectors} from './types.ts';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),text=z.string().max(200),rating=z.number().finite().min(0).max(1000);
const connector=z.enum(['Fan 3-pin','Fan 4-pin','Proprietary']);
const unique=<T extends {id:string}>(rows:T[])=>new Set(rows.map(row=>row.id)).size===rows.length;
export const coolingSpecsSchema={
 coolingDevices:z.array(z.object({id,name:text.optional(),kind:z.enum(['fan','pump']),count:z.number().int().min(1).max(32).optional(),powerConnector:z.enum(coolingPowerConnectors).optional(),voltageV:rating.optional(),currentA:rating.optional(),control:z.enum(coolingControls).optional(),controlConnector:connector.optional(),tachometer:z.boolean().optional()}).strict()).max(32).refine(unique,'Cooling device IDs must be unique').optional(),
 coolingHeaders:z.array(z.object({id,name:text.optional(),connector:connector.optional(),voltageV:rating.optional(),maxCurrentA:rating.optional(),controlModes:z.array(z.enum(coolingControls)).max(3).refine(rows=>new Set(rows).size===rows.length,'Control modes must be unique').optional(),maxDevices:z.number().int().min(1).max(32).optional(),tachometer:z.boolean().optional(),limitGroup:id.optional()}).strict().refine(h=>h.connector!=='Fan 3-pin'||!h.controlModes?.includes('PWM'),'A standard 3-pin header cannot provide 4-pin PWM control')).max(64).refine(unique,'Cooling header IDs must be unique').optional(),
 coolingHeaderGroups:z.array(z.object({id,maxCurrentA:rating.optional()}).strict()).max(32).refine(unique,'Header group IDs must be unique').optional(),
};
export const coolingConnectionSchema=z.array(z.object({deviceId:id,deviceIndex:z.number().int().min(1).max(1024),headerPlacementId:z.string().max(200),headerId:id}).strict()).max(1024);
