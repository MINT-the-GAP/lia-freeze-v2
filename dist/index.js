!function(e,t,r,o,n){var i="u">typeof globalThis?globalThis:"u">typeof self?self:"u">typeof window?window:"u">typeof global?global:{},a="function"==typeof i[o]&&i[o],l=a.i||{},s=a.cache||{},c="u">typeof module&&"function"==typeof module.require&&module.require.bind(module);function u(t,r){if(!s[t]){if(!e[t]){if(n[t])return n[t];var l="function"==typeof i[o]&&i[o];if(!r&&l)return l(t,!0);if(a)return a(t,!0);if(c&&"string"==typeof t)return c(t);var d=Error("Cannot find module '"+t+"'");throw d.code="MODULE_NOT_FOUND",d}p.resolve=function(r){var o=e[t][1][r];return null!=o?o:r},p.cache={};var f=s[t]=new u.Module(t);e[t][0].call(f.exports,p,f,f.exports,i)}return s[t].exports;function p(e){var t=p.resolve(e);if(!1===t)return{};if(Array.isArray(t)){var r={__esModule:!0};return t.forEach(function(e){var t=e[0],o=e[1],n=e[2]||e[0],i=u(o);"*"===t?Object.keys(i).forEach(function(e){"default"===e||"__esModule"===e||Object.prototype.hasOwnProperty.call(r,e)||Object.defineProperty(r,e,{enumerable:!0,get:function(){return i[e]}})}):"*"===n?Object.defineProperty(r,t,{enumerable:!0,value:i}):Object.defineProperty(r,t,{enumerable:!0,get:function(){return"default"===n?i.__esModule?i.default:i:i[n]}})}),r}return u(t)}}u.isParcelRequire=!0,u.Module=function(e){this.id=e,this.bundle=u,this.require=c,this.exports={}},u.modules=e,u.cache=s,u.parent=a,u.distDir=void 0,u.publicUrl=void 0,u.devServer=void 0,u.i=l,u.register=function(t,r){e[t]=[function(e,t){t.exports=r},{}]},Object.defineProperty(u,"root",{get:function(){return i[o]}}),i[o]=u;for(var d=0;d<t.length;d++)u(t[d]);if(r){var f=u(r);"object"==typeof exports&&"u">typeof module?module.exports=f:"function"==typeof define&&define.amd&&define(function(){return f})}}({"8RSWf":[function(e,t,r,o){var n=e("./port"),i=e("./snapshot"),a=e("./url"),l=e("./freeze-ui"),s=e("./evaluation"),c=e("./security");let u=[],d=Object.create(null),f={trackF12:!1,trackTab:!1},p="",m=0,b=null,g=null,h="",y="";function v(){return u.find(e=>"evaluation"===e.vt)}async function w(){let e=window.location.search;if(!e||"?"===e)return null;try{let t=decodeURIComponent(e.slice(1)),r=new URL(t,window.location.href);r.hash.startsWith("#submission=")&&(r.hash="");let o=await fetch(r.toString(),{cache:"no-store"});if(!o.ok)return null;return await o.text()}catch{return null}}async function x(){let e=await w();e&&(f=(0,s.parseEvaluationOptions)(e),u=(0,s.parseDeclaredSlides)(e),p=(0,s.parseAbgabeHash)(e),m=(0,s.parseSectionCount)(e),d=(0,s.parseEvaluationDeclarations)(e))}function k(){if(!b)return;let e=function(){if(g)return g;let e=document.createElement("div");return e.id="lia-eval-placeholder",e.style.cssText="display:none;position:fixed;top:0;left:0;right:0;bottom:0;overflow-y:auto;z-index:9000;padding:4rem 1.5rem 3rem;box-sizing:border-box;background:rgb(var(--lia-submit-bg-rgb));color:var(--lia-submit-fg);border:1px solid var(--lia-submit-border-on-theme)",document.body.appendChild(e),g=e,e}(),t=v();e.innerHTML=(0,s.renderEvaluationSlide)({payload:b,evalDecl:d,title:t?.t,name:b.n});let r=document.getElementById("lia-freeze-bar"),o=r?r.offsetHeight:64;e.style.paddingTop=o+24+"px",e.style.display="block"}function z(){g&&(g.style.display="none")}function S(){let e,t=(0,a.getCurrentHash)(),r=(e=t.match(/^#(\d+)$/))?parseInt(e[1],10):1,o=u.filter(e=>!e.vt).length||1,n=u.find(e=>e.h===t),i=n?u.indexOf(n)+1:r,s=i<=1;(0,l.setFreezeBarState)({slideTitle:n?.t??"",slidePos:i+" / "+o,canFirst:!s,canPrev:!s,canNext:!(i>=o),canEval:!!v()})}function E(){var e;let t;(e=(0,a.getCurrentHash)(),(t=v())&&t.h===e)?k():z(),setTimeout(l.reapplyContentLock,80),S()}async function _(e){function t(e){z();let t=(0,a.getCurrentHash)(),r=u.filter(e=>!e.vt),o=r.findIndex(e=>e.h===t),n=o>=0?r[Math.max(0,Math.min(r.length-1,o+e))]:e<0?r[0]:r[r.length-1];n&&(window.location.hash=n.h)}b=e,(0,l.setPageFrozen)(!0,!0),(0,l.installFreezeBar)({onFirst:()=>{z();let e=u.find(e=>!e.vt);e&&(window.location.hash=e.h)},onPrev:()=>t(-1),onNext:()=>t(1),onEval:()=>{let e=v();e&&(window.location.hash=e.h,k())}}),window.addEventListener("hashchange",E),await x(),e.sec?.trackF12&&(0,c.installF12Tracking)(),e.sec?.trackTab&&(0,c.installTabTracking)(),(0,i.restoreSnapshot)(e);let r=v(),o=r?.h??p??e.sh??"#1";window.location.hash=o,r&&o===r.h&&k(),S()}async function T(){(0,l.wireLiveBar)({onCreateLink:()=>{A()},onCopyLink:()=>{let e=document.getElementById("lia-link"),t=e?.value??"";t&&(0,l.copyLinkToClipboard)(t).then(e=>(0,l.setLiveBarStatus)(e?"Link copied to clipboard.":"Copy failed — please copy manually."))}}),window.addEventListener("hashchange",()=>{setTimeout(l.reapplyContentLock,80)}),await x(),f.trackF12&&(0,c.installF12Tracking)(),f.trackTab&&(0,c.installTabTracking)()}async function A(){(0,l.setLiveBarStatus)("Creating submission link…");try{let e=m||u.length||30,t=await (0,i.captureSnapshot)(e),r=(0,c.getSecurityState)();t.sec={trackF12:+!!f.trackF12,trackTab:+!!f.trackTab,f12:r.f12,tab:r.tab};let o=document.getElementById("lia-name"),n=(o?.value??"").trim();n&&(t.n=n);let s=await (0,a.buildLink)(t);h=s,y=n,(0,l.setLiveBarFrozen)(s,n),b=t,(0,l.setPageFrozen)(!0,!1)}catch(e){(0,l.setLiveBarStatus)("Error: "+(e instanceof Error?e.message:String(e)))}}async function C(){(0,l.injectRuntimeCSS)(),new MutationObserver(()=>{if(!h)return;let e=document.getElementById("lia-link");e&&!e.value&&function(){if(!h)return;let e=document.getElementById("lia-name"),t=document.getElementById("lia-link"),r=document.getElementById("lia-create-link"),o=document.getElementById("lia-copy-link"),n=document.getElementById("lia-frozen-note");e&&(e.value=y,e.disabled=!0),r&&(r.disabled=!0,r.textContent="Submission frozen"),t&&(t.value=h,t.disabled=!1,t.readOnly=!0,t.style.pointerEvents="auto",t.style.userSelect="text"),o&&(o.disabled=!h),n&&(n.style.display="block")}()}).observe(document.body,{childList:!0,subtree:!0}),(0,l.applyThemeColors)(),(0,l.applyCourseColors)(),new MutationObserver(()=>{(0,l.applyThemeColors)(),(0,l.applyCourseColors)()}).observe(document.documentElement,{attributes:!0,attributeFilter:["class","style","data-theme"]});let e=history.pushState.bind(history),t=history.replaceState.bind(history);history.pushState=function(...t){let r=e(...t);return E(),r},history.replaceState=function(...e){let r=t(...e);return E(),r},(0,n.installPortIntercept)();let r=(0,a.getSubmissionToken)();r&&(0,a.storeToken)(r);let o=await (0,a.loadPayload)();o?await _(o):await T()}function I(){C().catch(e=>console.error("[LIA-FREEZE]",e))}"loading"===document.readyState?document.addEventListener("DOMContentLoaded",I):setTimeout(I,0)},{"./port":"8E6Fn","./snapshot":"ahaMQ","./url":"hyyva","./freeze-ui":"45Hu0","./evaluation":"cUIxA","./security":"hn3mm"}],"8E6Fn":[function(e,t,r,o){var n=e("@parcel/transformer-js/src/esmodule-helpers.js");n.defineInteropFlag(r),n.export(r,"loadNativeState",()=>s),n.export(r,"sendRestoreEvent",()=>c),n.export(r,"installPortIntercept",()=>u);let i=["quiz","survey","code","task"];async function a(){let e="",t=window.location.search;if(t&&"?"!==t)try{let r=decodeURIComponent(t.slice(1)),o=new URL(r,window.location.href);String(o.hash).startsWith("#submission=")&&(o.hash=""),e=o.toString()}catch{e=t.slice(1)}try{let t=await indexedDB.databases();console.log("[LIA-FREEZE] all IDB databases:",t.map(e=>e.name));let r=t.find(t=>t.name===e);if(r?.name)return r.name;if(e){let r="";try{r=new URL(e).pathname}catch{r=e}let o=t.find(e=>{if(!e.name)return!1;try{return new URL(e.name).pathname===r}catch{return!1}});if(o?.name)return o.name;let n=r.split("/").pop()??"";if(n){let e=t.find(e=>e.name?.includes(n));if(e?.name)return e.name}}return e}catch{return e}}function l(e){let t={};for(let r of e){let e=Number(r.id);(!t[e]||r.version>t[e].version)&&(t[e]={version:r.version,data:r.data})}let r={};for(let[e,o]of Object.entries(t))r[Number(e)]=o.data;return r}async function s(){let e,t=await a(),r={quiz:{},survey:{},code:{},task:{}};if(!t)return r;try{e=await new Promise((e,r)=>{let o=indexedDB.open(t);o.onsuccess=()=>e(o.result),o.onerror=()=>r(o.error),o.onblocked=()=>r(Error("IDB blocked")),o.onupgradeneeded=()=>{o.transaction.abort(),r(Error("IDB does not exist yet"))}})}catch(e){return console.log("[LIA-FREEZE] IDB open failed:",e),r}try{console.log("[LIA-FREEZE] IDB dbName:",t,"version:",e.version,"stores:",Array.from(e.objectStoreNames));let r=await Promise.all(i.map(t=>{var r;return r=e,new Promise((e,o)=>{if(!r.objectStoreNames.contains(t))return void e([]);try{let n=r.transaction(t,"readonly").objectStore(t).getAll();n.onsuccess=()=>e(n.result??[]),n.onerror=()=>o(n.error)}catch(t){e([])}})}));console.log("[LIA-FREEZE] IDB quiz records count:",r[0].length),r[0].length>0?console.log("[LIA-FREEZE] IDB first quiz record:",JSON.stringify(r[0][0])):console.log("[LIA-FREEZE] IDB quiz store EMPTY"),e.close();let o={quiz:l(r[0]),survey:l(r[1]),code:l(r[2]),task:l(r[3])};return console.log("[LIA-FREEZE] IDB native state:",JSON.stringify(o)),o}catch{return e.close(),r}}function c(e,t,r){window.LIA.send({reply:!0,track:[[e,t]],service:"db",message:{cmd:"load",param:{table:e,id:t,data:r}}})}function u(){}},{"@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],k3151:[function(e,t,r,o){r.interopDefault=function(e){return e&&e.__esModule?e:{default:e}},r.defineInteropFlag=function(e){Object.defineProperty(e,"__esModule",{value:!0})},r.exportAll=function(e,t){return Object.keys(e).forEach(function(r){"default"===r||"__esModule"===r||Object.prototype.hasOwnProperty.call(t,r)||Object.defineProperty(t,r,{enumerable:!0,get:function(){return e[r]}})}),t},r.export=function(e,t,r){Object.defineProperty(e,t,{enumerable:!0,get:r})}},{}],ahaMQ:[function(e,t,r,o){var n=e("@parcel/transformer-js/src/esmodule-helpers.js");n.defineInteropFlag(r),n.export(r,"PAYLOAD_VERSION",()=>l),n.export(r,"captureSnapshot",()=>c),n.export(r,"restoreSnapshot",()=>u);var i=e("./port"),a=e("./url");let l="sf-mini-ti-3";async function s(){return(0,i.loadNativeState)()}async function c(e){let t=await s(),r=function(){try{let e=window.__LIA_CANVAS_OCR__?.freeze;if(!e?.exportAllCanvasFreezeStatesFromRoot)return[];return e.exportAllCanvasFreezeStatesFromRoot(document)}catch{return[]}}(),o=function(){try{let e=window.__LIA_TEXTMARKER_REG_V4__;if(!e)return[];let t=document.baseURI||location.href;return e.instances[t]?.HL??[]}catch{return[]}}(),n=function(){try{return window.__ORTHOGRAPHY_EXPORT_V8__?.getAllStates?.()??{}}catch{return{}}}(),i=function(){try{let e=window.__LIA_FRACTION_QUIZ__;if(!e)return{};let t=e.getAllWidgets(),r={};for(let e of Object.keys(t))r[e]=t[e];return r}catch{return{}}}(),c=function(){try{let e=window.__coord?.getBoardStateStore?.()??window.__coordBoardStates??{};return JSON.parse(JSON.stringify(e))}catch{return{}}}(),u=function(){try{return window.__LIA_ANNOTATION__?.exportFreezeState()??null}catch{return null}}(),d=[];for(let r=0;r<e;r++){let e={h:"#"+(r+1)};null!=t.quiz[r]&&(e.quiz={[r]:t.quiz[r]}),null!=t.survey[r]&&(e.survey={[r]:t.survey[r]}),null!=t.code[r]&&(e.code={[r]:t.code[r]}),null!=t.task[r]&&(e.task={[r]:t.task[r]}),d.push(e)}return d.length>0&&(r.length&&(d[0].canvas=r),(Object.keys(o).length||o.length)&&(d[0].marker=o),Object.keys(n).length&&(d[0].ortho=n),Object.keys(i).length&&(d[0].mathe=i),Object.keys(c).length&&(d[0].coord=c)),{v:l,sh:(0,a.getCurrentHash)(),s:d,annot:u}}function u(e){if(!e||!Array.isArray(e.s))return;for(let t=0;t<e.s.length;t++){let r=e.s[t];for(let e of["quiz","survey","code","task"]){let t=r[e];if(t)for(let[r,o]of Object.entries(t))(0,i.sendRestoreEvent)(e,Number(r),o)}}let t=e.s[0];t&&(Array.isArray(t.canvas)&&function(e){try{let t=window.__LIA_CANVAS_OCR__?.freeze;if(!t?.renderCanvasFreezeStateIntoPair||!t.collectCanvasPairsFromRoot)return;let r=t.collectCanvasPairsFromRoot(document);for(let o of Array.isArray(e)?e:[]){let e=o?.u;if(!e)continue;let n=r.find(t=>{let r=t.querySelector?.(".lia-canvas-mount");return r&&r.dataset?.uid===e});n&&t.renderCanvasFreezeStateIntoPair(n,o)}}catch{}}(t.canvas),Array.isArray(t.marker)&&function(e){try{let t=window.__LIA_TEXTMARKER_REG_V4__;if(!t||"function"!=typeof t.setHighlights)return;t.setHighlights(Array.isArray(e)?e:[])}catch{}}(t.marker),t.ortho&&"object"==typeof t.ortho&&function(e){try{let t=window.__ORTHOGRAPHY_EXPORT_V8__;if(!t||"function"!=typeof t.setState)return;for(let[r,o]of Object.entries(e)){let e=o?.liveValue??o;"string"==typeof e&&t.setState(r,e)}}catch{}}(t.ortho),t.mathe&&"object"==typeof t.mathe&&function(e){try{let t=window.__LIA_FRACTION_QUIZ_V3__;if(!t)return;for(let[r,o]of Object.entries(e)){if(!Array.isArray(o.state))continue;let e=t.getWidget(r);e&&(e.state=[...o.state])}}catch{}}(t.mathe),t.coord&&"object"==typeof t.coord&&function(e){try{let t=window.__coord?.getBoardStateStore?.()??window.__coordBoardStates;if(!t)return;for(let[r,o]of Object.entries(e))t[r]=o}catch{}}(t.coord)),function(e){try{if(!e)return;window.__LIA_ANNOTATION__?.importFreezeState(e,{replace:!0})}catch{}}(e.annot)}},{"./port":"8E6Fn","./url":"hyyva","@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],hyyva:[function(e,t,r,o){var n=e("@parcel/transformer-js/src/esmodule-helpers.js");n.defineInteropFlag(r),n.export(r,"getSubmissionToken",()=>u),n.export(r,"storeToken",()=>d),n.export(r,"clearToken",()=>f),n.export(r,"getCurrentHash",()=>p),n.export(r,"buildLink",()=>m),n.export(r,"loadPayload",()=>b);var i=e("./codec");let a="submission";function l(){let e=window.location.search;if(!e||"?"===e)return"";try{return decodeURIComponent(e.slice(1))}catch{return e.slice(1)}}function s(e){if(!e)return"";try{let t=new URL(e,window.location.href);return String(t.hash).replace(/^#/,"").startsWith(a+"=")&&(t.hash=""),t.toString()}catch{return e.replace(RegExp("#"+a+"=[^#]*$"),"")}}function c(){let e=l();return"__lia_freeze_v2__:"+(()=>{let t=s(e);try{let e=new URL(t,window.location.href);return e.hash="",e.toString()}catch{return t.replace(/#.*$/,"")}})()}function u(){let e=function(){let e=l();if(!e)return null;try{let t=String(new URL(e,window.location.href).hash).replace(/^#/,"");if(!t.startsWith(a+"="))return null;return decodeURIComponent(t.slice((a+"=").length))}catch{let t=e.match(RegExp("#"+a+"=([^#]+)$"));return t?decodeURIComponent(t[1]):null}}()||function(){let e=window.location.hash;if(!e)return null;let t=e.match(/[?&]submission=([^&]+)/);return t?decodeURIComponent(t[1]):null}();if(e)return d(e),e;try{return sessionStorage.getItem(c())||null}catch{return null}}function d(e){try{sessionStorage.setItem(c(),e)}catch{}}function f(){try{sessionStorage.removeItem(c())}catch{}}function p(){let e=window.location.hash,t=e.match(/^(#\d+)&submission=/)?.[1]??e;return/^#\d+$/.test(t)?t:"#1"}async function m(e){let t=s(l());if(!t)return window.location.href;let{token:r}=await (0,i.encodeToken)(e);d(r);let o=window.location.href.split("?")[0].split("#")[0],n=/^#\d+$/.test(String(e?.sh??""))?String(e.sh):"#1";return o+"?"+encodeURIComponent(s(t)+"#"+a+"="+r)+n}async function b(){let e=u();if(!e)return null;try{let t=await (0,i.decodeToken)(e);if(!t||"object"!=typeof t||!Array.isArray(t.s))return null;return t}catch{return null}}},{"./codec":"4JnOo","@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],"4JnOo":[function(e,t,r,o){var n=e("@parcel/transformer-js/src/esmodule-helpers.js");function i(e){return e.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}function a(e){let t=e.replace(/-/g,"+").replace(/_/g,"/");for(;t.length%4!=0;)t+="=";return t}async function l(e){let t=new Blob([new TextEncoder().encode(e)]).stream().pipeThrough(new CompressionStream("gzip"));var r=new Uint8Array(await new Response(t).arrayBuffer());let o="";for(let e=0;e<r.length;e+=32768)o+=String.fromCharCode(...Array.from(r.subarray(e,e+32768)));return i(btoa(o))}async function s(e){let t=new Blob([function(e){let t=atob(a(e)),r=new Uint8Array(t.length);for(let e=0;e<t.length;e++)r[e]=t.charCodeAt(e);return r}(e)]).stream().pipeThrough(new DecompressionStream("gzip")),r=await new Response(t).arrayBuffer();return new TextDecoder().decode(new Uint8Array(r))}async function c(e){let t=JSON.stringify(e),r=i(btoa(unescape(encodeURIComponent(t))));try{let e=await l(t),o="gz:"+e;if(o.length<r.length)return{token:o,mode:"gzip"}}catch{}return{token:r,mode:"plain"}}async function u(e){let t=e.trim();if(!t)throw Error("Empty token.");return t.startsWith("gz:")?JSON.parse(await s(t.slice(3))):JSON.parse(decodeURIComponent(escape(atob(a(t)))))}n.defineInteropFlag(r),n.export(r,"gzipCompressToBase64Url",()=>l),n.export(r,"gzipDecompressFromBase64Url",()=>s),n.export(r,"encodeToken",()=>c),n.export(r,"decodeToken",()=>u)},{"@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],"45Hu0":[function(e,t,r,o){var n=e("@parcel/transformer-js/src/esmodule-helpers.js");n.defineInteropFlag(r),n.export(r,"injectRuntimeCSS",()=>a),n.export(r,"applyCourseColors",()=>l),n.export(r,"applyThemeColors",()=>s),n.export(r,"installFreezeBar",()=>u),n.export(r,"setFreezeBarState",()=>d),n.export(r,"setPageFrozen",()=>p),n.export(r,"reapplyContentLock",()=>b),n.export(r,"wireLiveBar",()=>g),n.export(r,"setLiveBarStatus",()=>h),n.export(r,"setLiveBarFrozen",()=>y),n.export(r,"copyLinkToClipboard",()=>v);let i="lia-submission-runtime-style";function a(){if(document.getElementById(i))return;let e=document.createElement("style");e.id=i,e.textContent=`
:root {
  --lia-submit-bg-rgb: 106, 92, 255;
  --lia-submit-fg: #ffffff;
  --lia-submit-border-on-theme: rgba(255,255,255,.34);
  --lia-submit-button-bg: rgba(255,255,255,.14);
  --lia-submit-note-bg: rgba(0,0,0,.14);
  --lia-course-bg: #ffffff;
  --lia-course-fg: #111111;
  --lia-course-border: rgba(0,0,0,.20);
  --lia-submit-input-bg: #ffffff;
  --lia-submit-input-fg: #111111;
  --lia-submit-input-border: rgba(0,0,0,.20);
  --lia-submit-placeholder: rgba(17,17,17,.65);
}

@media (prefers-color-scheme: dark) {
  :root {
    --lia-course-bg: #1a1a1e;
    --lia-course-fg: #f3f3f3;
    --lia-course-border: rgba(255,255,255,.20);
    --lia-submit-input-bg: #1f1f24;
    --lia-submit-input-fg: #f3f3f3;
    --lia-submit-input-border: rgba(255,255,255,.20);
    --lia-submit-placeholder: rgba(243,243,243,.60);
  }
}

/* \u{2500}\u{2500} Submit box (live @Abgabe slide) \u{2500}\u{2500} */
.lia-submit-box {
  margin-top: 1.25rem;
  padding: 1rem;
  border: 1px solid var(--lia-submit-border-on-theme);
  border-radius: 14px;
  background: rgb(var(--lia-submit-bg-rgb));
  color: var(--lia-submit-fg);
  box-shadow: 0 10px 26px rgba(0,0,0,.14);
}
.lia-submit-box label {
  display: block;
  font-weight: 700;
  margin: .7rem 0 .25rem 0;
}
.lia-submit-box input[type="text"],
.lia-submit-box textarea {
  text-align: left !important;
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: .78rem .95rem;
  border-radius: 10px;
  line-height: 1.4;
  outline: none;
  background: var(--lia-course-bg);
  color: var(--lia-course-fg) !important;
  -webkit-text-fill-color: var(--lia-course-fg) !important;
  caret-color: var(--lia-course-fg);
  border: 1px solid var(--lia-course-border);
  opacity: 1;
}
.lia-submit-box input[type="text"]:read-only,
.lia-submit-box textarea:read-only,
.lia-submit-box input[type="text"]:disabled,
.lia-submit-box textarea:disabled {
  color: var(--lia-course-fg) !important;
  -webkit-text-fill-color: var(--lia-course-fg) !important;
  opacity: 1;
}
.lia-submit-box input::placeholder,
.lia-submit-box textarea::placeholder {
  color: color-mix(in srgb, var(--lia-course-fg) 65%, transparent);
  -webkit-text-fill-color: color-mix(in srgb, var(--lia-course-fg) 65%, transparent);
}
.lia-submit-box textarea { min-height: 110px; resize: vertical; }
.lia-submit-box button {
  margin-top: 1rem;
  padding: .78rem 1.05rem;
  border-radius: 10px;
  cursor: pointer;
  font-size: 2.25rem;
  font-weight: 700;
  background: var(--lia-submit-button-bg);
  color: var(--lia-submit-fg);
  border: 1px solid var(--lia-submit-border-on-theme);
}
.lia-submit-box button:disabled { opacity: .82; cursor: not-allowed; }
.lia-submit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: .75rem;
  margin-top: 1rem;
  justify-content: flex-start;
}
.lia-submit-actions button { margin-top: 0; flex: 0 0 320px; width: 320px; max-width: 100%; }

#lia-status { margin-top: .85rem; font-weight: 700; }

.lia-frozen-note {
  display: none;
  margin-top: 1rem;
  padding: .8rem 1rem;
  border-radius: 10px;
  border: 1px solid var(--lia-submit-border-on-theme);
  background: var(--lia-submit-note-bg);
  color: var(--lia-submit-fg);
}
body.lia-course-frozen .lia-frozen-note { display: block; }

/* \u{2500}\u{2500} Freeze nav bar (shared-link mode) \u{2500}\u{2500} */
#lia-freeze-bar {
  display: none;
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: min(1180px, calc(100vw - 16px));
  box-sizing: border-box;
  z-index: 99999;
  padding: .62rem .85rem;
  border-radius: 0 0 14px 14px;
  background: rgb(var(--lia-submit-bg-rgb));
  color: var(--lia-submit-fg);
  border: 1px solid var(--lia-submit-border-on-theme);
  box-shadow: 0 10px 26px rgba(0,0,0,.14);
}
body.lia-snapshot-mode #lia-freeze-bar { display: block; }

#lia-freeze-bar-inner {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: .9rem;
}
.lia-freeze-nav-group { display: flex; align-items: center; gap: .45rem; }
#lia-freeze-center {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
#lia-freeze-head {
  font-weight: 800;
  font-size: 1rem;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
#lia-freeze-bar button {
  width: 46px;
  height: 46px;
  min-width: 46px;
  padding: 0;
  border-radius: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--lia-submit-button-bg);
  color: var(--lia-submit-fg);
  border: 1px solid var(--lia-submit-border-on-theme);
}
#lia-freeze-bar button:disabled { opacity: .55; cursor: not-allowed; }
.lia-freeze-icon { width: 28px; height: 28px; display: block; pointer-events: none; }

/* \u{2500}\u{2500} Freeze info banner (shared-link mode, sticky) \u{2500}\u{2500} */
#lia-freeze-info {
  display: none;
  position: sticky;
  top: 0;
  z-index: 50;
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 1rem 0;
  padding: .8rem 1rem;
  border-radius: 12px;
  font-weight: 700;
  background: rgb(var(--lia-submit-bg-rgb));
  color: var(--lia-submit-fg);
  border: 1px solid var(--lia-submit-border-on-theme);
  box-shadow: 0 10px 26px rgba(0,0,0,.14);
}
body.lia-snapshot-mode #lia-freeze-info { display: block !important; }

/* \u{2500}\u{2500} Content lock (applies only inside the slide content area) \u{2500}\u{2500} */
.lia-frozen-scope button,
.lia-frozen-scope input,
.lia-frozen-scope select,
.lia-frozen-scope textarea,
.lia-frozen-scope a,
.lia-frozen-scope summary,
.lia-frozen-scope [role="button"],
.lia-frozen-scope [contenteditable="true"] {
  pointer-events: none !important;
  cursor: not-allowed !important;
}
.lia-frozen-scope .lia-annot-toolbar,
.lia-frozen-scope .lia-annot-toolbar * { pointer-events: auto !important; }
.lia-frozen-scope .lia-annot-toolbar button,
.lia-frozen-scope .lia-annot-toolbar [role="button"] { cursor: pointer !important; }
.lia-frozen-scope #lia-copy-link { pointer-events: auto !important; cursor: pointer !important; }
.lia-frozen-scope #lia-link {
  pointer-events: auto !important;
  cursor: text !important;
  user-select: text !important;
}

