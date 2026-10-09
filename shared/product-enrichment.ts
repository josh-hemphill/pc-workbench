import type {Component} from './types';
import {catalogFields,fieldValue,isMissing,type EnrichmentProposal} from './catalog-quality';
function text(html:string){return html.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g,' ').trim();}
/** Extract conservative, category-applicable candidates. Nothing is written or marked verified. */
export function extractProductDetails(html:string,component:Component):EnrichmentProposal&{productName:string} {
 const attributes=new Map<string,string>(),identities=new Set<string>();let productName='';
 const put=(key:string,value:string)=>{if(value)attributes.set(key.trim().toLowerCase(),value);};
 function walk(value:unknown){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(walk);return;}const obj=value as Record<string,unknown>,type=obj['@type'];if(type==='Product'||Array.isArray(type)&&type.includes('Product')){if(typeof obj.name==='string'){productName=obj.name;identities.add(obj.name.trim().toLowerCase());}const brand=obj.brand;if(typeof brand==='string')put('manufacturer',brand);else if(brand&&typeof brand==='object'&&typeof (brand as {name:unknown}).name==='string')put('manufacturer',(brand as {name:string}).name);const additional=obj.additionalProperty;if(Array.isArray(additional))for(const a of additional)if(a&&typeof a==='object'&&typeof a.name==='string'&&['string','number','boolean'].includes(typeof a.value))put(a.name,String(a.value));}for(const [key,v] of Object.entries(obj))if(key!=='@type')walk(v);}
 for(const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi))try{walk(JSON.parse(m[1]));}catch{/* Continue to supported visible specifications. */}
 for(const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)){const cells=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)];if(cells.length===2)put(text(cells[0][1]),text(cells[1][1]));}
 for(const m of html.matchAll(/<h[234]\b[^>]*class=["'][^"']*group__title[^"']*["'][^>]*>([\s\S]*?)<\/h[234]>\s*<div\b[^>]*class=["'][^"']*group__content[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi))put(text(m[1]),text(m[2]));
 if(identities.size>1)throw Error('Multiple product identities found. Supply a saved page containing only the selected product.');
 const labels:Record<string,string[]>={manufacturer:['manufacturer'],socket:['socket / cpu','socket'],formFactor:['form factor'],memoryType:['memory type','type'],dimmSlots:['memory slots'],maxMemoryGb:['memory max'],capacityGb:['capacity'],powerW:['tdp','power consumption'],capacityW:['wattage'],sataPorts:['sata 6.0 gb/s','sata ports'],m2Slots:['m.2 slots'],sataPower:['sata connectors'],driveSize:['form factor'],driveInterface:['interface'],lengthMm:['length'],heightMm:['height'],maxCardLengthMm:['maximum video card length'],maxCoolerHeightMm:['maximum cpu cooler height'],supportedForms:['motherboard form factor'],supportsSockets:['cpu socket'],rearSlots:['expansion slots'],bays25:['internal 2.5" bays','2.5" bays'],bays35:['internal 3.5" bays','3.5" bays'],bays525:['external 5.25" bays','5.25" bays']};
 const patch:Record<string,unknown>={},evidence:Record<string,string>={};
 for(const f of catalogFields(component)){
  if(!isMissing(fieldValue(component,f.key)))continue;
  const label=(labels[f.key]||[]).find(l=>attributes.has(l));if(!label)continue;const raw=attributes.get(label)!;let value:unknown;
  if(f.key==='memoryType'){const m=raw.match(/\b(?:DDR[2-5]|LPDDR[3-5]X?)\b/i);if(m)value=m[0].toUpperCase();}
  else if(f.key==='driveSize'){if(/\bM\.2\b/i.test(raw))value='M.2';else {const m=raw.match(/^(2\.5|3\.5|5\.25)(?:["″]|\s*(?:inch|in))?$/i);if(m)value=m[1];}}
  else if(f.key==='driveInterface'){if(/^SATA(?:\s|$)/i.test(raw))value='SATA';else if(/\bNVMe\b/i.test(raw))value='NVMe';}
  else if(f.kind==='number'){
   const m=raw.match(/^(\d+(?:\.\d+)?)\s*(GB|TB|W|mm)?$/i);
   if(m){const unit=m[2]?.toLowerCase();if(f.key.endsWith('Gb')&&(unit==='gb'||unit==='tb'))value=Number(m[1])*(unit==='tb'?1000:1);else if(f.key.endsWith('Mm')&&unit==='mm'||f.key.endsWith('W')&&unit==='w'||!unit&&!f.key.endsWith('Mm')&&!f.key.endsWith('W')&&!f.key.endsWith('Gb'))value=Number(m[1]);}
  } else if(f.kind==='array'){const tokens=raw.split(/\s*(?:,|;|\n)\s*/).filter(Boolean);if(tokens.length&&tokens.every(t=>/^[\w .+/-]{1,60}$/.test(t)))value=tokens;}
  else if(f.kind==='text'&&raw.length<=200)value=raw;
  if(typeof value==='number'&&(f.key==='capacityGb'?value>10000000:!Number.isInteger(value)||value>10000))value=undefined;
  if(Array.isArray(value)&&value.length>20)value=undefined;
  if(value!==undefined){patch[f.key]=value;evidence[f.key]=`${label}: ${raw}`;}
 }
 return {patch,evidence,productName};
}
export function pcPartPickerURL(value:string):string {
 let url:URL;try{url=new URL(value);}catch{throw Error('Provide a PCPartPicker product URL.');}
 if(url.protocol!=='https:'||url.hostname!=='pcpartpicker.com'||url.port||url.username||url.password||!/^\/product\/[A-Za-z0-9]+(?:\/[^?#]*)?$/.test(url.pathname))throw Error('Only https://pcpartpicker.com/product/… URLs are supported.');
 url.hash='';url.search='';return url.href;
}
