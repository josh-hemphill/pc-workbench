import {test} from 'node:test';
import assert from 'node:assert/strict';
import {missingFields,patchMissing,catalogFields,fieldValue} from '../shared/catalog-quality.ts';
import {extractProductDetails,pcPartPickerURL} from '../shared/product-enrichment.ts';
import type {Component} from '../shared/types.ts';
const part=(category:Component['category']='Motherboard'):Component=>({id:'test-part',name:'Test part',category,manufacturer:'',source:'',verified:true,specs:{}});
test('missing data is category-specific and does not treat known zero or false as missing',()=>{const c=part('PSU');c.specs={sataPower:0,capacityW:500};assert.deepEqual(missingFields(c).map(f=>f.key),['manufacturer','source']);assert(!catalogFields(c).some(f=>f.key==='socket'));const sled=part('Storage adapter');sled.specs={storageAdapterKind:'pcie-sled',requiresBifurcation:false};assert(!missingFields(sled).some(f=>f.key==='requiresBifurcation'));});
test('explicit connection inventories satisfy aggregate missing-data checks',()=>{const c=part();c.specs.sataDataPorts=[{id:'sata-a'}];assert(!missingFields(c).some(f=>f.key==='sataPorts'));const p=part('PSU');p.specs.sataPowerConnectors=[];assert(!missingFields(p).some(f=>f.key==='sataPower'));});
test('bulk patches fill only missing values and reset verification only when changed',()=>{const c=part();c.specs.socket='AM5';const next=patchMissing(c,{socket:'LGA1700',sataPorts:0});assert.equal(next.specs.socket,'AM5');assert.equal(next.specs.sataPorts,0);assert.equal(next.verified,false);assert.equal(c.verified,true);assert.equal(patchMissing(c,{socket:'AM4'}).verified,true);assert.throws(()=>patchMissing(part('PSU'),{socket:'AM5'}),/not applicable/);});
test('bulk arrays reuse catalog spelling and reject empty or invalid values',()=>{const c=part('Cooler');assert.deepEqual(patchMissing(c,{supportsSockets:['am5','AM5',' lga1700 ']}).specs.supportsSockets,['AM5','LGA1700']);assert.throws(()=>patchMissing(c,{supportsSockets:[]}),/Provide/);assert.throws(()=>patchMissing(part(),{sataPorts:'6'}),/Invalid/);});
test('product URL validation rejects arbitrary hosts credentials ports protocols and listing pages',()=>{for(const url of ['http://pcpartpicker.com/product/abc','https://example.org/product/abc','https://pcpartpicker.com.evil.test/product/abc','https://user@pcpartpicker.com/product/abc','https://pcpartpicker.com:444/product/abc','https://pcpartpicker.com/products/cpu/'])assert.throws(()=>pcPartPickerURL(url));assert.equal(pcPartPickerURL('https://pcpartpicker.com/product/abc/cpu?q=1#x'),'https://pcpartpicker.com/product/abc/cpu');});
test('structured properties and visible spec groups produce conservative category-specific proposals',()=>{const c=part();c.specs.socket='AM5';const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Test part',brand:{name:'Test brand'},additionalProperty:[{name:'Socket',value:'LGA1700'},{name:'Memory Max',value:'128 GB'}]})+'</script><h3 class="group__title">SATA 6.0 Gb/s</h3><div class="group__content">6</div>';const result=extractProductDetails(html,c);assert.equal(result.productName,'Test part');assert.deepEqual(result.patch,{manufacturer:'Test brand',maxMemoryGb:128,sataPorts:6});assert.equal(c.specs.maxMemoryGb,undefined);});
test('capacity units convert safely and ambiguous PCIe protocols do not become NVMe',()=>{const c=part('Drive');const html='<tr><td>Capacity</td><td>2 TB</td></tr><tr><td>Interface</td><td>PCIe 3.0 X4</td></tr><tr><td>Form Factor</td><td>M.2</td></tr>';const result=extractProductDetails(html,c);assert.equal(result.patch.capacityGb,2000);assert.equal(result.patch.driveSize,'M.2');assert.equal(result.patch.driveInterface,undefined);assert.equal(extractProductDetails('<tr><td>Height</td><td>164.5 mm</td></tr>',part('Cooler')).patch.heightMm,undefined);assert.equal(extractProductDetails('<tr><td>Capacity</td><td>32 GB (2 x 16 GB)</td></tr>',part('Memory')).patch.capacityGb,undefined);});
test('multiple product identities cannot silently mix proposed engineering values',()=>{const html='<script type="application/ld+json">[{"@type":"Product","name":"Part A","brand":"AMD"},{"@type":"Product","name":"Part B","brand":"Intel"}]</script>';assert.throws(()=>extractProductDetails(html,part('CPU')),/Multiple product identities/);});

test('confirmed zero USB counts and complete named inventories are known data',()=>{
 const scalar=part();scalar.specs.usbC=0;assert(!missingFields(scalar).some(field=>field.key==='usbC'));
 const named=part();named.specs={ports:[{id:'USB_A_1',kind:'USB-A'}],usbC:9};
 assert.equal(fieldValue(named,'usbA'),1);assert.equal(fieldValue(named,'usbC'),0);assert.equal(fieldValue(named,'ethernet'),0);
 assert(!missingFields(named).some(field=>['usbA','usbC','ethernet'].includes(field.key)));
 const preserved=patchMissing(named,{usbC:2,ethernet:1});assert.deepEqual(preserved,named);
 named.specs.ports=[];for(const key of ['usbA','usbC','ethernet'])assert.equal(fieldValue(named,key),0);
 delete named.specs.ports;delete named.specs.usbC;assert(missingFields(named).some(field=>field.key==='usbC'));
});
test('named motherboard M.2 positions satisfy count gaps even when the inventory is empty',()=>{
 const c=part();c.specs.driveTargets=[{id:'M2_1',mount:'internal',driveSizes:['M.2']}];assert.equal(fieldValue(c,'m2Slots'),1);assert(!missingFields(c).some(field=>field.key==='m2Slots'));
 c.specs.driveTargets=[];assert.equal(fieldValue(c,'m2Slots'),0);assert(!missingFields(c).some(field=>field.key==='m2Slots'));
 delete c.specs.driveTargets;assert(missingFields(c).some(field=>field.key==='m2Slots'));
});
