!function(e,t,r,n,o){var i="u">typeof globalThis?globalThis:"u">typeof self?self:"u">typeof window?window:"u">typeof global?global:{},a="function"==typeof i[n]&&i[n],l=a.i||{},s=a.cache||{},c="u">typeof module&&"function"==typeof module.require&&module.require.bind(module);function u(t,r){if(!s[t]){if(!e[t]){if(o[t])return o[t];var l="function"==typeof i[n]&&i[n];if(!r&&l)return l(t,!0);if(a)return a(t,!0);if(c&&"string"==typeof t)return c(t);var d=Error("Cannot find module '"+t+"'");throw d.code="MODULE_NOT_FOUND",d}m.resolve=function(r){var n=e[t][1][r];return null!=n?n:r},m.cache={};var f=s[t]=new u.Module(t);e[t][0].call(f.exports,m,f,f.exports,i)}return s[t].exports;function m(e){var t=m.resolve(e);if(!1===t)return{};if(Array.isArray(t)){var r={__esModule:!0};return t.forEach(function(e){var t=e[0],n=e[1],o=e[2]||e[0],i=u(n);"*"===t?Object.keys(i).forEach(function(e){"default"===e||"__esModule"===e||Object.prototype.hasOwnProperty.call(r,e)||Object.defineProperty(r,e,{enumerable:!0,get:function(){return i[e]}})}):"*"===o?Object.defineProperty(r,t,{enumerable:!0,value:i}):Object.defineProperty(r,t,{enumerable:!0,get:function(){return"default"===o?i.__esModule?i.default:i:i[o]}})}),r}return u(t)}}u.isParcelRequire=!0,u.Module=function(e){this.id=e,this.bundle=u,this.require=c,this.exports={}},u.modules=e,u.cache=s,u.parent=a,u.distDir=void 0,u.publicUrl=void 0,u.devServer=void 0,u.i=l,u.register=function(t,r){e[t]=[function(e,t){t.exports=r},{}]},Object.defineProperty(u,"root",{get:function(){return i[n]}}),i[n]=u;for(var d=0;d<t.length;d++)u(t[d]);if(r){var f=u(r);"object"==typeof exports&&"u">typeof module?module.exports=f:"function"==typeof define&&define.amd&&define(function(){return f})}}({"8RSWf":[function(e,t,r,n){var o=e("./port"),i=e("./snapshot"),a=e("./url"),l=e("./freeze-ui"),s=e("./evaluation"),c=e("./security");let u=[],d=Object.create(null),f={trackF12:!1,trackTab:!1,trackTime:!1},m="",p=0,b=null,g=null,h="",y="",v=!1,x={enabled:!1,durationMinutes:0,triggerHash:""},w=0,k=0,z=!1,S=0,E=0,_={},T=0,C="";function j(){if(!C||!T)return;let e=Date.now()-T;_[C]=(_[C]??0)+e,T=0,C=""}function A(e){C=e,T=Date.now()}function I(){let e=document.getElementById("lia-exam-countdown");return e||((e=document.createElement("div")).id="lia-exam-countdown",document.body.appendChild(e)),e}function L(){if(!x.enabled||w<=0){I().style.display="none";return}let e=Math.max(0,k-Date.now()),t=Math.ceil(e/1e3),r=String(Math.floor(t/60)).padStart(2,"0"),n=String(t%60).padStart(2,"0"),o=I();o.textContent="Time left: "+r+":"+n,o.style.display="block",function(){let e=document.getElementById("lia-exam-countdown");if(!e)return;let t=window.innerWidth<=700;e.style.right=t?"12px":"30px",e.style.bottom=t?"30px":"5px"}(),e<=0&&x.enabled&&!document.body.classList.contains("lia-snapshot-mode")&&(z=!0,S&&(clearInterval(S),S=0),I().style.display="none",m&&(window.location.hash=m),Q(),E||(E=window.setInterval(()=>{if(!z||document.body.classList.contains("lia-snapshot-mode"))return;let e=(0,a.getCurrentHash)();m&&e!==m&&(window.location.hash=m)},420)))}function F(){if(!x.enabled||document.body.classList.contains("lia-snapshot-mode")||z||w>0)return;let e=x.durationMinutes;Number.isFinite(e)&&!(e<=0)&&(k=(w=Date.now())+Math.round(6e4*e),S&&clearInterval(S),S=window.setInterval(L,1e3),L())}function O(){let e=document.querySelector(".lia-exam-name-input"),t=document.getElementById("lia-name");if(!e||!t)return;let r=e.value.trim(),n=t.value.trim();r&&!n&&(t.value=r),n&&!r&&(e.value=n)}let B=null;function P(){let e=function(){if(B)return B;let e=document.createElement("div");return e.id="lia-exam-overlay",document.body.appendChild(e),B=e,e}();e.innerHTML="",e.appendChild(function(){let e,t=(e=document.getElementById("lia-name"),e?.value.trim()??""),r=document.createElement("section");r.className="lia-exam-intro-virtual-slide",r.style.cssText="max-width:1200px;margin:0 auto;padding:1.5rem 1.6rem;border-radius:16px;border:1px solid color-mix(in srgb,#c1121f 55%,var(--lia-course-border) 45%);background:color-mix(in srgb,#c1121f 10%,var(--lia-course-bg) 90%);color:var(--lia-course-fg)",r.innerHTML='<h1 style="font-size:8rem;font-weight:900;line-height:1.05;margin:0 0 .9rem 0;color:#c1121f;">Exam</h1><p style="font-size:4.25rem;line-height:1.45;font-weight:700;margin:0;">Clicking "Start Exam" begins the working time of <strong><span style="color:#c1121f;">'+String(x.durationMinutes)+' minutes</span></strong>.</p><div style="margin-top:1.3rem;"><label style="display:block;font-size:4.25rem;font-weight:700;margin:0 0 .4rem 0;">Name</label><input class="lia-exam-name-input" type="text" placeholder="Enter your name" value="'+t.replace(/"/g,"&quot;")+'" style="width:100%;box-sizing:border-box;padding:.6rem .75rem;border-radius:10px;border:1px solid color-mix(in srgb,#c1121f 35%,var(--lia-course-border) 65%);background:var(--lia-course-bg);color:var(--lia-course-fg);font-size:4rem;"></div><button class="lia-exam-start-btn" type="button" style="margin-top:1.3rem;padding:.7rem 1.4rem;border-radius:10px;border:2px solid #c1121f;background:#c1121f;color:#fff;font-size:4rem;font-weight:800;cursor:pointer;">Start Exam</button>';let n=r.querySelector(".lia-exam-name-input");if(n){let e=()=>O();n.addEventListener("input",e),n.addEventListener("change",e)}let o=r.querySelector(".lia-exam-start-btn");return o&&o.addEventListener("click",()=>{let e,t;if(!n?.value.trim()){n&&(n.style.animation="none",n.style.border="2px solid #c1121f",n.style.outline="3px solid color-mix(in srgb,#c1121f 40%,transparent)",n.offsetWidth,n.style.animation="lia-exam-shake .35s ease",n.focus());return}O();let r=(e=parseInt(x.triggerHash.slice(1),10),t=u.filter(e=>!e.vt).find(t=>parseInt(t.h.slice(1),10)>e),t?.h??"#"+(e+1));window.location.hash=r}),r}()),e.style.display="flex"}function R(e,t){if(x.enabled&&!document.body.classList.contains("lia-snapshot-mode")){if(z){m&&e!==m&&setTimeout(()=>{window.location.hash=m},0);return}if(w<=0&&x.triggerHash&&t===x.triggerHash&&e!==x.triggerHash){if(!(document.querySelector(".lia-exam-name-input")?.value??"").trim())return void setTimeout(()=>{window.location.hash=x.triggerHash},0);O(),F()}B&&(B.style.display="none"),e===x.triggerHash&&w<=0&&setTimeout(P,180)}}function M(){return u.find(e=>"evaluation"===e.vt)}async function N(){let e=window.location.search;if(!e||"?"===e)return null;try{let t=decodeURIComponent(e.slice(1)),r=new URL(t,window.location.href);r.hash.startsWith("#submission=")&&(r.hash="");let n=await fetch(r.toString(),{cache:"no-store"});if(!n.ok)return null;return await n.text()}catch{return null}}async function H(){let e=await N();e&&(f=(0,s.parseEvaluationOptions)(e),u=(0,s.parseDeclaredSlides)(e),m=(0,s.parseAbgabeHash)(e),p=(0,s.parseSectionCount)(e),d=(0,s.parseEvaluationDeclarations)(e),x=(0,s.parseExamConfig)(e))}function q(){if(!b)return;let e=function(){if(g)return g;let e=document.createElement("div");return e.id="lia-eval-placeholder",e.style.cssText="display:none;position:fixed;left:50%;transform:translateX(-50%);width:min(920px,calc(100vw - 24px));max-height:calc(100vh - 120px);overflow-y:auto;z-index:9000;padding:1.1rem 1.2rem;box-sizing:border-box;border-radius:16px;box-shadow:0 10px 26px rgba(0,0,0,.14);background:rgb(var(--lia-submit-bg-rgb));color:var(--lia-submit-fg);border:1px solid var(--lia-submit-border-on-theme)",document.body.appendChild(e),g=e,e}(),t=M();e.innerHTML=(0,s.renderEvaluationSlide)({payload:b,evalDecl:d,title:t?.t,name:b.n,slides:u});let r=document.getElementById("lia-freeze-bar"),n=r?r.offsetHeight:64;for(let t of(e.style.top=n+12+"px",e.style.display="block",["main.lia-slide__content, .lia-content, main, article",".lia-submit-box"]))document.querySelectorAll(t).forEach(e=>{e.style.opacity="0",e.style.pointerEvents="none"})}function D(){for(let e of(g&&(g.style.display="none"),["main.lia-slide__content, .lia-content, main, article",".lia-submit-box"]))document.querySelectorAll(e).forEach(e=>{e.style.opacity="",e.style.pointerEvents=""})}function U(){let e,t=(0,a.getCurrentHash)(),r=(e=t.match(/^#(\d+)$/))?parseInt(e[1],10):1,n=u.filter(e=>!e.vt).length||1,o=u.find(e=>e.h===t),i=o?u.indexOf(o)+1:r,s=i<=1;(0,l.setFreezeBarState)({slideTitle:o?.t??"",slidePos:i+" / "+n,canFirst:!s,canPrev:!s,canNext:!(i>=n),canEval:!!M()})}let $="";function V(){let e;if(!v)return;let t=(0,a.getCurrentHash)(),r=$;$=t,(e=M())&&e.h===t?q():D(),setTimeout(l.reapplyContentLock,80),U(),R(t,r),O()}async function W(e){function t(e){D();let t=(0,a.getCurrentHash)(),r=u.filter(e=>!e.vt),n=r.findIndex(e=>e.h===t),o=n>=0?r[Math.max(0,Math.min(r.length-1,n+e))]:e<0?r[0]:r[r.length-1];o&&(window.location.hash=o.h)}b=e,(0,l.setPageFrozen)(!0,!0),(0,l.installFreezeBar)({onFirst:()=>{D();let e=u.find(e=>!e.vt);e&&(window.location.hash=e.h)},onPrev:()=>t(-1),onNext:()=>t(1),onEval:()=>{let e=M();e&&(window.location.hash=e.h,q())}}),window.addEventListener("hashchange",V),await H(),e.sec?.trackF12&&(0,c.installF12Tracking)(),e.sec?.trackTab&&(0,c.installTabTracking)(),(0,i.restoreSnapshot)(e);let r=M();window.location.hash=m||e.sh||"#1",r&&setTimeout(()=>q(),300),U()}async function X(){if((0,l.wireLiveBar)({onCreateLink:()=>{Q()},onCopyLink:()=>{let e=document.getElementById("lia-link"),t=e?.value??"";t&&(0,l.copyLinkToClipboard)(t).then(e=>(0,l.setLiveBarStatus)(e?"Link copied to clipboard.":"Copy failed — please copy manually."))}}),A($=(0,a.getCurrentHash)()),window.addEventListener("hashchange",()=>{let e=$,t=(0,a.getCurrentHash)();$=t,j(),A(t),setTimeout(l.reapplyContentLock,80),R(t,e),O()}),await H(),f.trackF12&&(0,c.installF12Tracking)(),f.trackTab&&(0,c.installTabTracking)(),x.enabled){let e=(0,a.getCurrentHash)();if(e===x.triggerHash)setTimeout(P,180);else if(w<=0){let t=parseInt(x.triggerHash.slice(1),10);parseInt((e||"#1").slice(1),10)>t&&F()}}}async function Q(){(0,l.setLiveBarStatus)("Creating submission link…");try{j();let e=p||u.length||30,t=await (0,i.captureSnapshot)(e),r=(0,c.getSecurityState)();if(t.sec={trackF12:+!!f.trackF12,trackTab:+!!f.trackTab,f12:r.f12,tab:r.tab},f.trackTime){let e={..._};Object.keys(e).length&&(t.slideTimeMs=e)}let n=document.getElementById("lia-name"),o=(n?.value??"").trim();o&&(t.n=o),S&&(clearInterval(S),S=0),I().style.display="none";let s=await (0,a.buildLink)(t);h=s,y=o,(0,l.setLiveBarFrozen)(s,o),b=t,(0,l.setPageFrozen)(!0,!1)}catch(e){(0,l.setLiveBarStatus)("Error: "+(e instanceof Error?e.message:String(e)))}}async function J(){let e;(0,l.injectRuntimeCSS)(),(e=new MutationObserver(()=>{if(!h)return;let t=document.getElementById("lia-link");t&&!t.value&&(!function(){if(!h)return;let e=document.getElementById("lia-name"),t=document.getElementById("lia-link"),r=document.getElementById("lia-create-link"),n=document.getElementById("lia-copy-link"),o=document.getElementById("lia-frozen-note");e&&(e.value=y,e.disabled=!0),r&&(r.disabled=!0,r.textContent="Submission frozen"),t&&(t.value=h,t.disabled=!1,t.readOnly=!0,t.style.pointerEvents="auto",t.style.userSelect="text"),n&&(n.disabled=!h),o&&(o.style.display="block")}(),e.disconnect())})).observe(document.body,{childList:!0,subtree:!0}),(0,l.applyThemeColors)(),(0,l.applyCourseColors)(),new MutationObserver(()=>{(0,l.applyThemeColors)(),(0,l.applyCourseColors)()}).observe(document.documentElement,{attributes:!0,attributeFilter:["class","style","data-theme"]});let t=history.pushState.bind(history),r=history.replaceState.bind(history);history.pushState=function(...e){let r=t(...e);return V(),r},history.replaceState=function(...e){let t=r(...e);return V(),t},(0,o.installPortIntercept)();let n=(0,a.getSubmissionToken)();n&&(0,a.storeToken)(n);let i=await (0,a.loadPayload)();i?await W(i):await X(),v=!0}function G(){J().catch(e=>console.error("[LIA-FREEZE]",e))}"loading"===document.readyState?document.addEventListener("DOMContentLoaded",G):setTimeout(G,0)},{"./port":"8E6Fn","./snapshot":"ahaMQ","./url":"hyyva","./freeze-ui":"45Hu0","./evaluation":"cUIxA","./security":"hn3mm"}],"8E6Fn":[function(e,t,r,n){var o=e("@parcel/transformer-js/src/esmodule-helpers.js");o.defineInteropFlag(r),o.export(r,"loadNativeState",()=>s),o.export(r,"sendRestoreEvent",()=>c),o.export(r,"installPortIntercept",()=>u);let i=["quiz","survey","code","task"];async function a(){let e="",t=window.location.search;if(t&&"?"!==t)try{let r=decodeURIComponent(t.slice(1)),n=new URL(r,window.location.href);String(n.hash).startsWith("#submission=")&&(n.hash=""),e=n.toString()}catch{e=t.slice(1)}try{let t=await indexedDB.databases(),r=t.find(t=>t.name===e);if(r?.name)return r.name;if(e){let r="";try{r=new URL(e).pathname}catch{r=e}let n=t.find(e=>{if(!e.name)return!1;try{return new URL(e.name).pathname===r}catch{return!1}});if(n?.name)return n.name;let o=r.split("/").pop()??"";if(o){let e=t.find(e=>e.name?.includes(o));if(e?.name)return e.name}}return e}catch{return e}}function l(e){let t={};for(let r of e){let e=Number(r.id);(!t[e]||r.version>t[e].version)&&(t[e]={version:r.version,data:r.data})}let r={};for(let[e,n]of Object.entries(t))r[Number(e)]=n.data;return r}async function s(){let e,t=await a(),r={quiz:{},survey:{},code:{},task:{}};if(!t)return r;try{e=await new Promise((e,r)=>{let n=indexedDB.open(t);n.onsuccess=()=>e(n.result),n.onerror=()=>r(n.error),n.onblocked=()=>r(Error("IDB blocked")),n.onupgradeneeded=()=>{n.transaction.abort(),r(Error("IDB does not exist yet"))}})}catch{return r}try{let t=await Promise.all(i.map(t=>{var r;return r=e,new Promise((e,n)=>{if(!r.objectStoreNames.contains(t))return void e([]);try{let o=r.transaction(t,"readonly").objectStore(t).getAll();o.onsuccess=()=>e(o.result??[]),o.onerror=()=>n(o.error)}catch(t){e([])}})}));return e.close(),{quiz:l(t[0]),survey:l(t[1]),code:l(t[2]),task:l(t[3])}}catch{return e.close(),r}}function c(e,t,r){window.LIA.send({reply:!0,track:[[e,t]],service:"db",message:{cmd:"load",param:{table:e,id:t,data:r}}})}function u(){}},{"@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],k3151:[function(e,t,r,n){r.interopDefault=function(e){return e&&e.__esModule?e:{default:e}},r.defineInteropFlag=function(e){Object.defineProperty(e,"__esModule",{value:!0})},r.exportAll=function(e,t){return Object.keys(e).forEach(function(r){"default"===r||"__esModule"===r||Object.prototype.hasOwnProperty.call(t,r)||Object.defineProperty(t,r,{enumerable:!0,get:function(){return e[r]}})}),t},r.export=function(e,t,r){Object.defineProperty(e,t,{enumerable:!0,get:r})}},{}],ahaMQ:[function(e,t,r,n){var o=e("@parcel/transformer-js/src/esmodule-helpers.js");o.defineInteropFlag(r),o.export(r,"PAYLOAD_VERSION",()=>l),o.export(r,"captureSnapshot",()=>c),o.export(r,"restoreSnapshot",()=>u);var i=e("./port"),a=e("./url");let l="sf-mini-ti-4";async function s(){return(0,i.loadNativeState)()}async function c(e){let t=await s(),r=function(){try{let e=window.__LIA_CANVAS_OCR__?.freeze;if(!e?.exportAllCanvasFreezeStatesFromRoot)return[];return e.exportAllCanvasFreezeStatesFromRoot(document)}catch{return[]}}(),n=function(){try{let e=window.__LIA_TEXTMARKER_REG_V4__;if(!e)return[];let t=document.baseURI||location.href;return e.instances[t]?.HL??[]}catch{return[]}}(),o=function(){try{return window.__ORTHOGRAPHY_EXPORT_V8__?.getAllStates?.()??{}}catch{return{}}}(),i=function(){try{let e=window.__LIA_FRACTION_QUIZ__;if(!e)return{};let t=e.getAllWidgets(),r={};for(let e of Object.keys(t))r[e]=t[e];return r}catch{return{}}}(),c=function(){try{let e=window.__coord?.getBoardStateStore?.()??window.__coordBoardStates??{};return JSON.parse(JSON.stringify(e))}catch{return{}}}(),u=function(){try{return window.__LIA_ANNOTATION__?.exportFreezeState()??null}catch{return null}}(),d=[];for(let r=0;r<e;r++){let e={h:"#"+(r+1)};null!=t.quiz[r]&&(e.quiz={[r]:t.quiz[r]}),null!=t.survey[r]&&(e.survey={[r]:t.survey[r]}),null!=t.code[r]&&(e.code={[r]:t.code[r]}),null!=t.task[r]&&(e.task={[r]:t.task[r]}),d.push(e)}return d.length>0&&(r.length&&(d[0].canvas=r),(Object.keys(n).length||n.length)&&(d[0].marker=n),Object.keys(o).length&&(d[0].ortho=o),Object.keys(i).length&&(d[0].mathe=i),Object.keys(c).length&&(d[0].coord=c)),{v:l,sh:(0,a.getCurrentHash)(),s:d,annot:u}}function u(e){if(!e||!Array.isArray(e.s))return;for(let t=0;t<e.s.length;t++){let r=e.s[t];for(let e of["quiz","survey","code","task"]){let t=r[e];if(t)for(let[r,n]of Object.entries(t))(0,i.sendRestoreEvent)(e,Number(r),n)}}let t=e.s[0];t&&(Array.isArray(t.canvas)&&function(e){try{let t=window.__LIA_CANVAS_OCR__?.freeze;if(!t?.renderCanvasFreezeStateIntoPair||!t.collectCanvasPairsFromRoot)return;let r=t.collectCanvasPairsFromRoot(document);for(let n of Array.isArray(e)?e:[]){let e=n?.u;if(!e)continue;let o=r.find(t=>{let r=t.querySelector?.(".lia-canvas-mount");return r&&r.dataset?.uid===e});o&&t.renderCanvasFreezeStateIntoPair(o,n)}}catch{}}(t.canvas),Array.isArray(t.marker)&&function(e){try{let t=window.__LIA_TEXTMARKER_REG_V4__;if(!t||"function"!=typeof t.setHighlights)return;t.setHighlights(Array.isArray(e)?e:[])}catch{}}(t.marker),t.ortho&&"object"==typeof t.ortho&&function(e){try{let t=window.__ORTHOGRAPHY_EXPORT_V8__;if(!t||"function"!=typeof t.setState)return;for(let[r,n]of Object.entries(e)){let e=n?.liveValue??n;"string"==typeof e&&t.setState(r,e)}}catch{}}(t.ortho),t.mathe&&"object"==typeof t.mathe&&function(e){try{let t=window.__LIA_FRACTION_QUIZ_V3__;if(!t)return;for(let[r,n]of Object.entries(e)){if(!Array.isArray(n.state))continue;let e=t.getWidget(r);e&&(e.state=[...n.state])}}catch{}}(t.mathe),t.coord&&"object"==typeof t.coord&&function(e){try{let t=window.__coord?.getBoardStateStore?.()??window.__coordBoardStates;if(!t)return;for(let[r,n]of Object.entries(e))t[r]=n}catch{}}(t.coord)),function(e){try{if(!e)return;window.__LIA_ANNOTATION__?.importFreezeState(e,{replace:!0})}catch{}}(e.annot)}},{"./port":"8E6Fn","./url":"hyyva","@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],hyyva:[function(e,t,r,n){var o=e("@parcel/transformer-js/src/esmodule-helpers.js");o.defineInteropFlag(r),o.export(r,"getSubmissionToken",()=>u),o.export(r,"storeToken",()=>d),o.export(r,"clearToken",()=>f),o.export(r,"getCurrentHash",()=>m),o.export(r,"buildLink",()=>p),o.export(r,"loadPayload",()=>b);var i=e("./codec");let a="submission";function l(){let e=window.location.search;if(!e||"?"===e)return"";try{return decodeURIComponent(e.slice(1))}catch{return e.slice(1)}}function s(e){if(!e)return"";try{let t=new URL(e,window.location.href);return String(t.hash).replace(/^#/,"").startsWith(a+"=")&&(t.hash=""),t.toString()}catch{return e.replace(RegExp("#"+a+"=[^#]*$"),"")}}function c(){let e=l();return"__lia_freeze_v2__:"+(()=>{let t=s(e);try{let e=new URL(t,window.location.href);return e.hash="",e.toString()}catch{return t.replace(/#.*$/,"")}})()}function u(){let e=function(){let e=l();if(!e)return null;try{let t=String(new URL(e,window.location.href).hash).replace(/^#/,"");if(!t.startsWith(a+"="))return null;return decodeURIComponent(t.slice((a+"=").length))}catch{let t=e.match(RegExp("#"+a+"=([^#]+)$"));return t?decodeURIComponent(t[1]):null}}()||function(){let e=window.location.hash;if(!e)return null;let t=e.match(/[?&]submission=([^&]+)/);return t?decodeURIComponent(t[1]):null}();if(e)return d(e),e;try{return sessionStorage.getItem(c())||null}catch{return null}}function d(e){try{sessionStorage.setItem(c(),e)}catch{}}function f(){try{sessionStorage.removeItem(c())}catch{}}function m(){let e=window.location.hash,t=e.match(/^(#\d+)&submission=/)?.[1]??e;return/^#\d+$/.test(t)?t:"#1"}async function p(e){let t=s(l());if(!t)return window.location.href;let{token:r}=await (0,i.encodeToken)(e);d(r);let n=window.location.href.split("?")[0].split("#")[0],o=/^#\d+$/.test(String(e?.sh??""))?String(e.sh):"#1";return n+"?"+encodeURIComponent(s(t)+"#"+a+"="+r)+o}async function b(){let e=u();if(!e)return null;try{let t=await (0,i.decodeToken)(e);if(!t||"object"!=typeof t||!Array.isArray(t.s))return null;return t}catch{return null}}},{"./codec":"4JnOo","@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],"4JnOo":[function(e,t,r,n){var o=e("@parcel/transformer-js/src/esmodule-helpers.js");function i(e){return e.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")}function a(e){let t=e.replace(/-/g,"+").replace(/_/g,"/");for(;t.length%4!=0;)t+="=";return t}async function l(e){let t=new Blob([new TextEncoder().encode(e)]).stream().pipeThrough(new CompressionStream("gzip"));var r=new Uint8Array(await new Response(t).arrayBuffer());let n="";for(let e=0;e<r.length;e+=32768)n+=String.fromCharCode(...Array.from(r.subarray(e,e+32768)));return i(btoa(n))}async function s(e){let t=new Blob([function(e){let t=atob(a(e)),r=new Uint8Array(t.length);for(let e=0;e<t.length;e++)r[e]=t.charCodeAt(e);return r}(e)]).stream().pipeThrough(new DecompressionStream("gzip")),r=await new Response(t).arrayBuffer();return new TextDecoder().decode(new Uint8Array(r))}async function c(e){let t=JSON.stringify(e),r=i(btoa(unescape(encodeURIComponent(t))));try{let e=await l(t),n="gz:"+e;if(n.length<r.length)return{token:n,mode:"gzip"}}catch{}return{token:r,mode:"plain"}}async function u(e){let t=e.trim();if(!t)throw Error("Empty token.");return t.startsWith("gz:")?JSON.parse(await s(t.slice(3))):JSON.parse(decodeURIComponent(escape(atob(a(t)))))}o.defineInteropFlag(r),o.export(r,"gzipCompressToBase64Url",()=>l),o.export(r,"gzipDecompressFromBase64Url",()=>s),o.export(r,"encodeToken",()=>c),o.export(r,"decodeToken",()=>u)},{"@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],"45Hu0":[function(e,t,r,n){var o=e("@parcel/transformer-js/src/esmodule-helpers.js");o.defineInteropFlag(r),o.export(r,"injectRuntimeCSS",()=>a),o.export(r,"applyCourseColors",()=>l),o.export(r,"applyThemeColors",()=>s),o.export(r,"installFreezeBar",()=>u),o.export(r,"setFreezeBarState",()=>d),o.export(r,"setPageFrozen",()=>m),o.export(r,"reapplyContentLock",()=>b),o.export(r,"wireLiveBar",()=>g),o.export(r,"setLiveBarStatus",()=>h),o.export(r,"setLiveBarFrozen",()=>y),o.export(r,"copyLinkToClipboard",()=>v);let i="lia-submission-runtime-style";function a(){if(document.getElementById(i))return;let e=document.createElement("style");e.id=i,e.textContent=`
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
.lia-frozen-scope .lia-exam-name-input,
.lia-frozen-scope .lia-exam-start-btn {
  pointer-events: auto !important;
  cursor: auto !important;
}
.lia-frozen-scope .lia-exam-start-btn { cursor: pointer !important; }

/* \u{2500}\u{2500} Static quiz freeze \u{2500}\u{2500} */
.lia-frozen-static-quiz {
  display: block;
}
.lia-frozen-static-quiz * {
  pointer-events: none !important;
}

/* \u{2500}\u{2500} Exam intro overlay \u{2500}\u{2500} */
#lia-exam-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 10000001;
  overflow-y: auto;
  align-items: flex-start;
  justify-content: center;
  padding: 3rem 1.5rem;
  box-sizing: border-box;
  background: var(--lia-course-bg);
}

/* \u{2500}\u{2500} Exam shake animation \u{2500}\u{2500} */
@keyframes lia-exam-shake {
  0%,100% { transform: translateX(0); }
  20%      { transform: translateX(-8px); }
  40%      { transform: translateX(8px); }
  60%      { transform: translateX(-6px); }
  80%      { transform: translateX(6px); }
}

/* \u{2500}\u{2500} Exam countdown widget \u{2500}\u{2500} */
#lia-exam-countdown {
  position: fixed;
  right: 30px;
  bottom: 5px;
  z-index: 99995;
  padding: .25rem .35rem;
  border-radius: 8px;
  font-weight: 800;
  font-size: 1.75rem;
  line-height: 1.2;
  color: #c1121f;
  background: color-mix(in srgb, #c1121f 8%, transparent);
  border: 2px solid #c1121f;
  pointer-events: none;
  display: none;
}
@media (max-width: 700px) {
  #lia-exam-countdown { right: 12px; bottom: 30px; }
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
`.trim(),(document.head||document.documentElement).appendChild(e)}function l(){let e=document.querySelector(".lia-slide.active .lia-slide__content")??document.querySelector(".lia-slide.current .lia-slide__content")??document.querySelector("main.lia-slide__content")??document.querySelector(".lia-content")??document.querySelector("main")??document.body,t="",r="";for(;e&&e!==document.documentElement;){let n=getComputedStyle(e),o=n.backgroundColor;if(o&&"transparent"!==o&&"rgba(0, 0, 0, 0)"!==o){t=o,r=n.color;break}e=e.parentElement}t||(t=getComputedStyle(document.body).backgroundColor||"rgb(255,255,255)",r=getComputedStyle(document.body).color||"rgb(17,17,17)");let n=r.match(/\d+(\.\d+)?/g)||[],o=n.length>=3?`rgba(${n[0]},${n[1]},${n[2]},0.22)`:"rgba(0,0,0,0.22)",i=document.documentElement;i.style.setProperty("--lia-course-bg",t),i.style.setProperty("--lia-course-fg",r),i.style.setProperty("--lia-course-border",o)}function s(){let e=(getComputedStyle(document.body).getPropertyValue("--color-highlight")||getComputedStyle(document.documentElement).getPropertyValue("--color-highlight")).trim().match(/\d+(\.\d+)?/g)||[];if(e.length<3)return;let[t,r,n]=[Number(e[0]),Number(e[1]),Number(e[2])],o=.2126*t+.7152*r+.0722*n>160,i=document.documentElement;i.style.setProperty("--lia-submit-bg-rgb",`${t}, ${r}, ${n}`),i.style.setProperty("--lia-submit-fg",o?"#111111":"#ffffff"),i.style.setProperty("--lia-submit-border-on-theme",o?"rgba(0,0,0,.24)":"rgba(255,255,255,.34)"),i.style.setProperty("--lia-submit-button-bg",o?"rgba(255,255,255,.38)":"rgba(255,255,255,.14)"),i.style.setProperty("--lia-submit-note-bg",o?"rgba(255,255,255,.30)":"rgba(0,0,0,.14)")}let c=null;function u(e){if(c=e,document.getElementById("lia-freeze-bar"))return;let t=document.createElement("div");function r(e,r){let n=t.querySelector("#"+e);n&&n.addEventListener("click",e=>{e.preventDefault(),e.stopPropagation(),r()},!0)}t.id="lia-freeze-bar",t.innerHTML='<div id="lia-freeze-bar-inner"><div id="lia-freeze-nav-left" class="lia-freeze-nav-group"><button id="lia-freeze-first" type="button" aria-label="First slide"><svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon"><path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/><rect x="-1.8" y="4" width="2.6" height="16" rx="1.3" fill="currentColor"/></svg></button><button id="lia-freeze-prev" type="button" aria-label="Previous slide"><svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon"><path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/><rect x="10.2" y="10.6" width="10.8" height="2.8" rx="1.4" fill="currentColor"/></svg></button></div><div id="lia-freeze-center"><div id="lia-freeze-head"></div></div><div id="lia-freeze-nav-right" class="lia-freeze-nav-group"><button id="lia-freeze-next" type="button" aria-label="Next slide"><svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon" style="transform:scaleX(-1)"><path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/><rect x="10.2" y="10.6" width="10.8" height="2.8" rx="1.4" fill="currentColor"/></svg></button><button id="lia-freeze-last" type="button" aria-label="Go to evaluation slide"><svg viewBox="-4 0 24 24" aria-hidden="true" class="lia-freeze-icon" style="transform:scaleX(-1)"><path d="M21 8H10.2V4L2 12l8.2 8v-4H21V8z" fill="currentColor"/><rect x="-1.8" y="4" width="2.6" height="16" rx="1.3" fill="currentColor"/></svg></button></div></div>',document.body.appendChild(t),r("lia-freeze-first",()=>c?.onFirst()),r("lia-freeze-prev",()=>c?.onPrev()),r("lia-freeze-next",()=>c?.onNext()),r("lia-freeze-last",()=>c?.onEval())}function d(e){let t=document.getElementById("lia-freeze-bar");if(!t)return;let r=t.querySelector("#lia-freeze-head");if(r){let t=[];e.slideTitle&&t.push(e.slideTitle),t.push(e.slidePos),r.textContent=t.join(" · ")}let n=(e,r)=>{let n=t.querySelector("#"+e);n&&(n.disabled=!r)};n("lia-freeze-first",e.canFirst),n("lia-freeze-prev",e.canPrev),n("lia-freeze-next",e.canNext),n("lia-freeze-last",e.canEval);let o=t.offsetHeight||64;document.body.style.paddingTop=o+10+"px",document.documentElement.style.scrollPaddingTop=o+10+"px"}function f(){return document.querySelector("main.lia-slide__content")??document.querySelector(".lia-content")??document.querySelector("main")??document.querySelector("article")??null}function m(e,t=!1){let r=document.body;if(r)if(r.classList.toggle("lia-course-frozen",e),r.classList.toggle("lia-snapshot-mode",e),r.classList.toggle("lia-shared-freeze-link",e&&t),e){let e=f();e&&e.classList.add("lia-frozen-scope"),setTimeout(p,120)}else document.querySelectorAll(".lia-frozen-scope").forEach(e=>{e.classList.remove("lia-frozen-scope")})}function p(){let e=f();e&&e.querySelectorAll("input, textarea, select, button, [role='button'], [contenteditable='true']").forEach(e=>{if(!(e.closest("#lia-freeze-bar")||e.closest(".lia-submit-box")||e.closest(".lia-annot-toolbar")||e.closest(".lia-exam-intro-virtual-slide"))&&"lia-link"!==e.id&&"lia-copy-link"!==e.id){try{e.disabled=!0}catch(e){}try{e.readOnly=!0}catch(e){}e.setAttribute("tabindex","-1")}})}function b(){if(!document.body.classList.contains("lia-course-frozen"))return;document.querySelectorAll(".lia-frozen-scope").forEach(e=>{e.classList.remove("lia-frozen-scope")});let e=f();e&&e.classList.add("lia-frozen-scope"),setTimeout(p,120)}function g(e){document.addEventListener("click",t=>{let r=t.target;if(r instanceof Element&&r.closest("#lia-create-link")){if(document.body.classList.contains("lia-snapshot-mode")){t.preventDefault(),t.stopPropagation();return}t.preventDefault(),t.stopPropagation(),e.onCreateLink()}},!0),document.addEventListener("click",t=>{let r=t.target;r instanceof Element&&r.closest("#lia-copy-link")&&(t.preventDefault(),t.stopPropagation(),e.onCopyLink())},!0)}function h(e){let t=document.getElementById("lia-status");t&&(t.textContent=e)}function y(e,t){let r=document.getElementById("lia-name"),n=document.getElementById("lia-link"),o=document.getElementById("lia-create-link"),i=document.getElementById("lia-copy-link"),a=document.getElementById("lia-frozen-note");r&&(r.value=t,r.disabled=!0),o&&(o.disabled=!0,o.textContent="Submission frozen"),n&&(n.value=e,n.disabled=!1,n.readOnly=!0,n.style.pointerEvents="auto",n.style.userSelect="text"),i&&(i.disabled=!e),h("Submission link created."),a&&(a.style.display="block",a.innerHTML="This is a <strong>frozen submission</strong>. Tasks and inputs are locked. The table of contents, display mode, and layout can still be used.")}async function v(e){if(!e)return!1;if(navigator.clipboard&&"function"==typeof navigator.clipboard.writeText&&window.isSecureContext)try{return await navigator.clipboard.writeText(e),!0}catch(e){}let t=document.createElement("textarea");t.value=e,t.setAttribute("aria-hidden","true"),t.style.cssText="position:fixed;top:0;left:-9999px;opacity:0;pointer-events:none;font-size:16px",document.body.appendChild(t);let r=!1;try{t.focus({preventScroll:!0}),t.select(),t.setSelectionRange(0,e.length),r=document.execCommand("copy")}catch(e){}return t.remove(),r}},{"@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],cUIxA:[function(e,t,r,n){var o=e("@parcel/transformer-js/src/esmodule-helpers.js");function i(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function a(e){return String(e||"").trim().replace(/\s+/g," ")}function l(e){return e.replace(/^\s*<!--[\s\S]*?-->\s*/,"")}function s(e,t){let r=l(e).split(/\r?\n/),n=!1,o="";for(let e=0;e<r.length;e++){let i=r[e].match(/^\s*(```+|~~~+)/);if(i){let e=i[1].charAt(0);if(!n){n=!0,o=e;continue}if(e===o){n=!1,o="";continue}}n||t(r[e],e)}}function c(e){let t={trackF12:!1,trackTab:!1,trackTime:!1};return s(e,e=>{var r;let n,o=e.match(/^\s*@Auswertung(?:\s*\(([^)]*)\))?\s*$/);if(!o)return;let i=(r=o[1]||"",n={trackF12:!1,trackTab:!1,trackTime:!1},a(r).split(/[;,]/).forEach(e=>{let t=a(e);/^f12$/i.test(t)&&(n.trackF12=!0),/^tab$/i.test(t)&&(n.trackTab=!0),/^time$/i.test(t)&&(n.trackTime=!0)}),n);i.trackF12&&(t.trackF12=!0),i.trackTab&&(t.trackTab=!0),i.trackTime&&(t.trackTime=!0)}),t}o.defineInteropFlag(r),o.export(r,"parseEvaluationOptions",()=>c),o.export(r,"parseDeclaredSlides",()=>d),o.export(r,"parseSectionCount",()=>f),o.export(r,"parseExamConfig",()=>m),o.export(r,"parseAbgabeHash",()=>p),o.export(r,"parseEvaluationDeclarations",()=>b),o.export(r,"buildEvaluationStats",()=>y),o.export(r,"buildEvaluationStatsByTag",()=>v),o.export(r,"renderEvaluationSlide",()=>_);let u="Evaluation";function d(e){let t=[],r=!1,n=0,o=0;if(s(e,e=>{if(/^\s*@Auswertung(?:\s*\(([^)]*)\))?\s*$/.test(e)&&(r=!0,o=n+1),/^#{1,6}\s+/.test(e)){n++;let r=e.match(/^(#{1,2})\s+(.+?)\s*$/);r&&t.push({h:"#"+n,t:a(r[2])})}}),r){let e="#"+(o||n+1);t.push({h:e,t:u,vt:"evaluation"})}return t}function f(e){let t=0;return s(e,e=>{/^#{1,6}\s+/.test(e)&&t++}),t}function m(e){let t={enabled:!1,durationMinutes:0,triggerHash:""},r=0;return s(e,e=>{if(t.enabled)return;if(/^#{1,6}\s+/.test(e))return void r++;let n=e.trim().match(/^@Exam(?:\s*\(([^)]*)\))?\s*$/i);if(!n)return;let o=Number(a(n[1]||"").replace(",","."));Number.isFinite(o)&&o>0&&(t.enabled=!0,t.durationMinutes=o,t.triggerHash="#"+Math.max(1,r))}),t}function p(e){let t=0,r="";return s(e,e=>{if(!r){if(/^#{1,6}\s+/.test(e))return void t++;/^\s*@Abgabe(?:\s*\([^)]*\))?\s*$/.test(e)&&(r="#"+Math.max(1,t))}}),r}function b(e){let t=l(e).split(/\r?\n/),r=!1,n="",o=[],i=null;for(let e of t){let t=e.match(/^\s*(```+|~~~+)/);if(t){let e=t[1].charAt(0);if(!r){r=!0,n=e;continue}if(e===n){r=!1,n="";continue}}if(!r){if(/^#{1,6}\s+/.test(e)){i&&o.push(i),i=[];continue}i&&i.push(e)}}i&&o.push(i);let s=Object.create(null);return o.forEach((e,t)=>{let r=function(e){let t=[];function r(){let e={be:1,tg:[]};return t.push(e),e}function n(e){let t=a(e);return!(!t||/^\s*<!--/.test(t)||/^\s*@ADetails\b/.test(e)||/^\s*-\s+/.test(e)||/@(?:diktat|orthography|rectQuiz|circleQuiz|TextmarkerQuiz|ErzeugePunkt)\s*\(/.test(e))&&/\[\[|\[\->\[/.test(e)}for(let o=0;o<e.length;o++){let i=String(e[o]||""),l=a(i);if(!l||/^\s*<!--/.test(l))continue;let s=Array.from(i.matchAll(/@ADetails\s*\(([^)]*)\)/g));if(s.length){let e=t.length?t[t.length-1]:null;s.forEach(t=>(function(e,t){let r,n,o,i;if(!e)return;let l=(r=a(t),n=null,o=[],(i=r.split(/\s*;\s*/).filter(Boolean)).forEach((e,t)=>{let r=a(e),l=r.match(/^tags?\s*[:=]\s*(.+)$/i);if(l)return void l[1].split(",").map(e=>a(e)).filter(Boolean).forEach(e=>{o.includes(e)||o.push(e)});let s=r.match(/^(?:points?|be|punkte?)\s*[:=]\s*([\d.,]+)$/i);if(s){let e=Number(s[1].replace(",","."));Number.isFinite(e)&&e>=0&&null===n&&(n=e);return}let c=r.match(/^([\d.,]+)\s*=\s*[A-Za-z%]+$/);if(c){let e=Number(c[1].replace(",","."));Number.isFinite(e)&&e>=0&&null===n&&(n=e);return}let u=Number(r.replace(",","."));if(Number.isFinite(u)&&u>=0&&null===n){n=u;return}(t>=1||1===i.length)&&r.split(",").map(e=>a(e)).filter(Boolean).forEach(e=>{o.includes(e)||o.push(e)})}),{pointsValue:n,tags:o});null!==l.pointsValue&&(e.be=l.pointsValue),l.tags.forEach(t=>{t&&0>e.tg.indexOf(t)&&e.tg.push(t)})})(e,t[1]||""));continue}let c=e=>/^\s*-\s+/.test(e)&&/(\[\[|\[\()/.test(e)||/^\s{2,}\[[\[( ]/.test(e);if(c(i)){for(r();o+1<e.length&&c(String(e[o+1]||""));)o++;continue}if(/@diktat\s*\(/.test(i)){for(r();o+1<e.length;){let t=String(e[o+1]||"");if(!a(t)||/^\s*@ADetails\b/.test(t)||!/@diktat\s*\(/.test(t))break;o++}continue}let u=i.match(/@orthography\s*\(/g)||[];if(u.forEach(()=>r()),u.length)continue;let d=i.match(/@(?:rectQuiz|circleQuiz|TextmarkerQuiz|ErzeugePunkt)\b/g)||[];if(d.forEach(()=>r()),!d.length&&n(i)){for(r();o+1<e.length;){let t=String(e[o+1]||""),r=a(t);if(!r||/^\s*@ADetails\b/.test(t)||/^\s*<!--/.test(r)){if(/^\s*<!--/.test(r)){o++;continue}break}if(!n(t))break;o++}continue}}return t}(e),n=Object.create(null),o=0,i=r.map(e=>{let t=Math.max(0,e.be);return o+=t,e.tg.forEach(e=>{n[e]||(n[e]={total:0,tasks:0}),n[e].total+=t,n[e].tasks+=1}),{be:t,tg:e.tg.slice()}});s["#"+(t+1)]={tt:i.length,tb:o,tg:n,tl:i}}),s}function g(e){let t=Number(e.solved);return 1===t?"correct":-1===t?"resolved":Number(e.trial||0)>0?"wrong":""}function h(e){let t=[];for(let r of e.s)if(r.quiz)for(let[e,n]of Object.entries(r.quiz)){let r=Number(e);(Array.isArray(n)?n:[]).forEach((e,n)=>{e&&"object"==typeof e&&t.push({hash:"#"+(r+1),idx:n+1,el:e})})}return t}function y(e,t){let r={total:0,correct:0,wrong:0,resolved:0,notMade:0};for(let e of Object.values(t))r.total+=e.tb;let n=h(e);if(r.total>0)for(let{hash:e,idx:o,el:i}of n){let n=t[e],a=n?.tl[o-1],l=a?a.be:1,s=g(i);"correct"===s?r.correct+=l:"wrong"===s?r.wrong+=l:"resolved"===s&&(r.resolved+=l)}else for(let{el:e}of n){r.total+=1;let t=g(e);"correct"===t?r.correct+=1:"wrong"===t?r.wrong+=1:"resolved"===t&&(r.resolved+=1)}return r.notMade=Math.max(0,r.total-r.correct-r.wrong-r.resolved),r}function v(e,t){let r=Object.create(null);for(let e of Object.values(t))for(let[t,n]of Object.entries(e.tg))r[t]||(r[t]={tag:t,total:0,tasks:0,correct:0,wrong:0,resolved:0}),r[t].total+=n.total,r[t].tasks+=n.tasks;for(let{hash:n,idx:o,el:i}of h(e)){let e=t[n],a=e?.tl[o-1];if(!a||!a.tg.length)continue;let l=a.be,s=g(i);for(let e of a.tg)r[e]||(r[e]={tag:e,total:0,tasks:0,correct:0,wrong:0,resolved:0}),r[e].total<=0&&(r[e].total+=l,r[e].tasks+=1),"correct"===s?r[e].correct+=l:"wrong"===s?r[e].wrong+=l:"resolved"===s&&(r[e].resolved+=l)}return Object.keys(r).sort((e,t)=>e.localeCompare(t,void 0,{sensitivity:"base"})).map(e=>r[e])}function x(e){return"correct"===e?"rgb(25, 135, 84)":"wrong"===e?"rgb(220, 53, 69)":"resolved"===e?"rgb(108, 117, 125)":"var(--lia-course-fg)"}function w(e,t){return String(Math.round(10*(t>0?e/t*100:0))/10).replace(".",",")}function k(e,t,r){let n=x(r);return['<div style="padding:1rem 1.05rem;border-radius:12px;border:1px solid var(--lia-course-border);background:var(--lia-course-bg);color:var(--lia-course-fg);">','<div style="font-size:3rem;opacity:.98;font-weight:700;margin-bottom:.35rem;color:',n,';">',i(e),"</div>",'<div style="font-size:5rem;line-height:1;font-weight:800;color:',n,';">',i(String(t)),"</div>","</div>"].join("")}function z(e,t,r){let n="neutral"===r?"var(--lia-course-fg)":x(r);return['<div style="padding:1rem 1.05rem;border-radius:12px;border:1px solid var(--lia-course-border);background:var(--lia-course-bg);color:var(--lia-course-fg);min-width:150px;box-sizing:border-box;">','<div style="font-size:1.2rem;opacity:.98;font-weight:700;margin-bottom:.35rem;color:',n,';">',i(e),"</div>",'<div style="font-size:2.5rem;line-height:1.05;font-weight:800;color:',n,';">',i(String(t)),"</div>","</div>"].join("")}function S(e){let t=w(e.correct,e.total);return['<div style="margin-top:1.2rem;padding:1rem 1.05rem;border-radius:14px;border:1px solid var(--lia-course-border);background:color-mix(in srgb, var(--lia-course-bg) 94%, black 6%);">','<div style="font-weight:800;font-size:3.0rem;line-height:1.2;margin-bottom:.8rem;color:var(--lia-course-fg);">',i(e.tag),"</div>",'<div style="overflow-x:auto;">','<div style="display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:.75rem;min-width:820px;">',z("Correct",e.correct,"correct"),z("Wrong",e.wrong,"wrong"),z("Resolved",e.resolved,"resolved"),z("Achieved",e.correct+" of "+e.total,"neutral"),z("Score",t+"%","neutral"),"</div>","</div>","</div>"].join("")}function E(e,t){if(t<=0)return"";let r=x("wrong");return['<div style="margin-top:.85rem;font-weight:800;font-size:2.35rem;padding:1rem 1.05rem;border-radius:12px;',"border:1px solid ",r,";","background:color-mix(in srgb, ",r," 12%, var(--lia-course-bg) 88%);","color:",r,';">',i("f12"===e?"Fraud attempt detected: DevTools (F12) were opened during the exam.":"Fraud attempt detected: The tab or window was left during the exam."),"</div>"].join("")}function _(e){let t,{payload:r,evalDecl:n,title:o,name:a}=e,l=y(r,n),s=v(r,n),c=w(l.correct,l.total),d=r.sec,f=d?.trackF12?E("f12",d.f12):"",m=d?.trackTab?E("tab",d.tab):"",p=a?"Name: "+i(a)+"<br>Summary of the frozen submission":"Summary of the frozen submission",b=s.length?['<div style="margin-top:1.35rem;">','<div style="font-weight:800;font-size:2rem;line-height:1.2;margin-bottom:.2rem;">Evaluation by Tags</div>','<div style="opacity:.82;margin-bottom:.8rem;">Each tag shows its own partial result.</div>',s.map(S).join(""),"</div>"].join(""):"",g=(t=r.slideTimeMs)&&Object.keys(t).length?['<div style="margin-top:1.35rem;">','<div style="font-weight:800;font-size:2rem;line-height:1.2;margin-bottom:.4rem;">Time per Slide</div>','<div style="border:1px solid var(--lia-course-border);border-radius:12px;padding:.6rem 1rem;">',Object.entries(t).sort((e,t)=>parseInt(e[0].slice(1),10)-parseInt(t[0].slice(1),10)).map(([t,r])=>{let n=e.slides?.find(e=>e.h===t),o=n?i(n.t):i(t),a=Math.round(r/1e3);return'<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid var(--lia-course-border);"><span>'+o+'</span><span style="font-weight:700;">'+i(a<60?a+" sec":Math.floor(a/60)+" min "+a%60+" sec")+"</span></div>"}).join(""),"</div>","</div>"].join(""):"";return['<div style="font-weight:800;font-size:4.35rem;line-height:1.2;margin-bottom:.6rem;">',i(o||u),"</div>",'<div style="margin-bottom:1rem;opacity:0.92;font-weight:700;">',p,"</div>",'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.85rem;margin-bottom:1rem;">',k("Correct",l.correct,"correct"),k("Wrong",l.wrong,"wrong"),k("Resolved",l.resolved,"resolved"),k("Not done",l.notMade,"neutral"),"</div>",'<div style="font-weight:800;font-size:2.35rem;padding:1rem 1.05rem;border-radius:12px;border:1px solid var(--lia-course-border);background:var(--lia-course-bg);color:var(--lia-course-fg);">',i(String(l.correct))," of ",i(String(l.total))," points achieved. <br>&nbsp;&nbsp;&nbsp; <strong><big><big><big><big>",i(c),"%</big></big></big></big></strong>.<br>",'<span style="opacity:.82;">Based on the quiz states stored in the freeze snapshot.</span>',"</div>",f,m,b,g].join("")}},{"@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}],hn3mm:[function(e,t,r,n){var o=e("@parcel/transformer-js/src/esmodule-helpers.js");o.defineInteropFlag(r),o.export(r,"getSecurityState",()=>b),o.export(r,"installF12Tracking",()=>z),o.export(r,"installTabTracking",()=>S);let i={f12:0,tab:0},a=!1,l=!1,s=!1,c=-1,u=-1,d=-1,f=!1,m=!1,p=0;function b(){return{f12:i.f12,tab:i.tab}}function g(){return!!document.body?.classList.contains("lia-snapshot-mode")}function h(){let e=window;try{for(;e.parent&&e.parent!==e;)e=e.parent}catch(e){}return e}function y(){let e=String(navigator.platform||""),t=String(navigator.userAgent||""),r=Number(navigator.maxTouchPoints||0),n=/iPad|iPhone|iPod/.test(e)||/iPad|iPhone|iPod/.test(t),o="MacIntel"===e&&r>1;return n||o}function v(){if(y())return!1;let e=Math.abs((window.outerWidth||0)-(window.innerWidth||0)),t=Math.abs((window.outerHeight||0)-(window.innerHeight||0));if(e>170||t>170)return!0;try{if(window.Firebug?.chrome?.isInitialized)return!0}catch(e){}return!1}function x(e,t){if(!(c>=0&&40>=Math.abs(t-c))){if("devtools-open"===e&&u>=0&&t>=u&&t-u<=1200){c=t;return}c=t,i.f12+=1}}function w(e){d>=0&&500>=Math.abs(e-d)||(d=e,i.tab+=1)}function k(){!g()&&!m&&function(){let e=!0,t=!0;try{e="hidden"!==document.visibilityState}catch(e){}try{t="function"!=typeof document.hasFocus||document.hasFocus()}catch(e){}return e&&t}()&&(m=!0)}function z(e){if(a)return;a=!0;let t=h();if(Array.from(new Set([window,document,document.documentElement,document.body,t,t.document].filter(Boolean))).forEach(t=>{t?.addEventListener&&t.addEventListener("keydown",t=>{if(g()||"F12"!==t.key&&"F12"!==t.code&&(t.keyCode??t.which)!==123||t.repeat)return;let r=Math.round(t.timeStamp||Date.now());u=r,x("keydown",r),e?.()},!0)}),!s&&!y()){function r(){if(g())return;let t=v();t&&!f&&(x("devtools-open",Date.now()),e?.()),f=t}s=!0,(f=v())&&!g()&&(x("devtools-open-initial",Date.now()),e?.()),window.addEventListener("resize",()=>setTimeout(r,60),!0),window.addEventListener("focus",()=>setTimeout(r,60),!0),window.setInterval(r,700)}}function S(e){if(l)return;l=!0;let t=h(),r=Array.from(new Set([window,t].filter(Boolean)));Array.from(new Set([document,t.document].filter(Boolean))).forEach(t=>{t?.addEventListener&&t.addEventListener("visibilitychange",t=>{if(g())return;let r=t.currentTarget&&"visibilityState"in t.currentTarget?t.currentTarget:document;"visible"===r.visibilityState?k():"hidden"===r.visibilityState&&m&&(w(Date.now()),e?.())},!0)}),r.forEach(e=>{e?.addEventListener&&(e.addEventListener("focus",()=>k(),!0),e.addEventListener("pageshow",()=>k(),!0),e.addEventListener("blur",()=>void(!g()&&m&&(clearTimeout(p),p=window.setTimeout(()=>{if(g()||!m)return;let e=!1,t=!1;try{e="hidden"===document.visibilityState}catch(e){}try{t="function"!=typeof document.hasFocus||!document.hasFocus()}catch(e){}(e||t)&&w(Date.now())},80))),!0))}),setTimeout(()=>k(),250)}},{"@parcel/transformer-js/src/esmodule-helpers.js":"k3151"}]},["8RSWf"],"8RSWf","parcelRequire3339",{});
//# sourceMappingURL=index.js.map
