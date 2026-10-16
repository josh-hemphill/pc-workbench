import type {Component} from './types.ts';
export interface ComponentMergeInput {sourceIds:string[];targetId:string;notes:string}
export interface ComponentMergePreview {token:string;target:Component;sources:(Component&{differentSpecs:string[]})[];configurations:{id:string;name:string}[];inventory:{id:string;identity:string;quantity:number}[];pcs:{id:string;name:string}[];transitionPlans:number;warnings:string[]}
