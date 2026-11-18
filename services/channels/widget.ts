const VISITOR_STORAGE_KEY = 'crm_chat_visitor_uid';
const SESSION_STORAGE_KEY = 'crm_chat_session_id';
const POLL_INTERVAL_MS = 2500;

export interface WidgetConfig {
  baseUrl: string;
  channelId: number;
  token: string;
  title: string;
  accent: string;
}

const WIDGET_BODY = [
  "var root=document.createElement('div');root.style.cssText='position:fixed;bottom:20px;right:20px;z-index:2147483000;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif';document.body.appendChild(root);",
  "function uid(){try{if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();}catch(e){}return 'v-'+Date.now()+'-'+Math.random().toString(36).slice(2);}",
  "function store(k,v){try{localStorage.setItem(k,v);}catch(e){}}",
  "function read(k){try{return localStorage.getItem(k);}catch(e){return null;}}",
  "function sread(k){try{return sessionStorage.getItem(k);}catch(e){return null;}}",
  "function swrite(k,v){try{sessionStorage.setItem(k,v);}catch(e){}}",
  "var visitorUid=read(VISITOR_STORAGE_KEY);if(!visitorUid){visitorUid=uid();store(VISITOR_STORAGE_KEY,visitorUid);}",
  "var sessionId=sread(SESSION_STORAGE_KEY);if(!sessionId){sessionId=uid();swrite(SESSION_STORAGE_KEY,sessionId);}",
  "var conversationId=0,lastId=0,open=false,timer=null;",
  "var bubble=document.createElement('button');bubble.setAttribute('aria-label','Open chat');bubble.style.cssText='width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;color:#fff;font-size:24px;box-shadow:0 6px 20px rgba(0,0,0,.25);background:'+CFG.accent;bubble.textContent='\\u{1F4AC}';root.appendChild(bubble);",
  "var panel=document.createElement('div');panel.style.cssText='display:none;flex-direction:column;width:340px;max-width:90vw;height:460px;max-height:70vh;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.28);position:absolute;bottom:68px;right:0';root.appendChild(panel);",
  "var head=document.createElement('div');head.style.cssText='padding:14px 16px;color:#fff;font-weight:600;font-size:15px;background:'+CFG.accent;head.textContent=CFG.title;panel.appendChild(head);",
  "var list=document.createElement('div');list.style.cssText='flex:1;overflow-y:auto;padding:12px;background:#f6f7f9;display:flex;flex-direction:column;gap:8px';panel.appendChild(list);",
  "var bar=document.createElement('div');bar.style.cssText='display:flex;border-top:1px solid #e5e7eb;padding:8px;gap:8px;background:#fff';panel.appendChild(bar);",
  "var input=document.createElement('input');input.type='text';input.placeholder='Type a message...';input.style.cssText='flex:1;border:1px solid #d1d5db;border-radius:8px;padding:9px 11px;font-size:14px;outline:none';bar.appendChild(input);",
  "var send=document.createElement('button');send.textContent='Send';send.style.cssText='border:none;border-radius:8px;color:#fff;padding:0 14px;cursor:pointer;font-size:14px;background:'+CFG.accent;bar.appendChild(send);",
  "function bubbleEl(text,mine){var row=document.createElement('div');row.style.cssText='display:flex;'+(mine?'justify-content:flex-end':'justify-content:flex-start');var b=document.createElement('div');b.style.cssText='max-width:80%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.35;white-space:pre-wrap;word-break:break-word;'+(mine?'background:'+CFG.accent+';color:#fff':'background:#fff;color:#111;border:1px solid #e5e7eb');b.textContent=text;row.appendChild(b);list.appendChild(row);list.scrollTop=list.scrollHeight;return row;}",
  "function renderButtons(buttons){var wrap=document.createElement('div');wrap.style.cssText='display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-start';buttons.forEach(function(btn){var el=document.createElement('button');el.textContent=btn.title||btn.value;el.style.cssText='border:1px solid '+CFG.accent+';color:'+CFG.accent+';background:#fff;border-radius:16px;padding:5px 12px;font-size:13px;cursor:pointer';el.onclick=function(){sendText(btn.value||btn.title);};wrap.appendChild(el);});list.appendChild(wrap);list.scrollTop=list.scrollHeight;}",
  "function api(path,opts){return fetch(CFG.baseUrl+path,opts).then(function(r){return r.json();});}",
  "function poll(){if(!conversationId)return;api('/api/channels/'+CFG.channelId+'/poll?conversation_id='+conversationId+'&after='+lastId+(CFG.token?'&token='+encodeURIComponent(CFG.token):''),{}).then(function(res){var msgs=(res&&res.messages)||[];msgs.forEach(function(m){lastId=Math.max(lastId,m.id);bubbleEl(m.text,false);if(m.payload&&m.payload.buttons&&m.payload.buttons.length)renderButtons(m.payload.buttons);});}).catch(function(){});}",
  "function sendText(text){text=(text||'').trim();if(!text)return;bubbleEl(text,true);var body={visitor_uid:visitorUid,session_id:sessionId,text:text};api('/api/channels/'+CFG.channelId+'/inbound'+(CFG.token?'?token='+encodeURIComponent(CFG.token):''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(res){if(res&&res.conversation_id){conversationId=res.conversation_id;}(res&&res.messages||[]).forEach(function(m){lastId=Math.max(lastId,m.id);bubbleEl(m.text,false);if(m.payload&&m.payload.buttons&&m.payload.buttons.length)renderButtons(m.payload.buttons);});if(!timer)timer=setInterval(poll,POLL_INTERVAL_MS);}).catch(function(){});}",
  "send.onclick=function(){var t=input.value;input.value='';sendText(t);};",
  "input.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();send.onclick();}});",
  "bubble.onclick=function(){open=!open;panel.style.display=open?'flex':'none';if(open){input.focus();if(!timer)timer=setInterval(poll,POLL_INTERVAL_MS);poll();}};",
].join('\n');

/** Builds a dependency-free embeddable live-chat widget script for a channel. */
export function buildWidgetScript(config: WidgetConfig): string {
  const injected =
    'var CFG=' + JSON.stringify(config) + ';' +
    'var VISITOR_STORAGE_KEY=' + JSON.stringify(VISITOR_STORAGE_KEY) + ';' +
    'var SESSION_STORAGE_KEY=' + JSON.stringify(SESSION_STORAGE_KEY) + ';' +
    'var POLL_INTERVAL_MS=' + POLL_INTERVAL_MS + ';';
  return '(function(){if(window.__crmChat_' + config.channelId + ')return;window.__crmChat_' + config.channelId + '=true;' + injected + WIDGET_BODY + '})();';
}
