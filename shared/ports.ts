import type { Connection, Port } from './types';

export function portLabel(port:Pick<Port,'kind'|'customType'>):string {
  return port.kind==='Custom' ? port.customType?.trim() || 'Custom (name required)' : port.kind;
}

/** Aggregate legacy and structured demand without counting the same USB/LAN need twice. */
export function connectionPortTotals(connections:Connection[]) {
  const totals=new Map<string,{label:string;quantity:number}>();
  for(const connection of connections){
    const demand=new Map<string,{label:string;quantity:number}>([
      ['USB-A',{label:'USB-A',quantity:connection.usbA}],
      ['USB-C',{label:'USB-C',quantity:connection.usbC}],
      ['Ethernet',{label:'Ethernet',quantity:connection.ethernet}],
    ]);
    const structured=new Map<string,{label:string;quantity:number}>();
    for(const requirement of connection.requirements||[]){
      const label=portLabel(requirement),key=requirement.kind==='Custom'?`Custom:${label.toLowerCase()}`:requirement.kind;
      const previous=structured.get(key);
      structured.set(key,{label,quantity:(previous?.quantity||0)+requirement.quantity});
    }
    for(const [key,row] of structured)demand.set(key,{...row,quantity:Math.max(row.quantity,demand.get(key)?.quantity||0)});
    for(const [key,row] of demand){const previous=totals.get(key);totals.set(key,{label:previous?.label||row.label,quantity:(previous?.quantity||0)+row.quantity});}
  }
  return [...totals.values()];
}

export function connectionSummary(connection:Connection):string {
  return connectionPortTotals([connection]).filter(row=>row.quantity>0).map(row=>`${row.quantity} ${row.label}`).join(' · ') || 'No connections required';
}
