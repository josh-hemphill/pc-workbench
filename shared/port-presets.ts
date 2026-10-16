import type {Port,PortKind} from './types.ts';
export interface PortPreset {value:string;title:string;speedMbps:number;protocol?:string}
const ethernet:PortPreset[]=[10,100,1000,2500,5000,10000,25000,40000,100000].map(speedMbps=>({value:`ethernet-${speedMbps}`,title:speedMbps<1000?`${speedMbps} Mbit/s Ethernet`:`${speedMbps/1000} Gbit/s Ethernet`,speedMbps}));
const usb:PortPreset[]=[
 {value:'usb-12',title:'USB 1.1 · 12 Mbit/s',protocol:'USB 1.1',speedMbps:12},
 {value:'usb-480',title:'USB 2.0 · 480 Mbit/s',protocol:'USB 2.0',speedMbps:480},
 {value:'usb-5000',title:'USB 3.1 Gen 1 (USB 3.0 / 3.2 Gen 1) · 5 Gbit/s',protocol:'USB 3.1 Gen 1',speedMbps:5000},
 {value:'usb-10000',title:'USB 3.1 Gen 2 (USB 3.2 Gen 2) · 10 Gbit/s',protocol:'USB 3.1 Gen 2',speedMbps:10000},
];
const usbC:PortPreset[]=[
 {value:'usb-20000',title:'USB 3.2 Gen 2×2 · 20 Gbit/s',protocol:'USB 3.2 Gen 2x2',speedMbps:20000},
 {value:'usb4-20000',title:'USB4 · 20 Gbit/s',protocol:'USB4',speedMbps:20000},
 {value:'usb4-40000',title:'USB4 · 40 Gbit/s',protocol:'USB4',speedMbps:40000},
 {value:'usb4-80000',title:'USB4 Version 2.0 · 80 Gbit/s',protocol:'USB4 Version 2.0',speedMbps:80000},
];
/** Connector shape does not establish speed, power delivery, or alternate modes. */
export function portPresets(kind:PortKind):readonly PortPreset[]{return kind==='Ethernet'?ethernet:kind==='USB-A'?usb:kind==='USB-C'?[...usb,...usbC]:[];}
export function portPresetValue(port:Port):string{return portPresets(port.kind).find(p=>p.speedMbps===port.speedMbps&&(p.protocol===undefined||p.protocol===port.protocol))?.value||'';}
/** Explicit shortcut: preserve connector, stable ID, wiring and electrical declarations. */
export function applyPortPreset(port:Port,value:string){const preset=portPresets(port.kind).find(p=>p.value===value);if(!preset)return;port.speedMbps=preset.speedMbps;if(preset.protocol!==undefined)port.protocol=preset.protocol;}
