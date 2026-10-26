import {nextTick,watch,type Ref} from 'vue';
/** Expand optional details before focusing an invalid field; native focus cannot reveal closed details. */
export function focusInvalidControl(root:ParentNode|null|undefined){
 const input=root?.querySelector<HTMLElement>('.v-input--error input, .v-input--error textarea, .v-input--error button');
 if(!input)return;
 for(let parent=input.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;
 input.scrollIntoView({block:'center',behavior:'auto'});input.focus({preventScroll:true});
}
/** Server failures must remain discoverable when the user submits a long scrolled form. */
export function useErrorFeedback(error:Ref<string>){
 watch(error,async message=>{if(!message)return;await nextTick();
  const alerts=[...document.querySelectorAll<HTMLElement>('[role="alert"]')].filter(el=>el.getClientRects().length&&el.textContent?.includes(message));
  const alert=alerts.at(-1);if(!alert)return;alert.tabIndex=-1;alert.scrollIntoView({block:'center',behavior:'auto'});alert.focus({preventScroll:true});
 });
}
