import type {Component} from './types.ts';
import {componentCapabilities} from './component-capabilities.ts';
export const sataConnectorKinds=['sataDataPorts','sataPowerConnectors','sataDataInputs','sataPowerInputs'] as const;
export type SataConnectorKind=typeof sataConnectorKinds[number];
export interface ConnectorEdit {kind:SataConnectorKind;minimum:number}
export const sataConnectorLabels:Record<SataConnectorKind,string>={sataDataPorts:'SATA data ports provided',sataPowerConnectors:'SATA power plugs provided',sataDataInputs:'SATA data inputs consumed',sataPowerInputs:'SATA power inputs consumed'};
const prefixes:Record<SataConnectorKind,string>={sataDataPorts:'SATA_DATA',sataPowerConnectors:'SATA_POWER',sataDataInputs:'SATA_DATA_IN',sataPowerInputs:'SATA_POWER_IN'};
const countKeys={sataDataPorts:'sataPorts',sataPowerConnectors:'sataPower',sataPowerInputs:'sataPowerPlugs'} as const;
export function connectorKinds(component:Component):SataConnectorKind[]{
 const cap=componentCapabilities(component),spec=component.specs,result:SataConnectorKind[]=[];
 if(cap.sataController)result.push('sataDataPorts');
 if(component.category==='PSU')result.push('sataPowerConnectors');
 if(cap.sataDataConsumer||spec.sataDataInputs!==undefined)result.push('sataDataInputs');
 if(cap.adapter==='bay-cage'||component.category==='Bay accessory'||component.category==='Drive'&&spec.driveSize!=='M.2'&&spec.driveInterface!=='SATA'||spec.sataPowerInputs!==undefined||spec.sataPowerPlugs!==undefined)result.push('sataPowerInputs');
 return result;
}
export function ensureConnectors(component:Component,edit:ConnectorEdit):Component{
 if(!connectorKinds(component).includes(edit.kind))throw Error(`${component.name}: ${sataConnectorLabels[edit.kind]} is not applicable.`);
 if(!Number.isInteger(edit.minimum)||edit.minimum<1||edit.minimum>1000)throw Error('Enter a whole minimum connector count from 1 to 1,000.');
 const {kind,minimum}=edit,spec=component.specs,countKey=kind in countKeys?countKeys[kind as keyof typeof countKeys]:undefined;
 const existing=spec[kind],legacy=existing===undefined&&countKey?spec[countKey]:undefined;
 const total=Math.max(minimum,existing?.length??legacy??0);
 if(total>1000)throw Error(`${component.name}: the existing count exceeds the 1,000 named connector limit.`);
 if(existing&&existing.length>=minimum)return component;
 const list=[...(existing||[])],used=new Set(list.map(port=>port.id));let sequence=1;
 while(list.length<total){const id=`${prefixes[kind]}_${sequence++}`;if(used.has(id))continue;list.push({id});used.add(id);}
 return {...component,verified:false,specs:{...spec,[kind]:list,...(countKey?{[countKey]:list.length}:{})}};
}
export function describeConnectors(component:Component,kind:SataConnectorKind){
 const list=component.specs[kind],countKey=kind in countKeys?countKeys[kind as keyof typeof countKeys]:undefined;
 return `${sataConnectorLabels[kind]}: ${list!==undefined?`${list.length} named (${list.map(port=>port.id).join(', ')||'none'})`:countKey&&component.specs[countKey]!==undefined?`${component.specs[countKey]} count only`:'unknown'}`;
}
