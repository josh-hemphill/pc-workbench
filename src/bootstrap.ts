/** Keep startup feedback independent of Vue and its dependency graph. */
const startupScreen=document.querySelector<HTMLElement>('[data-startup-screen]');
function showRecovery(title:string,message:string){
 if(!startupScreen?.isConnected)return;
 startupScreen.setAttribute('role','alert');startupScreen.replaceChildren();
 const heading=document.createElement('h1');heading.textContent=title;
 const detail=document.createElement('p');detail.textContent=message;
 const retry=document.createElement('button');retry.type='button';retry.textContent='Reload workbench';
 // Reload keeps the current hash route and lets Vite supply a fresh module graph.
 retry.addEventListener('click',()=>location.reload());
 startupScreen.append(heading,detail,retry);
}
const waitingMessage=import.meta.env.DEV?'Check that pnpm dev is still running, then reload this window. Your current page address will be preserved.':'The application has not finished loading. Try reloading this window. Your current page address will be preserved.';
const timer=window.setTimeout(()=>showRecovery('Workbench is taking longer to open',waitingMessage),15000);
try{
 await import('./main.ts');
}catch(error){
 console.error('Workbench startup failed:',error);
 showRecovery('Workbench could not start',error instanceof Error?error.message:String(error));
}finally{window.clearTimeout(timer);}

export {};
