import {once} from 'node:events';
import {frontend,root} from './frontend';
import {startNodeServer} from '../../server/node-serve';
const backend=startNodeServer({sourceRoot:root});
try{
 await once(backend,'listening');
 const web=await frontend('dev');
 backend.once('close',()=>{void web?.close();});
}catch(error){if(backend.listening){backend.close();backend.closeAllConnections();}throw error;}
