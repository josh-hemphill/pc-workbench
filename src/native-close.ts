// A read-only decision hook for native hosts. It grants no OS capabilities.
declare global {interface Window {__pcWorkbenchCanClose?:()=>boolean}}
export function installNativeCloseDecision(canClose:()=>boolean):()=>void {
 window.__pcWorkbenchCanClose=canClose;
 return ()=>{if(window.__pcWorkbenchCanClose===canClose)delete window.__pcWorkbenchCanClose;};
}
