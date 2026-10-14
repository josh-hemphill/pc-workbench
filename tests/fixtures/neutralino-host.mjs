// Protocol fixture: real child process and WebSocket, no native window.
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
const directory=process.argv.find(x=>x.startsWith('--path=')).slice(7);
const preload=fs.readFileSync(path.join(directory,'close.js'),'utf8');
const nonce=JSON.parse(preload.match(/nonce:("[^"]+")/)[1]);
const config=JSON.parse(fs.readFileSync(path.join(directory,'neutralino.config.json'),'utf8'));
if(!fs.readFileSync(path.join(directory,config.cli.clientLibrary),'utf8').startsWith('var Neutralino='))process.exit(4);
const server=createServer();
server.on('upgrade',(req,socket)=>{
 if(!req.url.includes('connectToken=private-connect-token'))return socket.destroy();
 const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
 socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
 function send(nonce){const bytes=Buffer.from(JSON.stringify({event:'close-approved',data:{nonce}}));socket.write(Buffer.concat([Buffer.from([0x81,bytes.length]),bytes]));}
 setTimeout(()=>send('wrong-session'),20);
 setTimeout(()=>{if(fs.existsSync(process.env.BENCH_NEUTRALINO_STOPPED))process.exit(5);send(nonce);},100);
 let pending=Buffer.alloc(0);
 socket.on('data',chunk=>{
  pending=Buffer.concat([pending,chunk]);
  if(pending.length<6)return;
  const code=pending[1]&127;const offset=code===126?4:2,length=code===126?pending.readUInt16BE(2):code;
  if(pending.length<offset+4+length)return;
  const mask=pending.subarray(offset,offset+4),payload=Buffer.from(pending.subarray(offset+4,offset+4+length));
  for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
  const message=JSON.parse(payload.toString());
  if(message.method!=='app.exit'||message.accessToken!=='private-token'||!fs.existsSync(process.env.BENCH_NEUTRALINO_STOPPED))process.exit(6);
  fs.writeFileSync(process.env.BENCH_NEUTRALINO_RESULT,'shutdown-before-native-exit');process.exit(0);
 });
});
server.listen(0,'127.0.0.1',()=>{
 fs.mkdirSync(path.join(directory,'.tmp'));
 fs.writeFileSync(path.join(directory,'.tmp/auth_info.json'),JSON.stringify({nlPort:server.address().port,nlToken:'private-token',nlConnectToken:'private-connect-token'}));
});
