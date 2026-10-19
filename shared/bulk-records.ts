import type {ConnectorEdit} from './bulk-connectors.ts';
import type {LocationKind} from './types.ts';
export interface NotesEdit {mode:'replace'|'append';value:string}
export interface LocationPatch {kind?:LocationKind;parentId?:string;targetConfigurationId?:string;requirements?:{setId:string;revision:number};notes?:NotesEdit}
export interface PCPatch {installationLocationId?:string;lifecycle?:'Planning'|'Building'|'Maintenance'|'Parts only'|'Retired';notes?:NotesEdit}
export interface CatalogPatch {connectors?:ConnectorEdit;manufacturer?:string;source?:string;verified?:boolean}
export interface StockPatch {location?:string;condition?:'Serviceable'|'Quarantined'|'Repair'|'Retired';supplier?:string;reorderLevel?:number;notes?:NotesEdit}
export interface RequirementsPatch {description?:string}
export interface ConfigurationPatch {description?:string;notes?:NotesEdit}
export type BulkRequest=
 |{collection:'components';action:'edit';ids:string[];patch:CatalogPatch}
 |{collection:'inventory';action:'edit';ids:string[];patch:StockPatch}
 |{collection:'requirementsSets';action:'edit';ids:string[];patch:RequirementsPatch}
 |{collection:'configurations';action:'edit';ids:string[];patch:ConfigurationPatch}
 |{collection:'installationLocations';action:'edit';ids:string[];patch:LocationPatch}
 |{collection:'pcs';action:'edit';ids:string[];patch:PCPatch}
 |{collection:'installationLocations'|'pcs'|'components'|'requirementsSets'|'configurations';action:'delete';ids:string[]};
export interface BulkPreviewRow {id:string;name:string;before:string;after:string}
export interface BulkPreview {valid:boolean;error?:string;revision:string;token:string;rows:BulkPreviewRow[];affectedPCs:number;pathChanges:number;historicalPCs:number}
