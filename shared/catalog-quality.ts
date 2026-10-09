import type {Component,Database} from './types';
import {catalogSuggestions,normalizeCatalogValue,normalizeCatalogValues} from './catalog-options';
import {componentCapabilities} from './component-capabilities';
export interface CatalogField { key:string;label:string;kind:'text'|'number'|'array'|'boolean'; choices?:string[] }
const field=(key:string,label:string,kind:CatalogField['kind']='number',choices?:string[]):CatalogField=>({key,label,kind,choices});
export function catalogFields(c:Component):CatalogField[] {
 const cap=componentCapabilities(c),fields=[field('manufacturer','Manufacturer','text'),field('source','Source URL','text')];
 const add=(...items:CatalogField[])=>fields.push(...items);
 switch(c.category){
 case 'CPU':add(field('socket','Socket','text'),field('powerW','Power (W)'));break;
 case 'Motherboard':add(field('socket','Socket','text'),field('formFactor','Form factor','text'),field('memoryType','Memory type','text'),field('dimmSlots','DIMM slots'),field('maxMemoryGb','Maximum RAM (GB)'),field('sataPorts','SATA data ports'),field('m2Slots','M.2 slots'),field('usbA','USB-A ports'),field('usbC','USB-C ports'),field('ethernet','Ethernet ports'));break;
 case 'Memory':add(field('memoryType','Memory type','text'),field('capacityGb','Capacity (GB)'),field('powerW','Power (W)'));break;
 case 'Chassis':add(field('supportedForms','Supported motherboard forms','array'),field('rearSlots','Rear expansion positions'),field('maxCardLengthMm','Maximum card length (mm)'),field('maxCoolerHeightMm','Maximum cooler height (mm)'),field('bays25','2.5-inch bays'),field('bays35','3.5-inch bays'),field('bays525','5.25-inch bays'));break;
 case 'Drive':add(field('driveSize','Drive size','text',['2.5','3.5','5.25','M.2']),field('driveInterface','Drive interface','text',['SATA','NVMe']));if(!cap.optical)add(field('capacityGb','Capacity (GB)'));if(cap.m2)add(field('m2Length','M.2 length (mm)'));break;
 case 'PSU':add(field('capacityW','Supply capacity (W)'),field('sataPower','SATA power connectors'));break;
 case 'Cooler':add(field('supportsSockets','Supported sockets','array'),field('heightMm','Height (mm)'));break;
 }
 if(cap.slotCard)add(field('slotBus','Slot bus','text',['PCI','PCIe']),field('slotWidth','Physical slot width'),field('requiredLanes','Required lanes'),field('bracketWidth','Rear bracket positions'),field('lengthMm','Length (mm)'),field('heightMm','Height (mm)'),field('powerW','Power (W)'));
 if(cap.slotCard&&cap.pcie)add(field('minGeneration','Minimum PCIe generation'));
 if(cap.pci)add(field('pciVoltage','PCI voltage','text',['3.3V','5V','universal']),field('pciBits','PCI width (bits)'));
 if(cap.bayConsumer)add(field('baySize','Consumed bay size','text',['2.5','3.5','5.25']),field('bayUnits','Consumed bay units'));
 if(cap.nvmeSled)add(field('sledDrives','Sled drive count'),field('requiresBifurcation','Requires bifurcation','boolean'));
 if(c.category==='Storage adapter'&&cap.sataController)add(field('sataPorts','SATA data ports'));
 return fields;
}
export function fieldValue(c:Component,key:string):unknown{if(key==='manufacturer'||key==='source')return c[key];if(key==='sataPorts'&&c.specs.sataDataPorts!==undefined)return c.specs.sataDataPorts.filter(p=>!p.disabled).length;if(key==='sataPower'&&c.specs.sataPowerConnectors!==undefined)return c.specs.sataPowerConnectors.length;return (c.specs as Record<string,unknown>)[key];}
export function isMissing(value:unknown){return value===undefined||value===null||typeof value==='string'&&!value.trim()||Array.isArray(value)&&!value.length;}
export function missingFields(c:Component){return catalogFields(c).filter(f=>isMissing(fieldValue(c,f.key)));}
export function patchMissing(c:Component,patch:Record<string,unknown>,db:Pick<Database,'components'>={components:[c]}):Component {
 const result:Component={...c,specs:{...c.specs}},allowed=new Map(catalogFields(c).map(f=>[f.key,f]));let changed=false;
 for(const [key,raw] of Object.entries(patch)){
  let value=raw;
  const f=allowed.get(key);if(!f)throw Error(`Field ${key} is not applicable to ${c.category}.`);
  if(isMissing(value))throw Error(`Provide a value for ${f.label}.`);
  if(!isMissing(fieldValue(c,key)))continue;
  if(f.kind==='number'&&(typeof value!=='number'||!Number.isFinite(value)||value<0)||f.kind==='text'&&typeof value!=='string'||f.kind==='array'&&(!Array.isArray(value)||value.some(v=>typeof v!=='string'))||f.kind==='boolean'&&typeof value!=='boolean')throw Error(`Invalid value for ${f.label}.`);
  if(f.kind==='array')value=normalizeCatalogValues(value,catalogSuggestions(db,key));else if(f.kind==='text'&&key!=='source')value=normalizeCatalogValue(value,catalogSuggestions(db,key));
  if(isMissing(value))throw Error(`Provide a value for ${f.label}.`);
  if(f.choices&&!f.choices.includes(String(value)))throw Error(`Unsupported ${f.label}.`);
  if(key==='manufacturer'||key==='source')result[key]=String(value).trim();else (result.specs as Record<string,unknown>)[key]=value;
  changed=true;
 }
 if(changed)result.verified=false;
 return result;
}
export interface EnrichmentProposal { patch:Record<string,unknown>;evidence:Record<string,string> }
export interface EnrichmentJob {id:string;componentId:string;name:string;category:Component['category'];url:string;state:'queued'|'fetching'|'review'|'failed'|'applied'|'cancelled';createdAt:string;updatedAt:string;message:string;proposalId?:string;proposal?:EnrichmentProposal}
