import {once} from 'node:events';
import {frontend,root} from './frontend.ts';
import {startNodeServer} from '../../server/node-serve.ts';
const backend=startNodeServer({sourceRoot:root});
try{
 await once(backend,'listening');
 const web=await frontend('dev');
 backend.once('close',()=>{void web?.close();});
}catch(error){if(backend.listening){backend.close();backend.closeAllConnections();}throw error;}
