import type {CoolingHeader,Slot} from './types.ts';
import {nextComponentId} from './component-editor.ts';
/** Append a layout without replacing headers or their stable wiring references. */
export function addFanLayout(headers:CoolingHeader[],systemCount:number,connector:'Fan 3-pin'|'Fan 4-pin',includeCpu:boolean){
 if(!Number.isInteger(systemCount)||systemCount<0||systemCount>63)throw Error('Choose 0 to 63 system headers.');
 const cpuMissing=includeCpu&&!headers.some(h=>[h.name,h.id].some(value=>/^CPU[_ -]?FAN(?:[_ -]?\d+)?$/i.test(value||'')));
 if(headers.length+systemCount+Number(cpuMissing)>64)throw Error('A component supports at most 64 headers.');
 const added:CoolingHeader[]=[];
 const add=(prefix:string)=>{const id=nextComponentId(prefix,[...headers,...added]);added.push({id,name:prefix==='CPU_FAN'?'CPU_FAN':id,connector});};
 if(cpuMissing)add('CPU_FAN');for(let i=0;i<systemCount;i++)add('SYS_FAN');
 headers.push(...added);return added;
}
export const slotPresets={
 wide:{physical:16,lanes:16},wide4:{physical:16,lanes:4},x4:{physical:4,lanes:4},x1:{physical:1,lanes:1},
} as const;
export function slotSummary(slot:Slot){return slot.bus==='PCIe'?`PCIe x${slot.physical} connector / x${slot.lanes} wired · Gen ${slot.generation} · ${slot.laneSource||'Source unknown'} · position ${slot.position}`:`PCI · position ${slot.position}`;}
