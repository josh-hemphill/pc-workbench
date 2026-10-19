import type {Component} from './types.ts';
export const researchFormat='pc-workbench-component-research';
export const researchPackLimit=1000;
export interface ResearchProposal {path:string;value?:unknown;sourceUrl:string;evidence:string}
export interface ResearchComponent {id:string;name:string;model?:string;category:Component['category'];existing?:unknown;missingFields?:unknown;proposals:ResearchProposal[]}
export interface ResearchFile {format:typeof researchFormat;version:1;exportedAt?:string;workspaceRevision?:string;instructions?:unknown;components:ResearchComponent[]}
export interface ResearchRow {key:string;componentId:string;name:string;field:string;path:string;before?:unknown;after?:unknown;changes?:Record<string,unknown>[];sourceUrl:string;evidence:string;status:'Fill'|'Unchanged'|'Conflict'|'Invalid';reason:string}
export interface ResearchPreview {valid:boolean;error?:string;revision:string;token:string;rows:ResearchRow[];selected:string[];components:number;fields:number;blank:number}
