import {z} from 'zod';
export const inspectionCategories=['Chassis','Motherboard','CPU','Memory','Drive','GPU','Scientific card','Network card','Storage adapter','Bay accessory','PSU','Cooler','Fan','Cable','Consumable'] as const;
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),text=z.string().max(10000);
export const coverageStates=['unchecked','recorded','unidentified','absent','inaccessible'] as const;
export const coverageSchema=z.array(z.object({category:z.enum(inspectionCategories),status:z.enum(coverageStates),notes:text}).strict()).max(15).refine(rows=>new Set(rows.map(r=>r.category)).size===rows.length,'Use each category once.');
export const locationHistorySchema=z.array(z.object({id,at:z.iso.datetime(),fromId:z.string(),fromPath:text,toId:z.string(),toPath:text,actor:text}).strict()).max(100000);
export const inspectionRecordSchema=z.object({id,sessionId:id,fingerprint:z.string(),observedAt:z.iso.datetime(),recordedAt:z.iso.datetime(),actor:z.string().min(1).max(200),method:z.enum(['exterior','os-report','opened-case','test-bench','historical']),evidence:text,locationId:z.string(),locationPath:text,reportedLocation:text,finished:z.boolean(),coverage:coverageSchema,discoveries:z.array(z.object({stockId:id,allocationId:id,componentId:id,name:text,quantity:z.number().int().positive(),notes:text}).strict()).max(100)}).strict();
export type InspectionRecord=z.infer<typeof inspectionRecordSchema>;
export type LocationHistory=z.infer<typeof locationHistorySchema>;
export function locationMatches(pc:{installationLocationId?:string;locationHistory?:LocationHistory},ids:Set<string>,mode:string){const current=!!pc.installationLocationId&&ids.has(pc.installationLocationId);const former=pc.locationHistory?.some(move=>!!move.fromId&&ids.has(move.fromId))||false;return mode==='former'?former:mode==='either'?current||former:current;}
