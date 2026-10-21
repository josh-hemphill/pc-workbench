import type {Component} from './types.ts';
export interface IdentificationInput {
 sourceId:string; targetId?:string; newComponent?:Component; evidence:string; actor:string;
 stock:{stockId:string;availableQuantity:number;allocationIds:string[]}[];
 configurations:{configurationId:string;placementIds:string[];pcIds:string[];updateTemplate:boolean}[];
}
export interface IdentificationPreview {token:string;source:string;target:string;quantity:number;remainingQuantity:number;allocations:number;configurations:number;pcs:string[];warnings:string[]}
