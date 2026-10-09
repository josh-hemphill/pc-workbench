import type {LocationKind} from './types';
export interface NotesEdit {mode:'replace'|'append';value:string}
export interface LocationPatch {kind?:LocationKind;parentId?:string;targetConfigurationId?:string;requirements?:{setId:string;revision:number};notes?:NotesEdit}
export interface PCPatch {installationLocationId?:string;lifecycle?:'Planning'|'Building'|'Maintenance'|'Parts only'|'Retired';notes?:NotesEdit}
export type BulkRequest=
 |{collection:'installationLocations';action:'edit';ids:string[];patch:LocationPatch}
 |{collection:'pcs';action:'edit';ids:string[];patch:PCPatch}
 |{collection:'installationLocations'|'pcs';action:'delete';ids:string[]};
export interface BulkPreviewRow {id:string;name:string;before:string;after:string}
export interface BulkPreview {valid:boolean;error?:string;revision:string;token:string;rows:BulkPreviewRow[];affectedPCs:number;pathChanges:number;historicalPCs:number}