/* \u{2500}\u{2500} Static quiz freeze \u{2500}\u{2500} */
.lia-frozen-static-quiz {
  display: block;
}
.lia-frozen-static-quiz * {
  pointer-events: none !important;
}

/* \u{2500}\u{2500} @ADetails scoring badges \u{2500}\u{2500} */
.lia-adetails-points {
  display: inline-flex;
  align-items: center;
  gap: .28rem;
  margin-left: .7rem;
  font-weight: 700;
  white-space: nowrap;
  opacity: .92;
  color: inherit;
  pointer-events: none !important;
}
.lia-adetails-award-input {
  width: 3.2em;
  box-sizing: border-box;
  padding: .10rem .28rem;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, rgb(var(--lia-submit-bg-rgb)) 55%, var(--lia-course-fg) 45%);
  background: color-mix(in srgb, rgb(var(--lia-submit-bg-rgb)) 99%, var(--lia-course-bg) 1%);
  color: #ffffff !important;
  -webkit-text-fill-color: #ffffff !important;
  caret-color: #ffffff;
  font: inherit;
  font-weight: 700;
  text-align: center;
}
body.lia-shared-freeze-link .lia-frozen-scope .lia-adetails-award-input {
  pointer-events: auto !important;
  cursor: text !important;
  user-select: text !important;
}
`.trim(),(document.head||document.documentElement).appendChild(e)}function l(){let e=document.querySelector(".lia-slide.active .lia-slide__content")??document.querySelector(".lia-slide.current .lia-slide__content")??document.querySelector("main.lia-slide__content")??document.querySelector(".lia-content")??document.querySelector("main")??document.body,t="",r="";for(;e&&e!==document.documentElement;){let o=getComputedStyle(e),n=o.backgroundColor;if(n&&"transparent"!==n&&"rgba(0, 0, 0, 0)"!==n){t=n,r=o.color;break}e=e.parentElement}t||(t=getComputedStyle(document.body).backgroundColor||"rgb(255,255,255)",r=getComputedStyle(document.body).color||"rgb(17,17,17)");let o=r.match(/\d+(\.\d+)?/g)||[],n=o.length>=3?`rgba(${o[0]},${o[1]},${o[2]},0.22)`:"rgba(0,0,0,0.22)",i=document.documentElement;i.style.setProperty("--lia-course-bg",t),i.style.setProperty("--lia-course-fg",r),i.style.setProperty("--lia-course-border",n)}function s(){let e=(getComputedStyle(document.body).getPropertyValue("--color-highlight")||getComputedStyle(document.documentElement).getPropertyValue("--color-highlight")).trim().match(/\d+(\.\d+)?/g)||[];if(e.length<3)return;let[t,r,o]=[Number(e[0]),Number(e[1]),Number(e[2])],n=.2126*t+.7152*r+.0722*o>160,i=document.documentElement;i.style.setProperty("--lia-submit-bg-rgb",`${t}, ${r}, ${o}`),i.style.setProperty("--lia-submit-fg",n?"#111111":"#ffffff"),i.style.setProperty("--lia-submit-border-on-theme",n?"rgba(0,0,0,.24)":"rgba(255,255,255,.34)"),i.style.setProperty("--lia-submit-button-bg",n?"rgba(255,255,255,.38)":"rgba(255,255,255,.14)"),i.style.setProperty("--lia-submit-note-bg",n?"rgba(255,255,255,.30)":"rgba(0,0,0,.14)")}let c=null;function u(e){if(c=e,document.getElementById("lia-freeze-bar"))return;let t=document.createElement("div");function r(e,r){let o=t.querySelector("#"+e);o&&o.addEventListener("click",e=>{e.preventDefault(),e.stopPropagation(),r()},!0)}t.id="lia-freeze-bar",t.innerHTML='<div id="lia-freeze-bar-inner"><div id="lia-freeze-nav-left" class="lia-freeze-nav-group"><button id="lia-freeze-first" type="button" aria-label="First slide"><svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon"><path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/><rect x="-1.8" y="4" width="2.6" height="16" rx="1.3" fill="currentColor"/></svg></button><button id="lia-freeze-prev" type="button" aria-label="Previous slide"><svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon"><path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/><rect x="10.2" y="10.6" width="10.8" height="2.8" rx="1.4" fill="currentColor"/></svg></button></div><div id="lia-freeze-center"><div id="lia-freeze-head"></div></div><div id="lia-freeze-nav-right" class="lia-freeze-nav-group"><button id="lia-freeze-next" type="button" aria-label="Next slide"><svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon" style="transform:scaleX(-1)"><path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/><rect x="10.2" y="10.6" width="10.8" height="2.8" rx="1.4" fill="currentColor"/></svg></button><button id="lia-freeze-last" type="button" aria-label="Go to evaluation slide"><svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon" style="transform:scaleX(-1)"><path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/><rect x="-1.8" y="4" width="2.6" height="16" rx="1.3" fill="currentColor"/></svg></button></div></div>',document.body.appendChild(t),r("lia-freeze-first",()=>c?.onFirst()),r("lia-freeze-prev",()=>c?.onPrev()),r("lia-freeze-next",()=>c?.onNext()),r("lia-freeze-last",()=>c?.onEval())}function d(e){let t=document.getElementById("lia-freeze-bar");if(!t)return;let r=t.querySelector("#lia-freeze-head");if(r){let t=[];e.slideTitle&&t.push(e.slideTitle),t.push(e.slidePos),r.textContent=t.join(" · ")}let o=(e,r)=>{let o=t.querySelector("#"+e);o&&(o.disabled=!r)};o("lia-freeze-first",e.canFirst),o("lia-freeze-prev",e.canPrev),o("lia-freeze-next",e.canNext),o("lia-freeze-last",e.canEval);let n=t.offsetHeight||64;document.body.style.paddingTop=n+10+"px",document.documentElement.style.scrollPaddingTop=n+10+"px"}function f(){return document.querySelector("main.lia-slide__content")??document.querySelector(".lia-content")??document.querySelector("main")??document.querySelector("article")??null}function p(e,t=!1){let r=document.body;if(r)if(r.classList.toggle("lia-course-frozen",e),r.classList.toggle("lia-snapshot-mode",e),r.classList.toggle("lia-shared-freeze-link",e&&t),e){let e=f();e&&e.classList.add("lia-frozen-scope"),setTimeout(m,120)}else document.querySelectorAll(".lia-frozen-scope").forEach(e=>{e.classList.remove("lia-frozen-scope")})}function m(){let e=f();e&&e.querySelectorAll("input, textarea, select, button, [role='button'], [contenteditable='true']").forEach(e=>{if(!(e.closest("#lia-freeze-bar")||e.closest(".lia-submit-box")||e.closest(".lia-annot-toolbar"))&&"lia-link"!==e.id&&"lia-copy-link"!==e.id){try{e.disabled=!0}catch(e){}try{e.readOnly=!0}catch(e){}e.setAttribute("tabindex","-1")}})}function b(){if(!document.body.classList.contains("lia-course-frozen"))return;document.querySelectorAll(".lia-frozen-scope").forEach(e=>{e.classList.remove("lia-frozen-scope")});let e=f();e&&e.classList.add("lia-frozen-scope"),setTimeout(m,120)}function g(e){document.addEventListener("click",t=>{let r=t.target;if(r instanceof Element&&r.closest("#lia-create-link")){if(document.body.classList.contains("lia-snapshot-mode")){t.preventDefault(),t.stopPropagation();return}t.preventDefault(),t.stopPropagation(),e.onCreateLink()}},!0),document.addEventListener("click",t=>{let r=t.target;r instanceof Element&&r.closest("#lia-copy-link")&&(t.preventDefault(),t.stopPropagation(),e.onCopyLink())},!0)}function h(e){let t=document.getElementById("lia-status");t&&(t.textContent=e)}function y(e,t){let r=document.getElementById("lia-name"),o=document.getElementById("lia-link"),n=document.getElementById("lia-create-link"),i=document.getElementById("lia-copy-link"),a=document.getElementById("lia-frozen-note");r&&(r.value=t,r.disabled=!0),n&&(n.disabled=!0,n.textContent="Submission frozen"),o&&(o.value=e,o.disabled=!1,o.readOnly=!0,o.style.pointerEvents="auto",o.style.userSelect="text"),i&&(i.disabled=!e),h("Submission link created."),a&&(a.style.display="block",a.innerHTML="This is a <strong>frozen submission</strong>. Tasks and inputs are locked. The table of contents, display mode, and layout can still be used.")}async function v(e){if(!e)return!1;if(navigator.clipboard&&"function"==typeof navigator.clipboard.writeText&&window.isSecureContext)try{return await navigator.clipboard.writeText(e),!0}catch(e){}let t=document.createElement("textarea");t.value=e,t.setAttribute("aria-hidden","true"),t.style.cssText="position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none;font-size:16px",document.body.appendChild(t);let r=!1;try{t.focus({preventScroll:!0}),t.select(),t.setSelectionRange(0,e.length),r=document.execCommand("copy")}catch(e){}return t.remove(),r}},{"@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],cUIxA:[function(e,t,r,o){var n=e("@parcel/transformer-js/src/esmodule-helpers.js");function i(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function a(e){return String(e||"").trim().replace(/\s+/g," ")}function l(e){return e.replace(/^\s*<!--[\s\S]*?-->\s*/,"")}function s(e,t){let r=l(e).split(/\r?\n/),o=!1,n="";for(let e=0;e<r.length;e++){let i=r[e].match(/^\s*(```+|~~~+)/);if(i){let e=i[1].charAt(0);if(!o){o=!0,n=e;continue}if(e===n){o=!1,n="";continue}}o||t(r[e],e)}}function c(e){let t={trackF12:!1,trackTab:!1};return s(e,e=>{var r;let o,n=e.match(/^\s*@Auswertung(?:\s*\(([^)]*)\))?\s*$/);if(!n)return;let i=(r=n[1]||"",o={trackF12:!1,trackTab:!1},a(r).split(/[;,]/).forEach(e=>{let t=a(e);/^f12$/i.test(t)&&(o.trackF12=!0),/^tab$/i.test(t)&&(o.trackTab=!0)}),o);i.trackF12&&(t.trackF12=!0),i.trackTab&&(t.trackTab=!0)}),t}n.defineInteropFlag(r),n.export(r,"parseEvaluationOptions",()=>c),n.export(r,"parseDeclaredSlides",()=>d),n.export(r,"parseSectionCount",()=>f),n.export(r,"parseAbgabeHash",()=>p),n.export(r,"parseEvaluationDeclarations",()=>m),n.export(r,"buildEvaluationStats",()=>h),n.export(r,"buildEvaluationStatsByTag",()=>y),n.export(r,"renderEvaluationSlide",()=>E);let u="Evaluation";function d(e){let t=[],r=!1,o=0,n=0;if(s(e,e=>{if(/^\s*@Auswertung(?:\s*\(([^)]*)\))?\s*$/.test(e)&&(r=!0,n=o+1),/^#{1,6}\s+/.test(e)){o++;let r=e.match(/^(#{1,2})\s+(.+?)\s*$/);r&&t.push({h:"#"+o,t:a(r[2])})}}),r){let e="#"+(n||o+1);t.push({h:e,t:u,vt:"evaluation"})}return t}function f(e){let t=0;return s(e,e=>{/^#{1,6}\s+/.test(e)&&t++}),t}function p(e){let t=0,r="";return s(e,e=>{if(!r){if(/^#{1,6}\s+/.test(e))return void t++;/^\s*@Abgabe(?:\s*\([^)]*\))?\s*$/.test(e)&&(r="#"+Math.max(1,t))}}),r}function m(e){let t=l(e).split(/\r?\n/),r=!1,o="",n=[],i=null;for(let e of t){let t=e.match(/^\s*(```+|~~~+)/);if(t){let e=t[1].charAt(0);if(!r){r=!0,o=e;continue}if(e===o){r=!1,o="";continue}}if(!r){if(/^#{1,6}\s+/.test(e)){i&&n.push(i),i=[];continue}i&&i.push(e)}}i&&n.push(i);let s=Object.create(null);return n.forEach((e,t)=>{let r=function(e){let t=[];function r(){let e={be:1,tg:[]};return t.push(e),e}function o(e){let t=a(e);return!(!t||/^\s*<!--/.test(t)||/^\s*@ADetails\b/.test(e)||/^\s*-\s+/.test(e)||/@(?:diktat|orthography|rectQuiz|circleQuiz|TextmarkerQuiz|ErzeugePunkt)\s*\(/.test(e))&&/\[\[|\[\->\[/.test(e)}for(let n=0;n<e.length;n++){let i=String(e[n]||""),l=a(i);if(!l||/^\s*<!--/.test(l))continue;let s=Array.from(i.matchAll(/@ADetails\s*\(([^)]*)\)/g));if(s.length){let e=t.length?t[t.length-1]:null;s.forEach(t=>(function(e,t){let r,o,n,i;if(!e)return;let l=(r=a(t),o=null,n=[],(i=r.split(/\s*;\s*/).filter(Boolean)).forEach((e,t)=>{let r=a(e),l=r.match(/^tags?\s*[:=]\s*(.+)$/i);if(l)return void l[1].split(",").map(e=>a(e)).filter(Boolean).forEach(e=>{n.includes(e)||n.push(e)});let s=r.match(/^(?:points?|be|punkte?)\s*[:=]\s*([\d.,]+)$/i);if(s){let e=Number(s[1].replace(",","."));Number.isFinite(e)&&e>=0&&null===o&&(o=e);return}let c=r.match(/^([\d.,]+)\s*=\s*[A-Za-z%]+$/);if(c){let e=Number(c[1].replace(",","."));Number.isFinite(e)&&e>=0&&null===o&&(o=e);return}let u=Number(r.replace(",","."));if(Number.isFinite(u)&&u>=0&&null===o){o=u;return}(t>=1||1===i.length)&&r.split(",").map(e=>a(e)).filter(Boolean).forEach(e=>{n.includes(e)||n.push(e)})}),{pointsValue:o,tags:n});null!==l.pointsValue&&(e.be=l.pointsValue),l.tags.forEach(t=>{t&&0>e.tg.indexOf(t)&&e.tg.push(t)})})(e,t[1]||""));continue}let c=e=>/^\s*-\s+/.test(e)&&/(\[\[|\[\()/.test(e)||/^\s{2,}\[[\[( ]/.test(e);if(c(i)){for(r();n+1<e.length&&c(String(e[n+1]||""));)n++;continue}if(/@diktat\s*\(/.test(i)){for(r();n+1<e.length;){let t=String(e[n+1]||"");if(!a(t)||/^\s*@ADetails\b/.test(t)||!/@diktat\s*\(/.test(t))break;n++}continue}let u=i.match(/@orthography\s*\(/g)||[];if(u.forEach(()=>r()),u.length)continue;let d=i.match(/@(?:rectQuiz|circleQuiz|TextmarkerQuiz|ErzeugePunkt)\b/g)||[];if(d.forEach(()=>r()),!d.length&&o(i)){for(r();n+1<e.length;){let t=String(e[n+1]||""),r=a(t);if(!r||/^\s*@ADetails\b/.test(t)||/^\s*<!--/.test(r)){if(/^\s*<!--/.test(r)){n++;continue}break}if(!o(t))break;n++}continue}}return t}(e),o=Object.create(null),n=0,i=r.map(e=>{let t=Math.max(0,e.be);return n+=t,e.tg.forEach(e=>{o[e]||(o[e]={total:0,tasks:0}),o[e].total+=t,o[e].tasks+=1}),{be:t,tg:e.tg.slice()}});s["#"+(t+1)]={tt:i.length,tb:n,tg:o,tl:i}}),s}function b(e){let t=Number(e.solved);return 1===t?"correct":-1===t?"resolved":Number(e.trial||0)>0?"wrong":""}function g(e){let t=[];for(let r of e.s)if(r.quiz)for(let[e,o]of Object.entries(r.quiz)){let r=Number(e);(Array.isArray(o)?o:[]).forEach((e,o)=>{e&&"object"==typeof e&&t.push({hash:"#"+(r+1),idx:o+1,el:e})})}return t}function h(e,t){let r={total:0,correct:0,wrong:0,resolved:0,notMade:0};for(let e of Object.values(t))r.total+=e.tb;let o=g(e);if(r.total>0)for(let{hash:e,idx:n,el:i}of o){let o=t[e],a=o?.tl[n-1],l=a?a.be:1,s=b(i);"correct"===s?r.correct+=l:"wrong"===s?r.wrong+=l:"resolved"===s&&(r.resolved+=l)}else for(let{el:e}of o){r.total+=1;let t=b(e);"correct"===t?r.correct+=1:"wrong"===t?r.wrong+=1:"resolved"===t&&(r.resolved+=1)}return r.notMade=Math.max(0,r.total-r.correct-r.wrong-r.resolved),r}function y(e,t){let r=Object.create(null);for(let e of Object.values(t))for(let[t,o]of Object.entries(e.tg))r[t]||(r[t]={tag:t,total:0,tasks:0,correct:0,wrong:0,resolved:0}),r[t].total+=o.total,r[t].tasks+=o.tasks;for(let{hash:o,idx:n,el:i}of g(e)){let e=t[o],a=e?.tl[n-1];if(!a||!a.tg.length)continue;let l=a.be,s=b(i);for(let e of a.tg)r[e]||(r[e]={tag:e,total:0,tasks:0,correct:0,wrong:0,resolved:0}),r[e].total<=0&&(r[e].total+=l,r[e].tasks+=1),"correct"===s?r[e].correct+=l:"wrong"===s?r[e].wrong+=l:"resolved"===s&&(r[e].resolved+=l)}return Object.keys(r).sort((e,t)=>e.localeCompare(t,void 0,{sensitivity:"base"})).map(e=>r[e])}function v(e){return"correct"===e?"rgb(25, 135, 84)":"wrong"===e?"rgb(220, 53, 69)":"resolved"===e?"rgb(108, 117, 125)":"var(--lia-course-fg)"}function w(e,t){return String(Math.round(10*(t>0?e/t*100:0))/10).replace(".",",")}function x(e,t,r){let o=v(r);return['<div style="padding:1rem 1.05rem;border-radius:12px;border:1px solid var(--lia-course-border);background:var(--lia-course-bg);color:var(--lia-course-fg);">','<div style="font-size:3rem;opacity:.98;font-weight:700;margin-bottom:.35rem;color:',o,';">',i(e),"</div>",'<div style="font-size:5rem;line-height:1;font-weight:800;color:',o,';">',i(String(t)),"</div>","</div>"].join("")}function k(e,t,r){let o="neutral"===r?"var(--lia-course-fg)":v(r);return['<div style="padding:1rem 1.05rem;border-radius:12px;border:1px solid var(--lia-course-border);background:var(--lia-course-bg);color:var(--lia-course-fg);min-width:150px;box-sizing:border-box;">','<div style="font-size:1.2rem;opacity:.98;font-weight:700;margin-bottom:.35rem;color:',o,';">',i(e),"</div>",'<div style="font-size:2.5rem;line-height:1.05;font-weight:800;color:',o,';">',i(String(t)),"</div>","</div>"].join("")}function z(e){let t=w(e.correct,e.total);return['<div style="margin-top:1.2rem;padding:1rem 1.05rem;border-radius:14px;border:1px solid var(--lia-course-border);background:color-mix(in srgb, var(--lia-course-bg) 94%, black 6%);">','<div style="font-weight:800;font-size:3.0rem;line-height:1.2;margin-bottom:.8rem;color:var(--lia-course-fg);">',i(e.tag),"</div>",'<div style="overflow-x:auto;">','<div style="display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:.75rem;min-width:820px;">',k("Correct",e.correct,"correct"),k("Wrong",e.wrong,"wrong"),k("Resolved",e.resolved,"resolved"),k("Achieved",e.correct+" of "+e.total,"neutral"),k("Score",t+"%","neutral"),"</div>","</div>","</div>"].join("")}function S(e,t){if(t<=0)return"";let r=v("wrong");return['<div style="margin-top:.85rem;font-weight:800;font-size:2.35rem;padding:1rem 1.05rem;border-radius:12px;',"border:1px solid ",r,";","background:color-mix(in srgb, ",r," 12%, var(--lia-course-bg) 88%);","color:",r,';">',i("f12"===e?"Fraud attempt detected: DevTools (F12) were opened during the exam.":"Fraud attempt detected: The tab or window was left during the exam."),"</div>"].join("")}function E(e){let{payload:t,evalDecl:r,title:o,name:n}=e,a=h(t,r),l=y(t,r),s=w(a.correct,a.total),c=t.sec,d=c?.trackF12?S("f12",c.f12):"",f=c?.trackTab?S("tab",c.tab):"",p=n?"Name: "+i(n)+"<br>Summary of the frozen submission":"Summary of the frozen submission",m=l.length?['<div style="margin-top:1.35rem;">','<div style="font-weight:800;font-size:2rem;line-height:1.2;margin-bottom:.2rem;">Evaluation by Tags</div>','<div style="opacity:.82;margin-bottom:.8rem;">Each tag shows its own partial result.</div>',l.map(z).join(""),"</div>"].join(""):"";return['<div style="font-weight:800;font-size:4.35rem;line-height:1.2;margin-bottom:.6rem;">',i(o||u),"</div>",'<div style="margin-bottom:1rem;opacity:0.92;font-weight:700;">',p,"</div>",'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.85rem;margin-bottom:1rem;">',x("Correct",a.correct,"correct"),x("Wrong",a.wrong,"wrong"),x("Resolved",a.resolved,"resolved"),x("Not done",a.notMade,"neutral"),"</div>",'<div style="font-weight:800;font-size:2.35rem;padding:1rem 1.05rem;border-radius:12px;border:1px solid var(--lia-course-border);background:var(--lia-course-bg);color:var(--lia-course-fg);">',i(String(a.correct))," of ",i(String(a.total))," points achieved. <br>&nbsp;&nbsp;&nbsp; <strong><big><big><big><big>",i(s),"%</big></big></big></big></strong>.<br>",'<span style="opacity:.82;">Based on the quiz states stored in the freeze snapshot.</span>',"</div>",d,f,m].join("")}},{"@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],hn3mm:[function(e,t,r,o){var n=e("@parcel/transformer-js/src/esmodule-helpers.js");n.defineInteropFlag(r),n.export(r,"getSecurityState",()=>b),n.export(r,"installF12Tracking",()=>z),n.export(r,"installTabTracking",()=>S);let i={f12:0,tab:0},a=!1,l=!1,s=!1,c=-1,u=-1,d=-1,f=!1,p=!1,m=0;function b(){return{f12:i.f12,tab:i.tab}}function g(){return!!document.body?.classList.contains("lia-snapshot-mode")}function h(){let e=window;try{for(;e.parent&&e.parent!==e;)e=e.parent}catch(e){}return e}function y(){let e=String(navigator.platform||""),t=String(navigator.userAgent||""),r=Number(navigator.maxTouchPoints||0),o=/iPad|iPhone|iPod/.test(e)||/iPad|iPhone|iPod/.test(t),n="MacIntel"===e&&r>1;return o||n}function v(){if(y())return!1;let e=Math.abs((window.outerWidth||0)-(window.innerWidth||0)),t=Math.abs((window.outerHeight||0)-(window.innerHeight||0));if(e>170||t>170)return!0;try{if(window.Firebug?.chrome?.isInitialized)return!0}catch(e){}return!1}function w(e,t){if(!(c>=0&&40>=Math.abs(t-c))){if("devtools-open"===e&&u>=0&&t>=u&&t-u<=1200){c=t;return}c=t,i.f12+=1}}function x(e){d>=0&&500>=Math.abs(e-d)||(d=e,i.tab+=1)}function k(){!g()&&!p&&function(){let e=!0,t=!0;try{e="hidden"!==document.visibilityState}catch(e){}try{t="function"!=typeof document.hasFocus||document.hasFocus()}catch(e){}return e&&t}()&&(p=!0)}function z(e){if(a)return;a=!0;let t=h();if(Array.from(new Set([window,document,document.documentElement,document.body,t,t.document].filter(Boolean))).forEach(t=>{t?.addEventListener&&t.addEventListener("keydown",t=>{if(g()||"F12"!==t.key&&"F12"!==t.code&&(t.keyCode??t.which)!==123||t.repeat)return;let r=Math.round(t.timeStamp||Date.now());u=r,w("keydown",r),e?.()},!0)}),!s&&!y()){function r(){if(g())return;let t=v();t&&!f&&(w("devtools-open",Date.now()),e?.()),f=t}s=!0,(f=v())&&!g()&&(w("devtools-open-initial",Date.now()),e?.()),window.addEventListener("resize",()=>setTimeout(r,60),!0),window.addEventListener("focus",()=>setTimeout(r,60),!0),window.setInterval(r,700)}}function S(e){if(l)return;l=!0;let t=h(),r=Array.from(new Set([window,t].filter(Boolean)));Array.from(new Set([document,t.document].filter(Boolean))).forEach(t=>{t?.addEventListener&&t.addEventListener("visibilitychange",t=>{if(g())return;let r=t.currentTarget&&"visibilityState"in t.currentTarget?t.currentTarget:document;"visible"===r.visibilityState?k():"hidden"===r.visibilityState&&p&&(x(Date.now()),e?.())},!0)}),r.forEach(e=>{e?.addEventListener&&(e.addEventListener("focus",()=>k(),!0),e.addEventListener("pageshow",()=>k(),!0),e.addEventListener("blur",()=>void(!g()&&p&&(clearTimeout(m),m=window.setTimeout(()=>{if(g()||!p)return;let e=!1,t=!1;try{e="hidden"===document.visibilityState}catch(e){}try{t="function"!=typeof document.hasFocus||!document.hasFocus()}catch(e){}(e||t)&&x(Date.now())},80))),!0))}),setTimeout(()=>k(),250)}},{"@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}]},["8RSWf"],"8RSWf","parcelRequire3339",{});
//# sourceMappingURL=index.js.map
