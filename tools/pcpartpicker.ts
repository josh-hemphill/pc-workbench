/** Offline importer: no undocumented API, anti-bot bypass, or bulk crawl. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {categories,type Category,type Component} from '../shared/types';
import {encodeCSV} from '../server/store';
export function importProductHTML(html:string,category:Category,source=''):Component[] {
 const products:Record<string,unknown>[]=[];
 function walk(value:unknown){if(!value||typeof value!=='object')return;if(Array.isArray(value)){for(const item of value)walk(item);return;}const obj=value as Record<string,unknown>;const type=obj['@type'];if((type==='Product'||(Array.isArray(type)&&type.includes('Product')))&&typeof obj.name==='string')products.push(obj);for(const [key,v] of Object.entries(obj))if(key!=='@type')walk(v);}
 for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){try{walk(JSON.parse(match[1]));}catch{/* One malformed block does not hide valid Product blocks. */}}
 const unique=new Map<string,Component>();
 for(const product of products){const brand=product.brand;const manufacturer=typeof brand==='string'?brand:brand&&typeof brand==='object'&&typeof (brand as {name:unknown}).name==='string'?(brand as {name:string}).name:'';const url=typeof product.url==='string'?product.url:source;const name=String(product.name);const id='pcpp-'+createHash('sha256').update(url||`${manufacturer}:${name}`).digest('hex').slice(0,16);unique.set(id,{id,name,manufacturer,category,specs:{notes:'Imported product identity only. Add and verify all engineering specifications using manufacturer documentation.'},source:url,verified:false});}
 if(!unique.size)throw Error('No structured Product JSON-LD found. This page format is unsupported; add the part manually or supply component CSV.');
 return [...unique.values()];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const args=process.argv.slice(2),file=args[0];const value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};const category=value('--category') as Category,output=value('--output'),source=value('--source')||'';if(!file||!categories.includes(category)||!output)throw Error('Usage: deno task import:pcpartpicker product.html --category CPU --output parts.csv [--source https://pcpartpicker.com/product/…]');const rows=importProductHTML(fs.readFileSync(file,'utf8'),category,source);fs.writeFileSync(output,encodeCSV('components',rows),{flag:'wx'});console.log(`Imported ${rows.length} product identities into ${output}. Verify specifications in the catalog.`);}catch(e){console.error(e instanceof Error?e.message:e);process.exitCode=1;}}
