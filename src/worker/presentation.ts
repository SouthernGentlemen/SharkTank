import type { BackupState } from "./lobby-do.js";
import type { MaintenanceState } from "./env.js";
import { SECURITY_HEADERS } from "./responses.js";
import { numberValue, publicBillingWindow, recordValue } from "./presentation-data.js";

function formatCompactDuration(ms: number): string { const seconds = Math.round(ms / 1000); return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${(seconds / 3600).toFixed(1)}h`; }
/**
 * Keeps /status/ current without reloading the document.
 *
 * The page used to run `setTimeout(()=>location.reload(),3000)`. A full reload every three
 * seconds rebuilds the screen-reader virtual buffer, throws keyboard focus back to the top
 * of the document, and drops scroll position — with no way to stop it (WCAG 2.2.1, 2.2.2).
 * It also had every open tab hitting the Lobby DO 20x a minute.
 *
 * Instead: poll the JSON the page already publishes, patch only the values that move, and
 * offer a real pause control. Cells are written with textContent — `topName` is a
 * player-chosen display name and must never reach innerHTML. The polite live region gets a
 * one-line summary and only when that summary actually changes, so a screen reader is not
 * re-read the same sentence every 15 seconds.
 */
/*
 * The button used to ship `aria-pressed="true"` on the label "Pause auto-update", so
 * assistive technology announced "Pause auto-update, pressed" while polling was *running*
 * and the inverse once it had stopped — the name and the state contradicted each other in
 * both positions (SC 4.1.2). Of the two consistent conventions, this takes the action-verb
 * label and drops `aria-pressed` entirely: the label already says what activating the
 * control will do, and the `role="status"` region below it announces what actually changed.
 */
function statusLiveScript(): string {
  return `<script nonce="__WG_CSP_NONCE__">(function(){
  var INTERVAL=15000,KEY='wg-status-autoupdate';
  var btn=document.getElementById('status-autoupdate'),stamp=document.getElementById('status-updated-at'),live=document.getElementById('status-live'),rows=document.getElementById('status-tank-rows');
  if(!btn)return;
  var timer=null,lastSummary='',failures=0;
  function value(id,text){var el=document.getElementById(id);if(el)el.textContent=text;}
  function detail(id,text){var el=document.getElementById(id);if(!el||!el.parentNode)return;var d=el.parentNode.querySelector('.metric-detail');if(d)d.textContent=text;}
  function apply(d){
    var list=d.rooms||[],players=list.reduce(function(n,r){return n+(r.players||0);},0),open=!(d.maintenance&&d.maintenance.enabled);
    if(d.availability){value('status-tank-availability',d.availability.availabilityPercent+'%');detail('status-tank-availability',d.availability.unscheduledDowntimePercent+'% unscheduled downtime');}
    value('status-tank-access',open?'OPEN':'CLOSED');
    detail('status-tank-access',open?'game traffic available':'scheduled gate active');
    value('status-active-players',String(players));
    detail('status-active-players',(players===1?'human session across ':'human sessions across ')+list.length+' tanks');
    if(rows){
      var frag=document.createDocumentFragment();
      list.forEach(function(r){
        var tr=document.createElement('tr'),name=document.createElement('td'),strong=document.createElement('strong');
        strong.textContent=String(r.name==null?'':r.name);name.appendChild(strong);tr.appendChild(name);
        [r.players,r.bots,r.topScore,r.topName].forEach(function(cell){var td=document.createElement('td');td.textContent=String(cell==null?'':cell);tr.appendChild(td);});
        frag.appendChild(tr);
      });
      rows.textContent='';rows.appendChild(frag);
    }
    if(stamp){var now=new Date();stamp.dateTime=now.toISOString();stamp.textContent=now.toLocaleTimeString();}
    var summary='Tank access '+(open?'open':'closed')+'. '+players+(players===1?' active player.':' active players.');
    if(live&&summary!==lastSummary){live.textContent=summary;lastSummary=summary;}
  }
  function poll(){
    fetch('/status.json',{headers:{'accept':'application/json'}}).then(function(r){return r.ok?r.json():Promise.reject(r.status);}).then(function(d){failures=0;apply(d);}).catch(function(){
      if(++failures>=3){stop();if(stamp)stamp.textContent='paused after repeated errors';}
    });
  }
  function start(){if(timer)return;timer=setInterval(poll,INTERVAL);btn.textContent='Pause auto-update';poll();}
  function stop(){if(timer){clearInterval(timer);timer=null;}btn.textContent='Resume auto-update';}
  btn.addEventListener('click',function(){
    var on=!!timer;
    if(on){stop();if(live)live.textContent='Auto-update paused.';}else{start();if(live)live.textContent='Auto-update resumed.';}
    lastSummary='';
    try{sessionStorage.setItem(KEY,on?'off':'on');}catch(e){}
  });
  var stored=null;try{stored=sessionStorage.getItem(KEY);}catch(e){}
  if(stored==='off')stop();else start();
}());</script>`;
}


const PAGE_CSS = `
  :root{color-scheme:dark;--bg:#0b0a14;--surface-1:#16142a;--surface-2:#201d3b;--surface-3:#2b2750;--text:#f3f1ff;--muted:#b9b4d6;--faint:#958eb5;--accent:#9580ff;--cyan:#22e6ff;--border:#3a355e;--strong:#847cb4;--focus:#ffd54a}
  *{box-sizing:border-box}
  html{min-height:100%;background:var(--bg)}
  body{min-height:100vh;margin:0;background:radial-gradient(circle at 14% -12%,rgba(34,230,255,.15),transparent 28rem),radial-gradient(circle at 90% 5%,rgba(143,123,255,.2),transparent 32rem),var(--bg);color:var(--text);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.22;background-image:radial-gradient(circle,#8f7bff 1px,transparent 1.5px);background-size:38px 38px;mask-image:linear-gradient(to bottom,#000,transparent 48%)}
  main{position:relative;z-index:1;max-width:1120px;margin:0 auto;padding:28px 20px 64px}
  h1{font-size:clamp(2rem,5vw,3.35rem);line-height:1.02;letter-spacing:-.045em;margin:0 0 10px;background:linear-gradient(100deg,#fff 25%,#aaf6ff 62%,#b9adff);-webkit-background-clip:text;background-clip:text;color:transparent}
  h2{line-height:1.18;letter-spacing:-.015em}
  p.sub{color:var(--muted);margin:0 0 24px;max-width:76ch}
  a{color:#b6a9ff;text-underline-offset:3px}
  a:hover{color:#d4ccff}
  /* Was :where(a,button) only, so the search inputs and selects on the register, the
     evidence pages and the policy index fell back to whatever the browser happened to
     draw — on some, nothing at all. Every focusable control is covered now. */
  :where(a,button,input,select,textarea,summary,[tabindex]):focus-visible{outline:3px solid var(--focus);outline-offset:3px}
  :where(input,select,textarea):focus-visible{outline-offset:1px}
  .site-header{position:relative;z-index:2;max-width:1160px;margin:0 auto;padding:18px 20px 0;display:flex;align-items:center;justify-content:space-between;gap:20px}
  .brand{display:flex;align-items:center;gap:10px;color:var(--text);text-decoration:none;min-width:max-content}
  .brand-mark{flex:0 0 auto;width:.65rem;height:.65rem;background:#d9ff43;box-shadow:.5rem -.5rem 0 #a489ff}
  .brand-copy{display:grid;gap:.18rem;line-height:1}.brand-copy strong{font:900 .82rem/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.16em}.brand-copy small{color:var(--muted);font:750 .58rem/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase}
  nav{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}
  nav a{min-height:38px;display:inline-flex;align-items:center;padding:6px 11px;border:1px solid var(--border);border-radius:999px;background:rgba(22,20,42,.72);color:var(--muted);font-size:.8rem;font-weight:800;text-decoration:none;backdrop-filter:blur(14px)}
  nav a:hover{border-color:var(--strong);background:var(--surface-2);color:var(--text)}
  .eyebrow{margin:0 0 8px;color:var(--cyan);font-size:.72rem;font-weight:900;letter-spacing:.16em;text-transform:uppercase}
  .page-intro{margin:12px 0 28px}.page-intro .sub{font-size:1rem}
  .hero-card{position:relative;overflow:hidden;border-color:#514a81!important;background:linear-gradient(145deg,rgba(32,29,59,.94),rgba(15,14,29,.96))!important;box-shadow:0 22px 70px rgba(0,0,0,.3)}
  .hero-card:after{content:"";position:absolute;right:-50px;top:-80px;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,rgba(34,230,255,.17),transparent 68%);pointer-events:none}
  .action-link{display:inline-flex;align-items:center;min-height:42px;padding:8px 15px;border:1px solid var(--strong);border-radius:999px;background:var(--surface-2);font-weight:800;text-decoration:none}
  table{width:100%;border-collapse:collapse}
  .table-scroll{width:100%;max-width:100%;margin:0 0 24px;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
  .table-scroll table{display:table;width:100%;min-width:var(--table-min,620px);margin:0;table-layout:auto}
  .table-scroll:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top}
  th{color:var(--muted);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
  thead th{background:#17152c}
  tbody tr{transition:background .15s ease}tbody tr:hover{background:rgba(143,123,255,.055)}
  .events-table,.capture-table,.history-table{table-layout:fixed!important}.events-table{--table-min:860px}.capture-table{--table-min:900px}.history-table{--table-min:1160px}.billing-table{--table-min:760px}.capacity-table{--table-min:650px}.api-table{--table-min:680px}.schema-table{--table-min:420px}
  .events-table :is(th,td):nth-child(1){width:15.5rem}.events-table :is(th,td):nth-child(2){width:6.5rem}.events-table :is(th,td):nth-child(3){width:12rem}.events-table :is(th,td):nth-child(4){width:11rem}
  .capture-table :is(th,td):nth-child(1){width:15.5rem}.capture-table :is(th,td):nth-child(2){width:6.5rem}.capture-table :is(th,td):nth-child(3){width:5.5rem}.capture-table :is(th,td):nth-child(4){width:11rem}.capture-table :is(th,td):nth-child(5){width:9rem}
  .history-table :is(th,td):nth-child(1){width:4.5rem}.history-table :is(th,td):nth-child(2){width:13rem}.history-table :is(th,td):nth-child(3){width:15rem}.history-table :is(th,td):nth-child(4){width:25rem}.history-table :is(th,td):nth-child(5){width:14rem}.history-table :is(th,td):nth-child(6){width:17rem}.history-table :is(th,td):nth-child(7){width:11rem}
  .cell-time,.cell-code,.cell-key,.cell-seq{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cell-code code{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;vertical-align:top}.cell-detail>span{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}.table-note{margin:-14px 0 24px;color:var(--faint);font-size:.72rem}#history-integrity{max-width:100%;overflow-wrap:anywhere;word-break:break-word}
  code{background:var(--surface-2);padding:2px 6px;border-radius:6px;font-family:ui-monospace,monospace}
  .m{font-weight:700;font-family:ui-monospace,monospace;font-size:.85rem}
  .g{color:#57ff5a}.o{color:#ff8a1f}.c{color:#22e6ff}.v{color:#a78bff}
  .card{background:rgba(22,20,42,.92);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin:0 0 14px;box-shadow:0 10px 30px rgba(0,0,0,.12);backdrop-filter:blur(10px)}
  .api-card{position:relative;padding-left:24px;color:var(--text);min-width:0}
  .api-card p,.api-card li,.api-summary,.api-card :is(h2,h3){overflow-wrap:anywhere}.api-card h3{margin:16px 0 8px;font-size:.82rem;font-weight:900;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}.api-index{display:block}.api-index ul{display:grid;grid-template-columns:repeat(auto-fill,minmax(266px,1fr));gap:2px;margin:0;padding:0;list-style:none}.api-index li{min-width:0}.api-index a{min-height:36px;display:flex;gap:9px;align-items:center;padding:5px 8px;border:1px solid transparent;border-radius:9px;background:none;color:var(--text);text-decoration:none;overflow-wrap:anywhere}.api-index a:hover,.api-index a:focus-visible{border-color:var(--strong);background:var(--surface-2);color:var(--text)}.api-index code{font-size:.82rem;color:#b6a9ff}.api-index .method-pill{min-width:54px;flex:none}.api-card:before{content:"";position:absolute;left:0;top:16px;bottom:16px;width:4px;border-radius:4px}.api-card.g:before{background:#57ff5a}.api-card.o:before{background:#ff8a1f}.api-card.c:before{background:#22e6ff}.api-card.v:before{background:#a78bff}.api-route{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0;font-size:1rem;font-weight:800}.api-summary{margin:10px 0 0;font-size:1rem;font-weight:800}.method-pill{display:inline-flex;align-items:center;justify-content:center;min-width:62px;padding:3px 8px;border:1px solid currentColor;border-radius:999px;background:rgba(255,255,255,.035);font-size:.72rem;letter-spacing:.08em}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .kpi{font-size:1.6rem;font-weight:800}
  .kpi small{display:block;font-size:.75rem;color:#b9b4d6;font-weight:600}
  .metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:0 0 14px}.metric-grid>*{min-width:0}.stat-grid{grid-template-columns:repeat(6,minmax(0,1fr))}.status-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.spend-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.spend-metrics .metric-value{display:-webkit-box;min-height:2.15em;overflow:hidden;white-space:normal;overflow-wrap:anywhere;-webkit-box-orient:vertical;-webkit-line-clamp:2}
  .metric-card{position:relative;display:grid;grid-template-rows:auto auto auto 1fr;align-content:start;overflow:hidden;min-width:0;min-height:124px;padding:15px 16px;border:1px solid #3a355e;border-radius:14px;background:linear-gradient(145deg,#19172f,#121123)}
  .metric-card:after{content:"";position:absolute;right:-35px;bottom:-45px;width:110px;height:110px;border-radius:50%;background:color-mix(in srgb,currentColor 10%,transparent)}
  .metric-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.metric-icon{width:30px;height:30px;color:#a78bff}.metric-icon svg{display:block;width:100%;height:100%}
  .metric-value{max-width:100%;margin-top:10px;overflow:hidden;font-size:clamp(1.25rem,2.6vw,2rem);font-weight:900;line-height:1.08;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}.metric-label,.metric-detail{display:-webkit-box;max-width:100%;overflow:hidden;-webkit-box-orient:vertical}.metric-label{min-height:2.3em;margin-top:7px;color:#d8d4ef;font-size:.72rem;font-weight:800;line-height:1.15;letter-spacing:.07em;text-transform:uppercase;-webkit-line-clamp:2}.metric-detail{color:#8f89ae;font-size:.7rem;line-height:1.25;-webkit-line-clamp:2;overflow-wrap:anywhere}
  .tone-green{color:#4ade80}.tone-yellow{color:#f6c445}.tone-red{color:#ff5f66}.tone-cyan{color:#22e6ff}.tone-violet{color:#a78bff}
  .gauge-card{padding:18px 20px}.gauge-layout{display:grid;grid-template-columns:minmax(260px,1.1fr) minmax(220px,.9fr);gap:24px;align-items:center}.gauge-svg{display:block;width:100%;max-width:430px;margin:auto}.gauge-needle{transition:transform .45s cubic-bezier(.2,.8,.2,1)}.gauge-readout{text-align:center}.gauge-readout strong{display:block;font-size:2.1rem;line-height:1;font-variant-numeric:tabular-nums}.gauge-readout span{display:block;color:#b9b4d6;font-size:.78rem}.meter-pill{display:inline-flex!important;width:max-content;margin:8px auto 0;padding:3px 9px;border:1px solid currentColor;border-radius:999px;font-weight:900;letter-spacing:.08em}

  button{min-height:44px;font:inherit;font-weight:900;border:0;border-radius:10px;padding:10px 16px;cursor:pointer;box-shadow:0 5px 0 rgba(0,0,0,.22)}
  button:active{transform:translateY(2px);box-shadow:0 3px 0 rgba(0,0,0,.22)}
  button.danger{background:#ff6b6b;color:#1a0606}button.restore{background:#4ade80;color:#07130b}button.secondary{background:#8f7bff;color:#0b0a14}button:disabled{cursor:wait;opacity:.65}
  .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
  .live-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 18px}
  .live-controls .sub{margin:0}
  .server-controls{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}.server-controls>*{flex:1 1 240px}.control-output{margin-top:12px;white-space:pre-wrap;overflow-wrap:anywhere}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
  .skip-link{position:absolute;left:-9999px;top:0;z-index:100;padding:10px 16px;border-radius:0 0 10px 0;background:var(--cyan);color:#07131a;font-weight:800;text-decoration:none}.skip-link:focus{left:0}main:focus{outline:none}table caption{caption-side:top;padding:0 0 8px;color:var(--muted);font-size:.78rem;text-align:left}[hidden]{display:none!important}.history-list{display:grid;gap:10px;margin-top:14px}.history-item{display:grid;grid-template-columns:7.2rem 1fr auto;gap:14px;align-items:start;padding:14px;border:1px solid var(--border);border-radius:12px;background:rgba(11,10,20,.48)}.history-sequence{color:var(--cyan);font:800 .76rem/1.4 ui-monospace,monospace}.history-copy strong{display:block}.history-copy p{margin:3px 0;color:var(--muted)}.history-meta{color:var(--faint);font-size:.75rem}.history-receipt{max-width:11rem;overflow:hidden;color:var(--faint);font:700 .72rem/1.4 ui-monospace,monospace;text-overflow:ellipsis;white-space:nowrap}.history-item--focus{border-color:var(--cyan);box-shadow:0 0 0 2px rgba(34,230,255,.28)}.history-pager{display:flex;gap:12px;align-items:center;justify-content:center;margin:16px 0 0;color:var(--muted);font-size:.8rem}.pager-btn{padding:7px 14px;border:1px solid var(--strong);border-radius:999px;background:rgba(11,10,20,.52);color:var(--text);font:inherit;font-weight:700;cursor:pointer}.pager-btn:disabled{opacity:.4;cursor:default}.pager-btn[aria-disabled="true"]{background:none;color:var(--faint);cursor:default}.integrity-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--muted)}.incident-card{margin:0 0 12px}.incident-card--active{border-color:#ff8a1f}.incident-dot{display:inline-block;width:9px;height:9px;margin-right:7px;border-radius:3px;vertical-align:middle}.integrity-line code{overflow-wrap:anywhere}.integrity-badge{display:inline-flex;padding:3px 8px;border:1px solid #4ade80;border-radius:999px;color:#4ade80;font-size:.7rem;font-weight:900;letter-spacing:.07em;text-transform:uppercase}.integrity-badge.verdict-pass{border-color:#4ade80;color:#4ade80}.integrity-badge.verdict-fail{border-color:#ff6b6b;color:#ff6b6b}.integrity-badge.verdict-idle{border-color:var(--strong);color:var(--muted)}
  /* ── Spend ── */
  .spend-hero{display:grid;grid-template-columns:minmax(0,320px) minmax(0,1fr);gap:14px;margin:0 0 14px}
  .spend-hero>.card{margin:0;min-width:0}
  .spend-hero .gauge-layout{grid-template-columns:1fr;gap:8px}
  .spend-hero .gauge-svg{max-width:260px}
  .spend-hero .gauge-readout>strong{font-size:clamp(1.6rem,4vw,2.2rem)}
  .trend-card{display:grid;align-content:start;gap:2px}
  .trend-card h2{margin:2px 0 10px;font-size:1.05rem}
  .trend-card .sub{margin:10px 0 0;font-size:.78rem}
  .trend-scroll{width:100%;max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:thin}
  .trend-scroll:focus-visible{outline:3px solid var(--focus);outline-offset:3px}
  .trend-scroll svg{display:block;min-width:420px;width:100%;height:auto}
  .trend-empty{display:grid;gap:4px;place-content:center;min-height:150px;padding:14px;border:1px dashed var(--border);border-radius:12px;text-align:center}
  .trend-empty strong{color:var(--cyan);font:800 1.35rem/1 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
  .trend-empty span{color:var(--muted);font-size:.78rem}
  /* One shape for every meter: service, used to date, limit, today, daily average. */
  .meter-table{--table-min:940px;table-layout:fixed!important}
  .meter-table :is(th,td){vertical-align:top}
  .meter-table :is(th,td):nth-child(1){width:15rem}
  .meter-table :is(th,td):nth-child(2){width:8rem}
  .meter-table :is(th,td):nth-child(3){width:9.5rem}
  .meter-table :is(th,td):nth-child(4){width:13rem}
  .meter-service{text-align:left;font-weight:400}
  .meter-service strong{display:block;color:var(--text);overflow-wrap:anywhere}
  .meter-service span{display:block;margin-top:2px;color:var(--faint);font-size:.74rem;overflow-wrap:anywhere}
  .meter-usage,.meter-limit{color:var(--muted);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
  /* The stack lives in a wrapper, never on the cell: a td with display:grid stops being a
     table-cell and the browser wraps it in an anonymous row of its own. */
  .meter-stack{display:grid;gap:5px;min-width:0}
  .meter-daily__value{color:var(--text);font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
  /* The track is a five-decade log axis: ticks at 0.001 / 0.01 / 0.1 / 1 / 10 / 100 % of
     the limit. On a linear axis every real row sits in the bottom tenth and a meter a
     thousand times heavier than its neighbour looks identical to it. */
  .meter-bar{position:relative;display:block;height:9px;border-radius:999px;background:#292544;background-image:repeating-linear-gradient(90deg,rgba(233,230,255,.22) 0 1px,transparent 1px 20%)}
  .meter-bar>i{display:block;height:100%;border-radius:999px;background:#4ade80}
  .meter-bar.is-amber>i{background:#f6c445}.meter-bar.is-red>i{background:#ff5f66}
  .meter-bar>b{position:absolute;top:-3px;width:2px;height:15px;border-radius:1px;background:#e9e6ff;transform:translateX(-1px)}
  .meter-share{color:var(--faint);font-size:.72rem;font-variant-numeric:tabular-nums}
  .meter-share b{color:var(--muted);font-weight:700}
  .meter-legend{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:0 0 12px;color:var(--faint);font-size:.72rem}
  .meter-legend span{display:inline-flex;gap:6px;align-items:center}
  .meter-legend i{display:inline-block;width:22px;height:9px;border-radius:999px;background:#4ade80}
  .meter-legend b{display:inline-block;width:2px;height:13px;border-radius:1px;background:#e9e6ff}
  .meter-note{color:var(--faint);font-style:italic}
  @media(max-width:860px){.spend-hero{grid-template-columns:1fr}}
  .timeline-scroll{width:100%;max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:thin;-webkit-overflow-scrolling:touch}.timeline-scroll:focus-visible{outline:3px solid var(--focus);outline-offset:3px}.timeline-scroll svg{display:block;min-width:520px;width:100%;height:112px}.incident-chart svg{min-width:768px}.availability-chart svg{min-width:768px}.timeline-key{display:grid;gap:8px;margin:10px 0 0;color:var(--muted);font-size:.76rem}.timeline-key__group{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.timeline-key__label{min-width:9.5rem;color:var(--faint);font-size:.68rem;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.timeline-key :is(span,a){display:inline-flex;align-items:center;gap:6px}.timeline-key :is(span,a)>b{color:var(--text);font-variant-numeric:tabular-nums}.timeline-key a{padding:2px 8px;border:1px solid var(--border);border-radius:999px;color:inherit;text-decoration:none}.timeline-key a:hover,.timeline-key a:focus-visible{border-color:var(--cyan);color:var(--text)}.timeline-key i{width:10px;height:10px;border-radius:3px;flex:none}.timeline-key-note{grid-column:1/-1;margin:2px 0 0;color:var(--faint);font-size:.72rem;font-style:italic}svg a{cursor:pointer}svg a:focus-visible{outline:2px solid var(--focus)}@media(max-width:560px){.timeline-key__label{min-width:100%}}.key-green{background:#4ade80}.key-violet{background:#8f7bff}.key-red{background:#ff6b6b}.key-indigo{background:#6d8bff}.key-amber{background:#ff8a1f}.key-crimson{background:#e5484d}.key-yellow{background:#ffe14d}
  .log-room{padding:0;overflow:hidden}.log-room>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px;padding:14px 18px;cursor:pointer;list-style:none}.log-room>summary::-webkit-details-marker{display:none}.log-room>summary:after{content:"+";color:var(--cyan);font-size:1.35rem;font-weight:900}.log-room[open]>summary{border-bottom:1px solid var(--border)}.log-room[open]>summary:after{content:"−"}.log-summary{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}.log-count{padding:2px 8px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font-size:.72rem;font-weight:800}.log-room-body{padding:16px 18px 4px}.log-actions{display:flex;justify-content:flex-end;margin-bottom:10px}.log-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) minmax(150px,.42fr) auto;gap:10px;align-items:end;margin:0 0 14px}.log-toolbar label{display:grid;gap:4px;color:var(--muted);font-size:.7rem;font-weight:850;letter-spacing:.06em;text-transform:uppercase}.log-toolbar :is(input,select){width:100%;min-height:42px;border:1px solid var(--strong);border-radius:9px;background:var(--surface-1);color:var(--text);padding:8px 10px;font:inherit}.log-visible-count{padding:10px 0;color:var(--faint);font-size:.74rem;white-space:nowrap}.table-sort{min-height:0;padding:0;border-radius:0;background:none;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;box-shadow:none}.table-sort:active{transform:none;box-shadow:none}.table-sort:after{content:" ↕";color:var(--faint)}.table-sort[data-direction="asc"]:after{content:" ↑";color:var(--cyan)}.table-sort[data-direction="desc"]:after{content:" ↓";color:var(--cyan)}
  pre{background:var(--surface-1);border:1px solid var(--border);border-radius:10px;padding:14px;overflow:auto}
  @media(max-width:900px){}
  @media(max-width:760px){.site-header{align-items:flex-start;flex-direction:column}.site-header nav{justify-content:flex-start}.site-header{padding:14px 12px 0}main{padding:22px 12px 48px}.gauge-layout{grid-template-columns:1fr}.metric-grid,.stat-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.status-metrics,.spend-metrics,.metric-card{min-height:112px;padding:12px}.metric-icon{width:25px;height:25px}.metric-value{font-size:clamp(1.05rem,5vw,1.45rem)}th,td{padding:8px}.history-item{grid-template-columns:1fr}.history-receipt{max-width:100%}.log-toolbar{grid-template-columns:1fr 1fr}.log-visible-count{grid-column:1/-1;padding:0}}
  @media(max-width:420px){nav a{padding:5px 9px}.brand-copy small{display:none}.spend-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.spend-metrics .metric-value{font-size:clamp(.95rem,4.4vw,1.2rem)}.log-room>summary{padding:12px}.log-room-body{padding:12px 12px 2px}.log-toolbar{grid-template-columns:1fr}}


  /* ── MVP overview ── */
  .trust-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 20px}
  .trust-tile{position:relative;display:grid;gap:4px;min-height:132px;padding:16px;border:1px solid var(--border);border-radius:14px;background:var(--surface-1);color:var(--text);text-decoration:none}
  .trust-tile:hover{border-color:var(--strong);background:var(--surface-2)}
  .trust-tile__label{color:var(--muted);font-size:.72rem;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
  .trust-tile__value{font-size:clamp(1.4rem,3.4vw,2rem);font-weight:800;letter-spacing:-.02em;line-height:1.1;overflow-wrap:anywhere}
  .trust-tile__detail{color:var(--muted);font-size:.82rem}
  .trust-tile__go{position:absolute;right:14px;bottom:12px;color:var(--faint);font-weight:900}
  .trust-tile.tone-green .trust-tile__value{color:#4ade80}.trust-tile.tone-cyan .trust-tile__value{color:#22e6ff}.trust-tile.tone-violet .trust-tile__value{color:#c4b5fd}.trust-tile.tone-red .trust-tile__value{color:#ff8c92}
  .page-intro dfn{font-style:normal;font-weight:800;color:var(--text);border-bottom:1px dotted var(--strong)}
  .action-links{display:flex;flex-wrap:wrap;gap:14px;margin:0}
  .home-hero{max-width:none;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(320px,.95fr);gap:clamp(28px,6vw,80px);align-items:center;padding:clamp(54px,10vw,112px) 0 clamp(36px,7vw,72px)}
  .home-hero h1{max-width:12ch;margin:12px 0 20px;font-size:clamp(3rem,8vw,7rem);line-height:.9;letter-spacing:-.065em}
  .home-hero__copy>p{max-width:760px;margin:0 0 24px;color:var(--muted);font-size:clamp(1.05rem,2vw,1.35rem)}
  .workload-art{position:relative;min-height:340px;margin:0;overflow:hidden;border:1px solid var(--border);border-radius:22px;background:var(--surface-1);box-shadow:0 32px 90px rgba(0,0,0,.38)}
  .workload-art:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,10,20,.05),rgba(11,10,20,.76))}
  .workload-art img{width:100%;height:100%;min-height:340px;display:block;object-fit:cover;filter:blur(7px) saturate(.78) brightness(.72);transform:scale(1.05)}
  .workload-art figcaption{position:absolute;z-index:1;left:20px;bottom:18px;color:var(--text);font-size:.72rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
  .section-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin:0 0 20px}



  /* ── Evidence ── */
  .evidence-intro{padding:clamp(48px,9vw,96px) 0 26px}
  .evidence-intro h1{max-width:18ch}
  .evidence-jump{justify-content:flex-start;margin-top:22px}
  .evidence-block{scroll-margin-top:18px;margin:clamp(42px,8vw,84px) 0 0;padding-top:clamp(28px,5vw,52px);border-top:1px solid var(--border)}
  .card.evidence-block{padding:clamp(20px,4vw,34px)}
  .degradation-ladder{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;margin:22px 0;padding:1px;background:var(--border);list-style:none}
  .degradation-ladder li{min-width:0;padding:18px;background:var(--surface-1)}
  .degradation-ladder strong,.degradation-ladder span{display:block}
  .degradation-ladder strong{color:var(--cyan);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em}
  .degradation-ladder span{margin-top:12px;color:var(--muted);font-size:.82rem}
  @media(max-width:900px){.home-hero{grid-template-columns:1fr}.workload-art{min-height:280px}.degradation-ladder{grid-template-columns:1fr}}
  @media(max-width:700px){.section-head{align-items:flex-start;flex-direction:column}}
  @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto!important}.workload-art img{transform:none}.trust-tile,tbody tr{transition:none}}


  @media(max-width:760px){.trust-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}

  @media(max-width:420px){.trust-grid{grid-template-columns:1fr}}

  /* ── Contrast preferences ──
     Borders and muted text move to values that clear 4.5:1
     against the surfaces they sit on, and forced-colors hands every one of them back to the
     system palette rather than fighting it. */
  @media(prefers-contrast:more){
    :root{--muted:#ded9f5;--faint:#cdc7e8;--border:#8079ad;--strong:#c3bce4;--surface-1:#100e20;--surface-2:#191634}
    a{color:#cfc4ff}
    .metric-detail,.sub,.timeline-key-note{color:var(--muted)}
    :where(a,button,input,select,textarea,summary,[tabindex]):focus-visible{outline-width:4px}
  }
  @media(forced-colors:active){
    .metric-card,.card,.trust-tile{border:1px solid CanvasText}
    .meter-pill,.integrity-badge{border:1px solid CanvasText;forced-color-adjust:none;background:Canvas;color:CanvasText}
    :where(a,button,input,select,textarea,summary,[tabindex]):focus-visible{outline:3px solid Highlight;outline-offset:2px}
    .key-dot,.incident-dot,.meter-fill{forced-color-adjust:none}
    svg a:focus-visible{outline:3px solid Highlight}
  }
  /* Estate footer. The primary navigation stays focused while this carries supporting
     routes so that no page is a dead end. Overrides the bare "nav a" pill rules
     above by specificity (0,1,2 against 0,0,2), not by order. */
  .site-footer{position:relative;z-index:1;max-width:1120px;margin:0 auto;padding:0 20px 56px}
  .site-footer-inner{border-top:1px solid var(--border);padding-top:22px}
  .site-footer nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px 24px;justify-content:stretch}
  .footer-col{display:grid;gap:8px;align-content:start}
  .footer-head{color:var(--cyan);font-size:.68rem;font-weight:900;letter-spacing:.16em;text-transform:uppercase}
  .site-footer ul{list-style:none;margin:0;padding:0;display:grid;gap:4px}
  .site-footer nav a{min-height:26px;display:inline-flex;align-items:center;padding:3px 2px;border:0;border-radius:6px;background:none;color:var(--muted);font-size:.82rem;font-weight:700;text-decoration:none;backdrop-filter:none}
  .site-footer nav a:hover{border-color:transparent;background:none;color:var(--text);text-decoration:underline}
  .footer-note{margin:20px 0 0;color:var(--muted);font-size:.76rem;max-width:76ch}
  @media(max-width:760px){.site-footer{padding:0 12px 44px}.site-footer nav{grid-template-columns:1fr 1fr}}

  /* ST-059: CSP-safe presentation. All document styles are external first-party CSS. */
  .downtime-page{display:grid;min-height:100vh;place-items:center;overflow-x:hidden;text-align:center}.downtime{width:min(720px,calc(100% - 24px));min-width:0;padding:24px}.downtime .card{width:100%;min-width:0;padding:clamp(26px,7vw,52px)}
  .downtime-mark{width:min(210px,64vw);margin:0 auto 12px;filter:drop-shadow(0 16px 34px rgba(34,230,255,.2))}.downtime-quip{margin:0 auto 22px;color:var(--muted)}.downtime-trigger{display:flex;align-items:center;justify-content:center;gap:10px;width:max-content;max-width:100%;margin:0 auto 22px;padding:8px 12px;border:1px solid var(--border);border-radius:999px;background:rgba(11,10,20,.52);overflow:hidden}.downtime-trigger span{color:var(--faint);font-size:.68rem;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.downtime-trigger strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.downtime .action-link{max-width:100%;justify-content:center;text-align:center;white-space:normal}
  .u-m-6-0-10{margin:6px 0 10px}.u-m-14-0-0{margin:14px 0 0}.u-m-12-0-0{margin:12px 0 0}.u-m-8-0-0{margin:8px 0 0}.u-card-heading{margin-top:0;font-size:1.1rem}.u-m-10-0-0{margin:10px 0 0}.u-m-0{margin:0}.u-m-6-0-14{margin:6px 0 14px}.u-m-6-0-0{margin:6px 0 0}.u-incident-heading{margin:0 0 4px;font-size:1.1rem}.u-m-0-0-10{margin:0 0 10px}.u-panel-heading{margin:0 0 10px;font-size:1.1rem}.u-panel-heading-tight{margin:0 0 8px;font-size:1.1rem}.u-mt-0{margin-top:0}.u-ops-pulse-heading{font-size:1rem;letter-spacing:.08em;text-transform:uppercase;color:#b9b4d6}.u-mt-14{margin-top:14px}.u-m-0-0-8{margin:0 0 8px}.u-font-1rem{font-size:1rem}.u-api-description{margin:6px 0 0;color:#b9b4d6}.u-index-heading{margin:0 0 10px;font-size:1.05rem}.coverage-reference{margin-left:8px}
  .tr-axis{fill:#8f89ae;font:500 9px ui-monospace,SFMono-Regular,Consolas,monospace}.tr-value{fill:#22e6ff;font:800 10px ui-monospace,SFMono-Regular,Consolas,monospace}.tr-today{fill:#8f7bff;font:700 9px ui-monospace,SFMono-Regular,Consolas,monospace}
  .ic-axis{fill:#8f89ae;font:500 9px ui-monospace,SFMono-Regular,Consolas,monospace}.ic-lane{fill:#b9b4d6;font:600 11px ui-sans-serif,system-ui,sans-serif}.ic-count{fill:#8f89ae;font-weight:800}a:focus-visible .ic-hit{fill:rgba(255,213,74,.22);stroke:#ffd54a;stroke-width:2}

  .tl-lane{fill:#b9b4d6;font:600 11px ui-sans-serif,system-ui,sans-serif}.tl-axis{fill:#8f89ae;font:500 10px ui-monospace,SFMono-Regular,Consolas,monospace}.tl-marker{transition:transform 120ms ease}a:hover .tl-marker,a:focus-visible .tl-marker{transform:translateY(-2px)}a:focus-visible .tl-hit{fill:rgba(255,213,74,.22);stroke:#ffd54a;stroke-width:2}
  .meter-bar{display:block;width:100%;height:9px;overflow:visible}.meter-track{fill:#292544}.meter-ticks{fill:none;stroke:rgba(233,230,255,.22);stroke-width:.5}.meter-fill{fill:#4ade80}.meter-bar.is-amber .meter-fill{fill:#f6c445}.meter-bar.is-red .meter-fill{fill:#ff5f66}.meter-marker{stroke:#e9e6ff;stroke-width:2}
  @media(prefers-reduced-motion:reduce){.tl-marker{transition:none}}@media(max-width:420px){.downtime{padding:12px}.downtime .card{padding:24px 18px}.downtime-trigger{width:100%}}
`;

/**
 * The page stylesheet, served once and cached, instead of inlined into every response.
 *
 * PAGE_CSS was inlined into every server-rendered page and html() sets `no-store` on all of
 * them, so 38.6 KB of identical CSS crossed the wire on every view: 85% of /trust/, 79% of a
 * policy document, and all of it metered egress against the ceiling /spend/ reports. The
 * policy split made this worse by turning one page into twenty that each carried the whole
 * stylesheet.
 *
 * The file name carries a hash of its own contents, so a `no-store` page can never pair with
 * a stale stylesheet -- different CSS is a different URL, which is what makes the immutable
 * cache-control on it safe. The hash is FNV-1a rather than SHA-256 because it has to be
 * computed synchronously at module scope, and because it is a cache key that nothing trusts
 * rather than a security control.
 */
function cssFingerprint(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
const PAGE_CSS_PATH = `/styles/page-${cssFingerprint(PAGE_CSS)}.css`;

function pageCssResponse(): Response {
  return new Response(PAGE_CSS, {
    headers: {
      "content-type": "text/css; charset=utf-8",
      "cache-control": "public, max-age=31536000, immutable",
      ...SECURITY_HEADERS,
    },
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

/** Public copy guard: records stored before the Shark Tank rename still read Arena/Lobby. */
function tankCopy(value: string): string {
  return value.replace(/\b(?:Arena|Lobby|Lobbies)\b/g, "Tank").replace(/\b(?:arena|lobby)\b/g, "tank").replace(/\blobbies\b/g, "tanks");
}

type MetricIcon = "players" | "bot" | "rooms" | "uptime" | "availability" | "traffic" | "requests" | "audit";
function metricIcon(name: MetricIcon): string {
  const paths: Record<MetricIcon, string> = {
    players: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 19c.5-4 2.4-6 5.5-6s5 2 5.5 6M14 14c3.4-.7 5.7.9 6.5 4.5"/>',
    bot: '<rect x="5" y="7" width="14" height="11" rx="3"/><path d="M12 3v4M8.5 12h.01M15.5 12h.01M9 16h6M3 11h2M19 11h2"/>',
    rooms: '<path d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z"/>',
    uptime: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M7 3.8 5.2 2M17 3.8 18.8 2"/>',
    availability: '<path d="M3 12h4l2.2-5 4.2 10 2.2-5H21"/><path d="M4 20h16"/>',
    traffic: '<path d="M4 18h16M6 18l2-8h8l2 8M9 10V6h6v4M10 14h4"/>',
    requests: '<path d="M4 7h12M13 4l3 3-3 3M20 17H8M11 14l-3 3 3 3"/>',
    audit: '<path d="M6 3h9l3 3v15H6zM15 3v4h4M9 11h6M9 15h6"/>',
  };
  return `<span class="metric-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg></span>`;
}
function metricCard(value: string | number, label: string, detail: string, icon: MetricIcon, tone = "tone-violet", id = ""): string {
  return `<div class="metric-card ${tone}"><div class="metric-head">${metricIcon(icon)}</div><div class="metric-value"${id ? ` id="${id}"` : ""}>${value}</div><div class="metric-label">${label}</div><div class="metric-detail">${detail}</div></div>`;
}
function billingGaugeSvg(prefix: string, projectedMonthly = 0, currentSpend = 0, measuredLabel = "Measured this window"): string {
  const ratio = Math.max(0, Math.min(1, projectedMonthly / 5)), angle = -90 + ratio * 180;
  const tone = projectedMonthly > 5 ? "tone-red" : projectedMonthly > 0 ? "tone-yellow" : "tone-green";
  const state = projectedMonthly > 5 ? "REDLINE" : projectedMonthly > 0 ? "METERED" : "INCLUDED";
  return `<div class="gauge-layout"><svg class="gauge-svg" viewBox="0 0 220 145" role="img" aria-labelledby="${prefix}-gauge-title ${prefix}-gauge-desc"><title id="${prefix}-gauge-title">Projected monthly variable spend above included free-tier limits</title><desc id="${prefix}-gauge-desc">Yellow indicates projected spend up to five dollars. Red indicates more than five dollars.</desc><path d="M22 112 A88 88 0 0 1 198 112" pathLength="100" fill="none" stroke="#292544" stroke-width="19"/><path d="M22 112 A88 88 0 0 1 198 112" pathLength="100" fill="none" stroke="#4ade80" stroke-width="19" stroke-dasharray="4 96"/><path d="M22 112 A88 88 0 0 1 198 112" pathLength="100" fill="none" stroke="#f6c445" stroke-width="19" stroke-dasharray="84 16" stroke-dashoffset="-4"/><path d="M22 112 A88 88 0 0 1 198 112" pathLength="100" fill="none" stroke="#ff5f66" stroke-width="19" stroke-dasharray="12 88" stroke-dashoffset="-88"/><g id="${prefix}-gauge-needle" class="gauge-needle ${tone}" transform="rotate(${angle.toFixed(1)} 110 112)"><line x1="110" y1="112" x2="110" y2="35" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="110" cy="112" r="9" fill="currentColor"/><circle cx="110" cy="112" r="4" fill="#16142a"/></g><text x="20" y="137" fill="#8f89ae" font-size="9">$0</text><text x="188" y="137" fill="#ff8c92" font-size="9">$5+</text></svg><div class="gauge-readout ${tone}"><strong id="${prefix}-gauge-value">$${projectedMonthly.toFixed(2)}</strong><span>projected spend above free tier / 30 days</span><span id="${prefix}-gauge-state" class="meter-pill">${state}</span><p class="sub u-m-14-0-0">${esc(measuredLabel)}: <b id="${prefix}-current-spend">$${currentSpend.toFixed(8)}</b></p></div></div>`;
}

/**
 * Spend trend.
 *
 * The page previously reported cost as one instantaneous number, which cannot answer
 * the only question that matters about a bill: is it flat, creeping, or accelerating?
 * This plots the cumulative metered spend samples the Lobby records hourly. The y-axis
 * auto-scales to the data — pinning it to the $5 hard stop would flatten a
 * sub-cent line into the axis and show nothing at all.
 */
function spendTrendSvg(samples: Array<{ ts: number; usd: number }>, hardLimitUsd: number): string {
  const width = 640, height = 180, left = 54, right = 12, top = 14, bottom = 30;
  const plotW = width - left - right, plotH = height - top - bottom;
  if (samples.length < 2) {
    const only = samples[0];
    return `<div class="trend-empty"><strong>$${(only?.usd ?? 0).toFixed(8)}</strong>
      <span>${only ? "First sample recorded. The trend line draws once a second hourly sample lands." : "No spend samples recorded yet."}</span></div>`;
  }
  const first = samples[0].ts, span = Math.max(1, samples[samples.length - 1].ts - first);
  const values = samples.map((sample) => sample.usd);
  const hi = Math.max(...values), lo = Math.min(...values), range = hi - lo;
  // A cumulative bill plotted from $0 is a flat line pinned to the ceiling as soon as the
  // increments are small relative to the total — true, and it shows nothing. The axis is
  // fitted to the data and then snapped out to round tick values, so the line uses the
  // height it has and the labels are readable numbers rather than six-decimal noise. An
  // area fill off a non-zero baseline reads as volume, which would be a lie, so the fill
  // only appears when the axis genuinely starts at zero.
  const flat = range <= 0;
  const pad = flat ? Math.max(hi * 0.1, 1e-8) : range * 0.15;
  const step = niceAxisStep(Math.max(hi + pad - (flat ? 0 : Math.max(0, lo - pad)), 1e-12));
  const base = flat ? 0 : Math.max(0, Math.floor(Math.max(0, lo - pad) / step) * step);
  const top_ = Math.max(Math.ceil((hi + pad) / step) * step, base + step);
  const zoomed = base > 0;
  const scale = Math.max(top_ - base, 1e-12);
  const decimals = Math.min(8, Math.max(2, Math.ceil(-Math.log10(step)) + 1));
  const x = (ts: number) => left + ((ts - first) / span) * plotW;
  const y = (usd: number) => top + plotH - ((usd - base) / scale) * plotH;
  const line = samples.map((sample, index) => `${index ? "L" : "M"}${x(sample.ts).toFixed(1)} ${y(sample.usd).toFixed(1)}`).join(" ");
  const area = zoomed ? "" : `<path d="${line} L${x(samples[samples.length - 1].ts).toFixed(1)} ${(top + plotH).toFixed(1)} L${x(first).toFixed(1)} ${(top + plotH).toFixed(1)} Z" fill="rgba(34,230,255,.14)"/>`;
  const ticks: string[] = [];
  for (let value = base; value <= top_ + step / 2 && ticks.length < 9; value += step) {
    const gy = y(value);
    ticks.push(`<line x1="${left}" y1="${gy.toFixed(1)}" x2="${width - right}" y2="${gy.toFixed(1)}" stroke="#3a355e" stroke-width="1"/>`
      + `<text x="${left - 6}" y="${(gy + 3).toFixed(1)}" class="tr-axis" text-anchor="end">$${value.toFixed(decimals)}</text>`);
  }
  const last = samples[samples.length - 1];
  const dot = `<circle cx="${x(last.ts).toFixed(1)}" cy="${y(last.usd).toFixed(1)}" r="3.5" fill="#22e6ff"/>`
    + `<text x="${(x(last.ts) - 6).toFixed(1)}" y="${Math.max(top + 9, y(last.usd) - 8).toFixed(1)}" class="tr-value" text-anchor="end">$${last.usd.toFixed(decimals)}</text>`;
  // Where today started, so "spend today" above the chart has a visible span on it.
  const midnight = Date.parse(`${new Date(last.ts).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const todayMark = midnight > first && midnight < last.ts
    ? `<line x1="${x(midnight).toFixed(1)}" y1="${top}" x2="${x(midnight).toFixed(1)}" y2="${(top + plotH).toFixed(1)}" stroke="#8f7bff" stroke-width="1.5" stroke-dasharray="3 3"/>`
      + `<text x="${(x(midnight) + 4).toFixed(1)}" y="${(top + 10).toFixed(1)}" class="tr-today">today</text>`
    : "";
  const day = (ts: number) => new Date(ts).toISOString().slice(5, 16).replace("T", " ");
  return `<div class="trend-scroll" role="region" aria-label="Cumulative spend trend" tabindex="0"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(`Cumulative metered spend rose from $${lo.toFixed(8)} to $${hi.toFixed(8)} across ${samples.length} hourly samples, against a $${hardLimitUsd.toFixed(2)} hard stop${zoomed ? `. The axis starts at $${base.toFixed(decimals)}, not zero` : ""}`)}">
    ${ticks.join("")}
    ${area}
    ${todayMark}
    <path d="${line}" fill="none" stroke="#22e6ff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dot}
    <text x="${left}" y="${height - 10}" class="tr-axis">${esc(day(first))}</text>
    ${zoomed ? `<text x="${(left + plotW / 2).toFixed(0)}" y="${height - 10}" class="tr-axis" text-anchor="middle">axis starts at $${base.toFixed(decimals)}</text>` : ""}
    <text x="${width - right}" y="${height - 10}" class="tr-axis" text-anchor="end">${esc(day(last.ts))}</text>
  </svg></div>`;
}

/** Round axis step (1, 2, 2.5 or 5 × a power of ten) covering `range` in about four steps. */
function niceAxisStep(range: number): number {
  const raw = range / 4, magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const factor = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  // Spend is carried to eight decimals, so a finer step would print the same label twice.
  return Math.max(factor * magnitude, 1e-8);
}

/** One row of the unified meter: Service / Used to date / Limit / Today / Daily average. */
interface MeterRow {
  service: string;
  /** Plain-English action that drives this meter — the old mapping table, inlined. */
  driver: string;
  usage: string;
  limit: string;
  /** What today has consumed so far. For a stock (storage) this is the level held. */
  today: string;
  /** Lifetime daily average. For a stock there is no rate, so this reads as a level. */
  daily: string;
  /** 0..1 of today's share of the daily-normalised limit, or null when not comparable. */
  todayShare: number | null;
  /** 0..1 for the daily average, drawn as a marker on the same axis. */
  averageShare: number | null;
  /** What the bar is a share of. Stocks are a level against the whole allowance. */
  shareLabel?: string;
}

/**
 * Five decades, 0.001% → 100% of the limit.
 *
 * Every meter on this page runs three to five orders of magnitude below its free-tier
 * allowance, so a linear bar drew every row as the same invisible sliver at the far left —
 * 0.008% of a limit and 8% of a limit were pixel-identical. The track carries decade ticks
 * so the axis reads as logarithmic, and the exact percentage is always printed beneath it.
 */
const METER_DECADES = 5;
function meterPosition(share: number): number {
  if (share <= 0) return 0;
  if (share >= 1) return 100;
  return Math.max(1.5, Math.min(100, ((Math.log10(share) + METER_DECADES) / METER_DECADES) * 100));
}
function meterPercentLabel(share: number): string {
  const percent = share * 100;
  if (percent === 0) return "0";
  if (percent < 0.001) return "<0.001";
  return percent.toFixed(percent < 1 ? 3 : 1);
}

/** The bar shows today against the daily limit; the tick marks where the average sits. */
function meterBarHtml(todayShare: number | null, averageShare: number | null, limitLabel: string): string {
  if (todayShare == null) return "";
  const percent = todayShare * 100;
  const tone = percent >= 90 ? " is-red" : percent >= 60 ? " is-amber" : "";
  const used = meterPosition(todayShare).toFixed(2);
  const marker = averageShare == null || averageShare <= 0
    ? ""
    : `<line class="meter-marker" x1="${meterPosition(averageShare).toFixed(2)}" x2="${meterPosition(averageShare).toFixed(2)}" y1="0" y2="9"/>`;
  const label = esc(`${meterPercentLabel(todayShare)} percent of ${limitLabel}, on a logarithmic axis${averageShare ? `; the daily average is ${meterPercentLabel(averageShare)} percent` : ""}`);
  return `<svg class="meter-bar${tone}" viewBox="0 0 100 9" preserveAspectRatio="none" role="img" aria-label="${label}"><rect class="meter-track" x="0" y="0" width="100" height="9" rx="4.5"/><rect class="meter-fill" x="0" y="0" width="${used}" height="9" rx="4.5"/><path class="meter-ticks" d="M20 0v9M40 0v9M60 0v9M80 0v9"/>${marker}</svg>`
    + `<span class="meter-share">${meterPercentLabel(todayShare)}% of ${esc(limitLabel)}</span>`;
}

function meterRowHtml(row: MeterRow): string {
  return `<tr><th scope="row" class="meter-service"><strong>${esc(row.service)}</strong><span>${esc(row.driver)}</span></th>`
    + `<td class="meter-usage">${row.usage}</td><td class="meter-limit">${row.limit}</td>`
    + `<td class="meter-today"><div class="meter-stack"><span class="meter-daily__value">${row.today}</span>${meterBarHtml(row.todayShare, row.averageShare, row.shareLabel ?? "today's limit")}</div></td>`
    + `<td class="meter-daily"><div class="meter-stack"><span class="meter-daily__value">${row.daily}</span>${row.averageShare == null ? "" : `<span class="meter-share">${meterPercentLabel(row.averageShare)}% of daily limit</span>`}</div></td></tr>`;
}

function spendHtml(billing: Record<string, unknown>, embedded = false): string {
  const allTime = recordValue(billing.allTime), services = recordValue(allTime.services);
  const durable = recordValue(services.durableObjects), d1 = recordValue(services.d1), r2 = recordValue(services.r2);
  const currentServices = recordValue(billing.services), workers = recordValue(currentServices.workers);
  const averageDaily = recordValue(allTime.averageDaily), today = recordValue(billing.today);
  const freeTier = recordValue(billing.freeTier), freeDo = recordValue(freeTier.durableObjects), freeR2 = recordValue(freeTier.r2), freeWorkers = recordValue(freeTier.workers), sources = recordValue(freeTier.sources);
  const measured = numberValue(allTime.estimatedVariableUsd), monthly = numberValue(billing.freeTierProjectedMonthlyUsd);
  const hardLimit = numberValue(billing.hardLimitUsd);
  // Floored at one day, matching how the Lobby computes its own daily averages. Without
  // the floor, a service a few hours old extrapolates "7 operations" into "168 / day",
  // which reads as a bug sitting next to its own total.
  const observedDays = Math.max(1, numberValue(allTime.observedDays));
  const samples = Array.isArray(billing.spendHistory) ? billing.spendHistory as Array<{ ts: number; usd: number }> : [];

  const n = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
  const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(2)} MB`;
  const perDay = (total: number) => total / observedDays;
  // Sub-cent figures are the normal case here, so a fixed 2dp would print every one of them
  // as $0.00. Widen the decimals as the number shrinks instead.
  const usd = (value: number) => `$${value >= 0.01 ? value.toFixed(2) : value >= 0.000001 ? value.toFixed(6) : value.toFixed(8)}`;
  const todayUsd = numberValue(today.estimatedUsd), averageUsd = numberValue(averageDaily.estimatedUsd);
  const todayPartial = today.partial === true, todayHours = numberValue(today.measuredHours);
  // Today is compared against a whole day's allowance, because that is the allowance —
  // "8% of today's limit by lunchtime" is the reading that matters, not a pro-rated one.
  const share = (value: number, limit: number) => (limit > 0 ? value / limit : null);
  const remainingUsd = numberValue(billing.hardLimitRemainingUsd);
  const paceDays = averageUsd > 0 ? remainingUsd / averageUsd : Infinity;
  const headroom = billing.hardLimitExceeded === true
    ? "game traffic disabled"
    : averageUsd <= 0
      ? "no measured spend yet"
      : paceDays >= 365
        ? `${(paceDays / 365).toFixed(1)} years at the current average`
        : paceDays >= 1
          ? `${Math.round(paceDays)} days at the current average`
          : `${Math.max(1, Math.round(paceDays * 24))} hours at the current average`;

  // Every limit is normalised to a per-day figure so one bar compares every row on the
  // same axis — monthly R2 allowances included. That normalisation is the whole point:
  // a monthly cap and a daily cap are not otherwise readable side by side.
  const doStorage = numberValue(durable.storageBytes), doStorageLimit = numberValue(freeDo.storageBytes);
  const r2Storage = numberValue(r2.storageBytes), r2StorageLimit = numberValue(freeR2.storageBytesPerMonth);
  const r2ClassA = numberValue(r2.classAOperations), r2ClassALimit = numberValue(freeR2.classAOperationsPerMonth);
  const r2ClassB = numberValue(r2.classBOperations), r2ClassBLimit = numberValue(freeR2.classBOperationsPerMonth);
  // Monthly R2 allowances are compared against one thirtieth of the month, so a monthly
  // cap and a daily cap read on the same axis.
  const r2ClassADaily = r2ClassALimit / 30, r2ClassBDaily = r2ClassBLimit / 30;
  const rows: MeterRow[] = [
    {
      service: "Worker requests", driver: "Every page view and API call",
      usage: workers.requests == null ? `<span class="meter-note" title="${esc(String(workers.note ?? ""))}">Analytics required</span>` : n(numberValue(workers.requests)),
      limit: `${n(numberValue(freeWorkers.requestsPerDay))} / day`,
      today: "—",
      daily: workers.requests == null ? "—" : `${n(perDay(numberValue(workers.requests)))} / day`,
      todayShare: null,
      averageShare: workers.requests == null ? null : share(perDay(numberValue(workers.requests)), numberValue(freeWorkers.requestsPerDay)),
    },
    {
      service: "Durable Object requests", driver: "Joining a tank, opening a dashboard",
      usage: n(numberValue(durable.requests)),
      limit: `${n(numberValue(freeDo.requestsPerDay))} / day`,
      today: n(numberValue(today.requests)),
      daily: `${n(numberValue(averageDaily.requests))} / day`,
      todayShare: share(numberValue(today.requests), numberValue(freeDo.requestsPerDay)),
      averageShare: share(numberValue(averageDaily.requests), numberValue(freeDo.requestsPerDay)),
    },
    {
      service: "Durable Object duration", driver: "Rooms simulating 32 sharks in real time",
      usage: `${n(numberValue(durable.gbSeconds), 2)} GB-s`,
      limit: `${n(numberValue(freeDo.gbSecondsPerDay))} GB-s / day`,
      today: `${n(numberValue(today.gbSeconds), 2)} GB-s`,
      daily: `${n(numberValue(averageDaily.gbSeconds), 2)} GB-s / day`,
      todayShare: share(numberValue(today.gbSeconds), numberValue(freeDo.gbSecondsPerDay)),
      averageShare: share(numberValue(averageDaily.gbSeconds), numberValue(freeDo.gbSecondsPerDay)),
    },
    {
      service: "SQLite rows read", driver: "Loading profiles, logs, and receipts",
      usage: n(numberValue(durable.rowsRead)),
      limit: `${n(numberValue(freeDo.rowsReadPerDay))} / day`,
      today: n(numberValue(today.rowsRead)),
      daily: `${n(numberValue(averageDaily.rowsRead))} / day`,
      todayShare: share(numberValue(today.rowsRead), numberValue(freeDo.rowsReadPerDay)),
      averageShare: share(numberValue(averageDaily.rowsRead), numberValue(freeDo.rowsReadPerDay)),
    },
    {
      service: "SQLite rows written", driver: "Steering, dashing, and every audit row",
      usage: n(numberValue(durable.rowsWritten)),
      limit: `${n(numberValue(freeDo.rowsWrittenPerDay))} / day`,
      today: n(numberValue(today.rowsWritten)),
      daily: `${n(numberValue(averageDaily.rowsWritten))} / day`,
      todayShare: share(numberValue(today.rowsWritten), numberValue(freeDo.rowsWrittenPerDay)),
      averageShare: share(numberValue(averageDaily.rowsWritten), numberValue(freeDo.rowsWrittenPerDay)),
    },
    {
      service: "Durable Object storage", driver: "Room snapshots and the receipt chain",
      usage: mb(doStorage),
      limit: `${(doStorageLimit / 1_000_000_000).toFixed(0)} GB`,
      today: `${mb(doStorage)} held`,
      daily: `<span class="meter-note">level, not a rate</span>`,
      todayShare: share(doStorage, doStorageLimit),
      averageShare: null,
      shareLabel: "the limit",
    },
    {
      service: "R2 Class A operations", driver: "Writing or listing a stored asset",
      usage: n(r2ClassA),
      limit: `${n(r2ClassALimit)} / month`,
      today: n(numberValue(today.r2ClassA)),
      daily: `${n(perDay(r2ClassA), 2)} / day`,
      todayShare: share(numberValue(today.r2ClassA), r2ClassADaily),
      averageShare: share(perDay(r2ClassA), r2ClassADaily),
    },
    {
      service: "R2 Class B operations", driver: "Reading a stored asset",
      usage: n(r2ClassB),
      limit: `${n(r2ClassBLimit)} / month`,
      today: n(numberValue(today.r2ClassB)),
      daily: `${n(perDay(r2ClassB), 2)} / day`,
      todayShare: share(numberValue(today.r2ClassB), r2ClassBDaily),
      averageShare: share(perDay(r2ClassB), r2ClassBDaily),
    },
    {
      service: "R2 storage", driver: `${n(numberValue(r2.objects))} objects in the bound asset bucket`,
      usage: mb(r2Storage),
      limit: `${(r2StorageLimit / 1_000_000_000).toFixed(0)} GB-month`,
      today: `${mb(r2Storage)} held`,
      daily: `<span class="meter-note">level, not a rate</span>`,
      todayShare: share(r2Storage, r2StorageLimit),
      averageShare: null,
      shareLabel: "the limit",
    },
    {
      service: "D1", driver: "No database bound to this Worker",
      usage: d1.configured ? n(numberValue(d1.rowsRead)) : `<span class="meter-note">Not bound</span>`,
      limit: d1.configured ? "See D1 pricing" : "—",
      today: "—",
      daily: "—",
      todayShare: null,
      averageShare: null,
    },
  ];

  const heading = embedded ? "h2" : "h1";
  return `<section class="page-intro${embedded ? " evidence-block" : ""}"${embedded ? ' id="spend" tabindex="-1"' : ""}><div class="eyebrow">Shark Tank cost control</div><${heading}>Every bite leaves a receipt.</${heading}><a class="action-link" href="/spend.json">Raw spend JSON →</a></section>
    <div class="spend-hero">
      <div class="card hero-card gauge-card">${billingGaugeSvg("spend", monthly, measured, "All-time list-price meter")}</div>
      <div class="card hero-card trend-card">
        <div class="eyebrow">Spend trend</div>
        <h2>Cumulative metered spend</h2>
        ${spendTrendSvg(samples, hardLimit)}
        <p class="sub">${samples.length} hourly ${samples.length === 1 ? "sample" : "samples"} · $${hardLimit.toFixed(2)} hard stop · ${billing.hardLimitExceeded === true ? "<b>game traffic and public writes disabled</b>" : "traffic allowed"}</p>
      </div>
    </div>
    <div class="metric-grid spend-metrics">
      ${/* An eight-decimal figure wraps mid-number in a card; the exact value stays on the
            gauge readout below and in this cell's tooltip. */""}
      ${metricCard(`<span title="$${measured.toFixed(8)}">${usd(measured)}</span>`, "All-time meter", `since ${new Date(numberValue(allTime.startedAt)).toLocaleDateString()}`, "audit", "tone-cyan")}
      ${metricCard(`<span title="$${todayUsd.toFixed(8)}">${usd(todayUsd)}</span>`, "Spend today", `${hardLimit > 0 ? `${((todayUsd / hardLimit) * 100).toFixed(todayUsd / hardLimit < 0.01 ? 3 : 1)}% of the $${hardLimit.toFixed(2)} stop` : "measured today"}${todayPartial ? ` · measured ${todayHours < 1 ? "under an hour" : `${Math.round(todayHours)}h`}` : ""}`, "requests", todayUsd > averageUsd * 2 && averageUsd > 0 ? "tone-yellow" : "tone-green")}
      ${metricCard(`<span title="$${averageUsd.toFixed(8)}">${usd(averageUsd)}</span>`, "Average spend / day", `over ${observedDays < 1.5 ? "the first day" : `${observedDays.toFixed(1)} days`}`, "uptime", "tone-violet")}
      ${metricCard(`$${numberValue(billing.hardLimitUsd).toFixed(2)}`, "Spend hard stop", headroom, "traffic", billing.hardLimitExceeded === true ? "tone-red" : "tone-green")}
    </div>
    <div class="card"><h2>Usage against the free tier</h2>
      <p class="meter-legend"><span><i></i> today, against a whole day's allowance</span><span><b></b> where the daily average sits</span><span>ticks mark 0.001 / 0.01 / 0.1 / 1 / 10 / 100% — the axis is logarithmic</span></p>
      <div class="table-scroll" role="region" aria-label="Usage against the free tier" tabindex="0"><table class="billing-table meter-table"><caption class="sr-only">Usage against the free tier</caption><thead><tr><th scope="col">Service</th><th scope="col">Used to date</th><th scope="col">Limit</th><th scope="col">Today</th><th scope="col">Daily average</th></tr></thead><tbody>
      ${rows.map(meterRowHtml).join("")}
    </tbody></table></div><p class="sub u-m-12-0-0">At the ${hardLimit.toFixed(2)} hard stop, gameplay and metered public writes close while read-only evidence and protected administration remain available.</p><p class="sub u-m-12-0-0">Sources: <a href="${esc(String(sources.workers ?? "#"))}">Workers</a>, <a href="${esc(String(sources.durableObjects ?? "#"))}">Durable Objects</a>, <a href="${esc(String(sources.r2 ?? "#"))}">R2</a>. Worker requests are not counted here: exact request billing is only available from account analytics.</p></div>`;
}



/**
 * The page states the chain's verdict, not just its head.
 *
 * A hash chain that only validates against itself proves nothing to a reader — the whole
 * claim on this page is tamper-evidence, so the check has to be visible. Colour is never
 * the only cue: the badge carries its own word, and the sentence beside it says what was
 * actually checked.
 */
const PROJECT_START_MS = Date.parse("2026-08-18T16:15:00.000Z");
const projectWindowMs = (now: number) => Math.max(1, now - PROJECT_START_MS);
/** "2d 7h" / "7h 20m" / "18m" — the span an availability figure is measured over. */
function formatWindow(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), mins = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

const AUDIT_ROOMS = ["room-1"];
const AUDIT_ROOM_NAMES: Record<string, string> = { "room-1": "SharkTank" };
interface IncidentRecord { id: string; title: string; cause: string; status: "active" | "resolved"; startedAt: string | number; resolvedAt: string | number | null; impactEndedAt?: string | number | null; summary: string }
interface ControlHistoryEntry { sequence: number; ts: number; code: string; actor: string; title: string; summary: string; reference: string | null; detail: string | null; previousHash: string; hash: string }
interface ControlHistoryIntegrity {
  mode: string; algorithm: string; entryCount: number; headHash: string | null;
  // Added when the chain gained real verification. Optional so a response from an older
  // Durable Object instance still renders — it degrades to "not reported", never to a
  // tamper accusation.
  verified?: boolean;
  chainStatus?: "empty" | "verified" | "tampered" | "unverified";
  anchorState?: "verified" | "adopted" | "stale" | "mismatch" | null;
  checkedEntries?: number;
  coverage?: "full" | "recent" | "none";
  failedAtSequence?: number | null;
}

/**
 * The page states the chain's verdict, not just its head.
 *
 * A hash chain that only validates against itself proves nothing to a reader — the whole
 * claim on this page is tamper-evidence, so the check has to be visible. Colour is never
 * the only cue: the badge carries its own word, and the sentence beside it says what was
 * actually checked.
 */
function integrityVerdict(integrity: ControlHistoryIntegrity): string {
  const status = integrity.chainStatus;
  if (!status) return "";
  const checked = integrity.checkedEntries ?? 0;
  const scope = integrity.coverage === "recent" ? `newest ${checked} entries re-hashed` : `${checked} entries re-hashed`;
  const badge = (tone: string, label: string, detail: string) =>
    `<span class="integrity-badge ${tone}">${label}</span><span>${detail}</span>`;
  if (status === "empty") return badge("verdict-idle", "No receipts", "nothing recorded yet");
  if (status === "verified") {
    const anchor = integrity.anchorState === "adopted" ? "anchor recorded this read" : "matches the stored anchor";
    return badge("verdict-pass", "Verified", `${scope} · ${anchor}`);
  }
  if (status === "tampered") {
    const where = integrity.failedAtSequence != null
      ? `first mismatch at receipt #${integrity.failedAtSequence}`
      : "the chain no longer matches the stored anchor — entries are missing";
    return badge("verdict-fail", "Failed", where);
  }
  return badge("verdict-idle", "Not checked", "verification did not complete on this read");
}
const INCIDENTS: IncidentRecord[] = [{ id: "2026-08-18-maintenance-check", title: "Maintenance control verification", cause: "Planned maintenance", status: "resolved", startedAt: "2026-08-18T21:45:00.000Z", resolvedAt: "2026-08-18T21:49:30.000Z", summary: "The tank was briefly taken offline while root-wide downtime routing and Durable Object reductions were verified." }];
const SCHEDULED_INCIDENT_CAUSES = new Set(["Planned maintenance", "Audit control", "Owner security exercise"]);
/** Timeline/legend colour per incident cause, so the key explains what the bars mean. */
const INCIDENT_TONES: Readonly<Record<string, { key: string; color: string; label: string }>> = {
  "Planned maintenance": { key: "key-violet", color: "#8f7bff", label: "Planned maintenance" },
  "Audit control": { key: "key-indigo", color: "#6d8bff", label: "Operator maintenance" },
  "Owner security exercise": { key: "key-amber", color: "#ff8a1f", label: "Security exercise" },
  "Independent security report": { key: "key-red", color: "#ff6b6b", label: "Security report" },
  "Billing hard limit": { key: "key-crimson", color: "#e5484d", label: "Spend hard stop" },
  "Test alert": { key: "key-yellow", color: "#ffe14d", label: "Test alert" },
};
const INCIDENT_FALLBACK_TONE = { key: "key-red", color: "#ff6b6b", label: "Unscheduled outage" };
function incidentTone(cause: string) { return INCIDENT_TONES[cause] ?? INCIDENT_FALLBACK_TONE; }
/**
 * Legend for the causes actually drawn, grouped and counted.
 *
 * The flat colour list did not say which lane a colour belonged to or how often it
 * occurred, so it explained the palette rather than the chart. Entries are now split
 * into the two lanes the bar draws, each carries its occurrence count, and each is a
 * link into the record it came from — so every mark on the chart is traceable back to
 * the incident and control receipt that produced it.
 */
function timelineLegend(incidents: IncidentRecord[], history: ControlHistoryEntry[] = [], linkBase = ""): string {
  const relevant = incidents.filter((incident) => incident.cause !== "Test alert");
  const counts = new Map<string, number>();
  for (const incident of relevant) counts.set(incident.cause, (counts.get(incident.cause) ?? 0) + 1);
  const causes = [...counts.keys()].sort();
  const entry = (cause: string) => {
    const tone = incidentTone(cause), count = counts.get(cause) ?? 0;
    const first = relevant.find((incident) => incident.cause === cause);
    const href = first ? `${linkBase}#${receiptAnchor(first, history) ?? incidentAnchor(first)}` : "";
    const body = `<i class="${tone.key}"></i>${esc(tone.label)} <b>${count}</b>`;
    return href ? `<a href="${href}">${body}</a>` : `<span>${body}</span>`;
  };
  const scheduled = causes.filter((cause) => SCHEDULED_INCIDENT_CAUSES.has(cause));
  const unscheduled = causes.filter((cause) => !SCHEDULED_INCIDENT_CAUSES.has(cause));
  const group = (label: string, items: string[]) => items.length ? `<div class="timeline-key__group"><span class="timeline-key__label">${label}</span>${items.join("")}</div>` : "";
  return `<div class="timeline-key">
    ${group("Tank · scheduled", scheduled.map(entry))}
    ${group("Tank · unscheduled", unscheduled.map(entry))}
    <p class="timeline-key-note">Every legend entry links to the record that produced it. Chart markers are pointer shortcuts to the same records; by keyboard, reach them through the legend above or the incident list under <a href="#incidents">Incidents</a>.</p>
  </div>`;
}

/**
 * Incident chart: every recorded incident across project inception → now.
 *
 * This is deliberately NOT the availability bar. /status/ answers "is the tank up right
 * now", and it owns the two uptime lanes; repeating those lanes here said the same thing
 * twice and said nothing about the incidents themselves. This chart is incident-shaped:
 * one lane per cause, each incident drawn at its real position and duration on a
 * project-length axis, so the reader can see when trouble clustered and what kind it was.
 *
 * Every incident is a link — a duration bar for anything that lasted, a diamond for the
 * instantaneous ones (a test alert opens and closes on the same millisecond and would
 * otherwise be a zero-width rectangle, i.e. invisible).
 */
function incidentChartSvg(incidents: IncidentRecord[], now: number, history: ControlHistoryEntry[] = [], linkBase = ""): string {
  const start = PROJECT_START_MS, span = Math.max(1, now - start);
  if (!incidents.length) return `<p class="sub">No incidents recorded since the project started.</p>`;
  // Lane height doubles as the hit target for the links inside it — 30 keeps a bar
  // comfortably tappable once the viewBox scales to a phone.
  const width = 768, left = 132, right = 14, laneH = 30, top = 26;
  const plot = width - left - right;
  const x = (ts: number) => left + ((Math.max(start, Math.min(now, ts)) - start) / span) * plot;

  // Scheduled causes first: it groups the deliberate closures apart from the ones
  // nobody chose, which is the distinction the whole page turns on.
  const causes = [...new Set(incidents.map((incident) => incident.cause))]
    .sort((a, b) => Number(SCHEDULED_INCIDENT_CAUSES.has(b)) - Number(SCHEDULED_INCIDENT_CAUSES.has(a)) || a.localeCompare(b));
  const height = top + causes.length * laneH + 30;

  // Day gridlines across the project, labelled at each boundary.
  const dayMs = 86_400_000, firstDay = Math.ceil(start / dayMs) * dayMs;
  const grid: string[] = [];
  for (let ts = firstDay; ts <= now; ts += dayMs) {
    const gx = x(ts).toFixed(1);
    grid.push(`<line x1="${gx}" y1="${top - 6}" x2="${gx}" y2="${top + causes.length * laneH}" stroke="#2b2750" stroke-width="1"/>`
      + `<text x="${gx}" y="${top - 10}" class="ic-axis" text-anchor="middle">${new Date(ts).toISOString().slice(5, 10)}</text>`);
  }

  const lanes = causes.map((cause, index) => {
    const tone = incidentTone(cause), y = top + index * laneH, mid = y + laneH / 2;
    const inLane = incidents.filter((incident) => incident.cause === cause);
    const marks = inLane.map((incident) => {
      const from = incidentTime(incident.startedAt, now), to = incidentImpactEnd(incident, now);
      const anchor = receiptAnchor(incident, history) ?? incidentAnchor(incident);
      const active = incident.status === "active";
      const label = esc(`${incident.status.toUpperCase()} · ${incident.title} · ${new Date(from).toISOString().replace("T", " ").slice(0, 16)}Z · ${formatCompactDuration(Math.max(0, to - from))}`);
      const x1 = x(from), x2 = x(to);
      // An invisible padded rect behind each mark keeps the tap target usable even when
      // the incident itself is a four-second sliver.
      // 26 CSS px tall, and at least 26 wide once the 768-unit viewBox is laid out at any
      // width at or above its own — the transparent rect is the focus ring and the tap
      // target, so it has to clear 24x24 by itself (SC 2.5.8) rather than rely on the
      // four-pixel sliver of colour drawn inside it.
      const hit = `<rect x="${(x1 - 11).toFixed(1)}" y="${(mid - 13).toFixed(1)}" width="${Math.max(26, x2 - x1 + 22).toFixed(1)}" height="26" rx="3" fill="transparent" class="ic-hit"/>`;
      const shape = x2 - x1 < 2
        ? `<path d="M ${x1.toFixed(1)} ${(mid - 7).toFixed(1)} l 7 7 l -7 7 l -7 -7 Z" fill="${tone.color}" stroke="${active ? "#fff" : "#0b0a14"}" stroke-width="1"/>`
        : `<rect x="${x1.toFixed(1)}" y="${(mid - 8).toFixed(1)}" width="${Math.max(4, x2 - x1).toFixed(1)}" height="16" rx="3" fill="${tone.color}" stroke="${active ? "#fff" : "none"}" stroke-width="${active ? 1.5 : 0}"/>`;
      return `<g role="listitem"><a href="${linkBase}#${anchor}" aria-label="${label}"><title>${label}</title>${hit}${shape}</a></g>`;
    }).join("");
    return `<line x1="${left}" y1="${mid.toFixed(1)}" x2="${width - right}" y2="${mid.toFixed(1)}" stroke="#221f3d" stroke-width="1"/>`
      + `<text x="${left - 10}" y="${(mid + 3.5).toFixed(1)}" class="ic-lane" text-anchor="end">${esc(tone.label)} <tspan class="ic-count">${inLane.length}</tspan></text>`
      + `<g role="list" aria-label="${esc(tone.label)}">${marks}</g>`;
  }).join("");

  const nowX = (left + plot).toFixed(1);
  // `role="img"` made every descendant presentational, so the nine links inside were
  // invisible to assistive technology, and `tabindex="-1"` took them off the tab order as
  // well — the chart was reachable by pointer and by nothing else (SC 2.1.1, SC 4.1.2).
  // `role="group"` with a title/desc pair keeps the summary and lets the links exist, which
  // is the pattern the delivery chart on this same page was already using.
  return `<div class="timeline-scroll incident-chart" role="region" aria-label="Incident chart" tabindex="0"><svg viewBox="0 0 ${width} ${height}" height="${height}" role="group" aria-labelledby="ic-chart-title ic-chart-desc">
    <title id="ic-chart-title">Incidents by cause since project start</title>
    <desc id="ic-chart-desc">${esc(`${incidents.length} incidents across ${formatWindow(span)} of project time, grouped into ${causes.length} causes. Each mark is a link to that incident's entry and control receipt.`)}</desc>
    ${grid.join("")}
    ${lanes}
    <line x1="${nowX}" y1="${top - 6}" x2="${nowX}" y2="${top + causes.length * laneH}" stroke="#22e6ff" stroke-width="1.5" stroke-dasharray="3 3"/>
    <text x="${left}" y="${height - 8}" class="ic-axis">${new Date(start).toISOString().slice(0, 10)} · project start</text>
    <text x="${width - right}" y="${height - 8}" class="ic-axis" text-anchor="end">now</text>
  </svg></div>`;
}

/** Stable anchor for an incident card, so a marker always has somewhere to land. */
function incidentAnchor(incident: IncidentRecord): string { return `incident-${incident.id.replace(/[^a-zA-Z0-9-]/g, "-")}`; }

/** Status-page incident strip: active first, each row linking to its receipt in the control log. */
/**
 * What /status/ says about backups. Deliberately reports shape and timing rather than
 * content: when the last copy was taken, how much it covered, its digest, how many copies
 * are retained, and whether the last restore drill reproduced the original. A backup
 * nobody has restored is a claim; a drill with a matching digest is evidence.
 */
function backupPanelHtml(backup?: BackupState): string {
  const state = backup ?? { lastBackupAt: 0, lastBackupKey: "", lastBackupBytes: 0, lastBackupDigest: "", lastBackupCounts: null, lastBackupError: "", retainedCopies: 0, lastDrillAt: 0, lastDrillOk: false, lastDrillDetail: "" };
  const when = (ts: number) => ts ? new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "never";
  const counts = state.lastBackupCounts;
  // Counts are small enough at this scale that "1 control receipts" is a visible fault
  // on a page whose argument is that this service describes itself carefully.
  const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  const coverage = counts
    ? `${plural(counts.kv, "key")} (${plural(counts.profiles, "player profile")}), ${plural(counts.controlHistory, "control receipt")}, ${plural(counts.audit, "action-log row")}`
    : "not yet taken";
  const drillTone = state.lastDrillAt === 0 ? "key-amber" : state.lastDrillOk ? "key-green" : "key-red";
  const drillWord = state.lastDrillAt === 0 ? "Not yet run" : state.lastDrillOk ? "Passed" : "Failed";
  // The optional third member is a key-dot tone class. It is one of three literals
  // chosen here, never caller input, so it is the only part of a row emitted unescaped.
  const rows: Array<[string, string, string?]> = [
    ["Last copy taken", when(state.lastBackupAt)],
    ["What it covered", coverage],
    ["Copy digest (SHA-256)", state.lastBackupDigest ? state.lastBackupDigest : "—"],
    ["Copies retained", state.lastBackupAt ? `${state.retainedCopies} dated, plus the most recent` : "—"],
    ["Last restore drill", `${drillWord}${state.lastDrillAt ? " · " + when(state.lastDrillAt) : ""}`, drillTone],
    ["Drill result", state.lastDrillDetail || "—"],
  ];
  const failure = state.lastBackupError
    ? `<p class="sub u-m-8-0-0"><span class="key-dot key-red"></span>The last scheduled copy did not complete: ${esc(state.lastBackupError)}</p>`
    : "";
  return `<section class="card evidence-block" id="continuity" tabindex="-1"><h2 class="u-card-heading">State copies and restore drills</h2>
    <div class="table-scroll" role="region" aria-label="State copies and restore drills" tabindex="0"><table class="capacity-table"><caption class="sr-only">State copies and restore drills</caption><thead><tr><th scope="col">Measure</th><th scope="col">Value</th></tr></thead><tbody>${rows.map(([label, value, tone]) => `<tr><td><strong>${esc(label)}</strong></td><td>${tone ? `<span class="key-dot ${tone}"></span>` : ""}${esc(value)}</td></tr>`).join("")}</tbody></table></div>${failure}</section>`;
}

/**
 * The incident record, as a section of the operations page.
 *
 * This used to be a whole route (`/incidents/`) plus a five-row teaser here, which meant
 * the append-only receipt chain rendered twice on two pages and the incident count was
 * stated in three places at three precisions. It is one section now, on the page that owns
 * availability, and the receipt chain below it is the only copy.
 */
function incidentsSection(incidents: IncidentRecord[], history: ControlHistoryEntry[]): string {
  const now = Date.now();
  const s = incidentSummary(incidents, now);
  // Active incidents first — an open incident is the thing a reader needs to see.
  const ordered = incidents.map((incident, index) => ({ incident, index })).sort((a, b) => {
    const openA = a.incident.status === "active" ? 0 : 1, openB = b.incident.status === "active" ? 0 : 1;
    return openA !== openB ? openA - openB : b.index - a.index;
  }).map((entry) => entry.incident);
  const active = ordered.filter((x) => x.status === "active"), resolved = ordered.filter((x) => x.status !== "active");
  const card = (x: IncidentRecord) => {
    const timing = x.impactEndedAt != null && x.status === "active"
      ? `${new Date(incidentTime(x.startedAt, now)).toISOString()} → impact ended ${new Date(incidentImpactEnd(x, now)).toISOString()} · investigation remains open`
      : `${new Date(incidentTime(x.startedAt, now)).toISOString()} → ${x.resolvedAt == null ? "ongoing" : new Date(incidentTime(x.resolvedAt, now)).toISOString()}`;
    const tone = incidentTone(x.cause), anchor = receiptAnchor(x, history);
    const receipt = anchor ? `<p class="u-m-10-0-0"><a class="action-link" href="#${anchor}">Open control receipt →</a></p>` : "";
    // Every incident card carries its own anchor so a timeline marker without a control
    // receipt still has somewhere to land — no mark on the chart is a dead end.
    return `<article class="card incident-card${x.status === "active" ? " incident-card--active" : ""}" id="${incidentAnchor(x)}" tabindex="-1"><div class="m ${x.status === "active" ? "o" : "g"}"><i class="incident-dot ${tone.key}"></i>${x.status.toUpperCase()} · ${esc(x.cause)}</div><h3>${esc(x.title)}</h3><p>${esc(x.summary)}</p><p class="sub u-m-0">${timing}</p>${receipt}</article>`;
  };
  const activeBlock = active.length
    ? `<section aria-labelledby="active-incidents"><div class="eyebrow">Needs attention</div><h3 id="active-incidents" class="u-m-6-0-14">Active incidents (${active.length})</h3>${active.map(card).join("")}</section>`
    : `<section class="card"><div class="m g">ALL CLEAR</div><h3 class="u-m-6-0-0">No active incidents</h3></section>`;
  const resolvedBlock = resolved.length
    ? `<section aria-labelledby="resolved-incidents"><div class="eyebrow">History</div><h3 id="resolved-incidents" class="u-m-6-0-14">Resolved incidents (${resolved.length})</h3>${resolved.map(card).join("")}</section>`
    : "";
  return `<section id="incidents" tabindex="-1" aria-labelledby="incidents-heading">
    <div class="eyebrow">Availability evidence</div>
    <h2 id="incidents-heading" class="u-m-6-0-10">Incidents</h2>
    <div class="card hero-card"><h3 class="u-incident-heading">Every incident since project start</h3><p class="sub u-m-0-0-10">${formatCompactDuration(s.scheduledDowntimeMs)} of it scheduled and excluded from availability.</p>${incidentChartSvg(incidents, now, history)}<p class="timeline-key-note u-m-8-0-0">Bars show how long impact lasted; diamonds are instantaneous events. Every mark is a link to its incident and control receipt, reachable by keyboard as well as pointer.</p></div>
    ${activeBlock}${resolvedBlock}
  </section>`;
}
/** Control receipt anchor for an incident, so a card can jump to its entry in the log. */
function receiptAnchor(incident: IncidentRecord, history: ControlHistoryEntry[]): string | null {
  const alert = incident.id.match(/^test-alert-([A-Z][0-9]{3})-/);
  const entry = history.find((h) => h.reference === incident.id) ?? (alert ? history.find((h) => h.reference === alert[1]) : undefined);
  return entry ? `receipt-${entry.sequence}` : null;
}
const incidentTime = (value: string | number | null, fallback: number) => value == null ? fallback : typeof value === "number" ? value : new Date(value).getTime();
const incidentImpactEnd = (incident: IncidentRecord, fallback: number) => incident.impactEndedAt == null ? incidentTime(incident.resolvedAt, fallback) : incidentTime(incident.impactEndedAt, fallback);
function mergedIncidentDuration(incidents: IncidentRecord[], now: number): number {
  const start = PROJECT_START_MS;
  const intervals = incidents
    .map((incident) => [Math.max(start, incidentTime(incident.startedAt, now)), Math.min(now, incidentImpactEnd(incident, now))] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let downtimeMs = 0, openStart = 0, openEnd = 0;
  for (const [from, to] of intervals) {
    if (!openEnd) { openStart = from; openEnd = to; continue; }
    if (from <= openEnd) openEnd = Math.max(openEnd, to);
    else { downtimeMs += openEnd - openStart; openStart = from; openEnd = to; }
  }
  if (openEnd) downtimeMs += openEnd - openStart;
  return downtimeMs;
}
function incidentSummary(incidents: IncidentRecord[], now = Date.now()) {
  const windowMs = projectWindowMs(now), relevant = incidents.filter((incident) => incident.cause !== "Test alert");
  const scheduledDowntimeMs = mergedIncidentDuration(relevant.filter((incident) => SCHEDULED_INCIDENT_CAUSES.has(incident.cause)), now);
  const unscheduledDowntimeMs = mergedIncidentDuration(relevant.filter((incident) => !SCHEDULED_INCIDENT_CAUSES.has(incident.cause)), now);
  const uptimeMs = Math.max(0, windowMs - unscheduledDowntimeMs);
  return { windowStart: new Date(PROJECT_START_MS).toISOString(), windowMs, windowLabel: formatWindow(windowMs), windowHours: Number((windowMs / 3_600_000).toFixed(2)), downtimeMs: unscheduledDowntimeMs, scheduledDowntimeMs, unscheduledDowntimeMs, uptimeMs, availabilityPercent: Number(((uptimeMs / windowMs) * 100).toFixed(4)), scheduledDowntimePercent: Number(((scheduledDowntimeMs / windowMs) * 100).toFixed(4)), unscheduledDowntimePercent: Number(((unscheduledDowntimeMs / windowMs) * 100).toFixed(4)), calculatedAt: new Date(now).toISOString() };
}

function incidentTimelineSvg(incidents: IncidentRecord[], now = Date.now(), history: ControlHistoryEntry[] = [], linkBase = ""): string {
  const start = PROJECT_START_MS, span = Math.max(1, now - start);
  const ticks = 120, width = 768, left = 58, plot = width - left - 8, step = plot / ticks;
  const bucket = span / ticks;
  const relevant = incidents.filter((x) => x.cause !== "Test alert");
  const byCause = new Map<number, string>();
  for (const incident of relevant) {
    const a = Math.max(0, Math.floor((incidentTime(incident.startedAt, now) - start) / bucket));
    const b = Math.min(ticks - 1, Math.floor((incidentImpactEnd(incident, now) - start) / bucket));
    for (let i = a; i <= b; i += 1) byCause.set(i, incidentTone(incident.cause).color);
  }
  const tankLane = Array.from({ length: ticks }, (_, i) =>
    `<rect x="${(left + i * step).toFixed(2)}" y="20" width="${Math.max(1.2, step - 0.6).toFixed(2)}" height="16" fill="${byCause.get(i) ?? "#4ade80"}"/>`).join("");
  const markers = relevant.map((x) => {
    const at = incidentTime(x.startedAt, now);
    const px = left + Math.max(0, Math.min(ticks - 1, Math.floor((at - start) / bucket))) * step + step / 2;
    const tone = incidentTone(x.cause), anchor = receiptAnchor(x, history) ?? incidentAnchor(x);
    const when = new Date(at).toISOString().replace("T", " ").slice(0, 16) + "Z";
    const label = esc(`${x.status.toUpperCase()} · ${x.cause} · ${x.title} · ${when}`);
    const shape = `<g class="tl-marker"><title>${label}</title>`
      + `<line x1="${px.toFixed(2)}" y1="16" x2="${px.toFixed(2)}" y2="40" stroke="${tone.color}" stroke-width="1.5" opacity=".85"/>`
      + `<path d="M ${px.toFixed(2)} 16 l -6 -8 l 12 0 Z" fill="${tone.color}" stroke="#0b0a14" stroke-width="1"/></g>`;
    const hit = `<rect x="${(px - 13).toFixed(2)}" y="6" width="26" height="38" fill="transparent" rx="3" class="tl-hit"/>`;
    return `<g role="listitem"><a href="${linkBase}#${anchor}" aria-label="${label}">${hit}${shape}</a></g>`;
  }).join("");
  const axis = (label: string, x: number, anchorPoint: string) => `<text x="${x}" y="58" class="tl-axis" text-anchor="${anchorPoint}">${esc(label)}</text>`;
  const downMs = relevant.reduce((total, x) => total + Math.max(0, incidentImpactEnd(x, now) - incidentTime(x.startedAt, now)), 0);
  const spoken = relevant.length === 0
    ? `Tank availability from project start to now, ${formatWindow(span)} measured. No downtime recorded.`
    : `Tank availability from project start to now, ${formatWindow(span)} measured. ${relevant.length} incident${relevant.length === 1 ? "" : "s"} total ${formatWindow(downMs)} of degraded availability.`;
  const spokenDetail = relevant.length === 0 ? "" : `<ul class="sr-only">${relevant.map((x) => {
    const from = incidentTime(x.startedAt, now), to = incidentImpactEnd(x, now);
    return `<li>${esc(x.cause)} — ${esc(new Date(from).toISOString().replace("T", " ").slice(0, 16))}Z, lasting ${esc(formatWindow(Math.max(0, to - from)))}.</li>`;
  }).join("")}</ul>`;
  return `<div class="timeline-scroll availability-chart" role="region" aria-label="Tank availability timeline" tabindex="0"><svg role="group" aria-labelledby="tl-title tl-desc" viewBox="0 0 ${width} 66" preserveAspectRatio="xMidYMid meet">
    <title id="tl-title">Tank availability timeline</title>
    <desc id="tl-desc">${esc(spoken)}</desc>
    <text x="0" y="32" class="tl-lane">Tank</text>${tankLane}
    <g role="list" aria-label="Incident markers">${markers}</g>
    ${axis(new Date(start).toISOString().slice(0, 10), left, "start")}
    ${axis(formatWindow(span) + " measured", left + plot / 2, "middle")}
    ${axis("now", left + plot, "end")}
  </svg>${spokenDetail}</div>`;
}

function historyItemHtml(entry: ControlHistoryEntry, searchable = false): string {
  const search = searchable ? ` data-history-row="1" data-search="${esc(`${entry.sequence} ${entry.code} ${entry.title} ${entry.summary} ${entry.actor} ${entry.reference ?? ""} ${entry.detail ?? ""}`.toLowerCase())}" data-code="${esc(entry.code)}"` : "";
  return `<article class="history-item" id="receipt-${entry.sequence}"${search}><div class="history-sequence">#${entry.sequence}<br>${esc(entry.code)}</div><div class="history-copy"><strong>${esc(entry.title)}</strong><p>${esc(entry.summary)}</p><div class="history-meta">${new Date(entry.ts).toISOString()} · actor ${esc(entry.actor)}${entry.reference ? ` · ref ${esc(entry.reference)}` : ""}</div></div><div class="history-receipt" title="${esc(entry.hash)}">${esc(entry.hash.slice(0, 16))}…</div></article>`;
}

/** Rows per page in the receipt chain — shared by the markup and the inline script. */
const CONTROL_HISTORY_PAGE_SIZE = 10;
const CONTROL_HISTORY_RENDER_LIMIT = 50;
const controlHistoryPageCount = (rows: number) => Math.max(1, Math.ceil(rows / CONTROL_HISTORY_PAGE_SIZE));

/**
 * The sentence the live region speaks. Page position rides along with the match count so one
 * announcement carries the whole result state; the server renders the same string the script
 * would compute for the initial view, so nothing is announced merely because the page loaded.
 */
function historyCountText(matched: number, total: number, page: number, pages: number): string {
  const body = matched === total ? `${matched} of ${total} receipts` : `${matched} matching of ${total} receipts`;
  return pages > 1 ? `${body}, page ${page} of ${pages}` : body;
}
function logCountText(matched: number, total: number, page: number, pages: number): string {
  const body = matched === total ? `${matched} ${total === 1 ? "record" : "records"}` : `${matched} of ${total} records`;
  return pages > 1 ? `${body}, page ${page} of ${pages}` : body;
}

/** Full receipt chain: searchable, code-filterable, paged 10 at a time, with the running total. */
function controlHistoryListHtml(history: ControlHistoryEntry[], integrity: ControlHistoryIntegrity): string {
  const retained = history.slice(-CONTROL_HISTORY_RENDER_LIMIT);
  const ordered = retained.slice().reverse();
  const items = ordered.map((entry) => historyItemHtml(entry, true)).join("");
  const codes = [...new Set(retained.map((entry) => entry.code))].sort().map((code) => `<option value="${esc(code)}">${esc(code)}</option>`).join("");
  const head = integrity.headHash ? `<code>${esc(integrity.headHash)}</code>` : "No receipt yet";
  return `<section class="card evidence-block" id="receipts" tabindex="-1"><div class="eyebrow">Control receipts</div><h2 class="u-mt-0">Append-only control history</h2><div class="integrity-line"><span class="integrity-badge">${esc(integrity.algorithm)}</span><span>${integrity.entryCount} entries · chain head ${head}</span></div><div class="integrity-line">${integrityVerdict(integrity)}</div>
    <div class="log-toolbar"><label><span>Search</span><input type="search" id="history-search" placeholder="Title, actor, reference, detail" autocomplete="off"></label><label><span>Control code</span><select id="history-code"><option value="">All codes</option>${codes}</select></label><span class="log-visible-count" id="history-count" role="status" aria-live="polite" aria-atomic="true">${esc(historyCountText(ordered.length, ordered.length, 1, controlHistoryPageCount(ordered.length)))}</span></div>
    <div class="history-list" id="history-list">${items || '<p class="sub">No control events recorded.</p>'}</div>
    <div class="history-pager"><button type="button" class="pager-btn" id="history-prev" aria-disabled="true">← Newer</button><span id="history-page" aria-hidden="true">Page 1 of ${controlHistoryPageCount(ordered.length)}</span><button type="button" class="pager-btn" id="history-next"${ordered.length > CONTROL_HISTORY_PAGE_SIZE ? "" : ' aria-disabled="true"'}>Older →</button></div></section>${controlHistoryScript(ordered.length)}`;
}

/**
 * Receipt-chain behaviour: search, code filter, paging.
 *
 * The count element is the page's live region, so it carries the whole result state in one
 * sentence rather than a bare number, and it is only written when the sentence actually
 * changes — that keeps it silent on load, where the server already rendered the same text.
 * The search path is debounced so a settled query announces once instead of per keystroke;
 * the rows themselves still filter on every input.
 *
 * The pager buttons are never `disabled`: a control that disables itself under the keyboard
 * drops focus to `<body>`. They stay focusable, report `aria-disabled`, and no-op at the ends.
 */
function controlHistoryScript(total: number): string {
  return `<script nonce="__WG_CSP_NONCE__">(function(){var PER=${CONTROL_HISTORY_PAGE_SIZE},page=0,rows=Array.prototype.slice.call(document.querySelectorAll('[data-history-row]')),total=${total},timer=0;
var search=document.getElementById('history-search'),code=document.getElementById('history-code'),count=document.getElementById('history-count'),label=document.getElementById('history-page'),prev=document.getElementById('history-prev'),next=document.getElementById('history-next');
function matching(){var q=(search.value||'').trim().toLowerCase(),c=code.value||'';return rows.filter(function(row){return (!q||(row.dataset.search||'').indexOf(q)>-1)&&(!c||row.dataset.code===c);});}
function announce(text){if(count.textContent!==text)count.textContent=text;}
function schedule(text,delay){if(timer)clearTimeout(timer);if(!delay){announce(text);return;}timer=setTimeout(function(){announce(text);},delay);}
function render(delay){var m=matching(),pages=Math.max(1,Math.ceil(m.length/PER));if(page>=pages)page=pages-1;if(page<0)page=0;
rows.forEach(function(row){row.hidden=true;});m.slice(page*PER,page*PER+PER).forEach(function(row){row.hidden=false;});
var body=m.length===total?m.length+' of '+total+' receipts':m.length+' matching of '+total+' receipts';
schedule(pages>1?body+', page '+(page+1)+' of '+pages:body,delay);
label.textContent='Page '+(page+1)+' of '+pages;
prev.setAttribute('aria-disabled',page===0?'true':'false');next.setAttribute('aria-disabled',page>=pages-1?'true':'false');}
search.addEventListener('input',function(){page=0;render(300);});code.addEventListener('change',function(){page=0;render(0);});
prev.addEventListener('click',function(){if(page===0)return;page-=1;render(0);});
next.addEventListener('click',function(){if(next.getAttribute('aria-disabled')==='true')return;page+=1;render(0);});
function reveal(){var hash=location.hash.replace('#','');if(hash.indexOf('receipt-')!==0)return;var target=document.getElementById(hash);if(!target)return;
var m=matching(),i=m.indexOf(target);if(i<0){search.value='';code.value='';m=matching();i=m.indexOf(target);}
if(i>=0){page=Math.floor(i/PER);render(0);target.classList.add('history-item--focus');target.scrollIntoView({block:'center'});if(!target.hasAttribute('tabindex'))target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}}
render(0);reveal();window.addEventListener('hashchange',reveal);}());</script>`;
}


interface PublicLogEvent { ts: number; type: string; room?: string | null; subject?: string | null; detail?: string | null }
interface GameLogWireEvent { ts: number; tick: number; action: Record<string, unknown> }
interface PublicServiceLogRecord { timestamp: string; reasonCode: string; action: string; subject: string; details: string }
interface PublicGameLogRecord { timestamp: string; reasonCode: string; tick: number; action: string; name: string; details: string }
interface PublicTankLog { room: string; records: PublicGameLogRecord[] }

const SERVICE_REASON_CODES: Readonly<Record<string, string>> = {
  "room-boot": "T100", join: "T110", leave: "T120", death: "T130", play: "T140", quit: "T150",
  customize: "P200", skin: "P210", settings: "P220", nav: "P230",
  "maintenance-on": "O300", "maintenance-off": "O301", "incidents-archived": "O310", "profiles-pruned": "O320", "profiles-refused": "O321", "billing-reset": "B400", "billing-hard-stop": "B499",
  "security-report": "S500", "security-resolved": "S501", "test-alert": "A600",
  "backup-taken": "K700", "backup-restored": "K710", "restore-drill": "K720", "backup-failed": "K799",
};
const GAME_REASON_CODES: Readonly<Record<string, string>> = {
  join: "G100", leave: "G101", setOrientation: "G110", setBoost: "G120", bite: "G130", respawn: "G140", death: "G150", boot: "G160",
};
function reasonCode(codes: Readonly<Record<string, string>>, action: string, fallback: string): string { const code = codes[action] ?? fallback; return /^[A-Z][0-9]{3}$/.test(code) ? code : fallback; }

function normalizeServiceLogEvent(event: PublicLogEvent): PublicServiceLogRecord {
  const tank = event.room ? AUDIT_ROOM_NAMES[event.room] ?? event.room : "";
  const details = [event.detail ?? "", tank ? `tank=${tank}` : ""].filter(Boolean).join("; ");
  return { timestamp: new Date(event.ts).toISOString(), reasonCode: reasonCode(SERVICE_REASON_CODES, event.type, "L999"), action: event.type, subject: tankCopy(event.subject ?? ""), details: tankCopy(details) };
}

function normalizeGameLogEvent(event: GameLogWireEvent): PublicGameLogRecord {
  const action = event.action ?? {}, type = String(action.type ?? "unknown"), name = type === "join" ? String(action.name ?? "") : "";
  const details = Object.entries(action).filter(([key]) => !["type", "playerId", "name"].includes(key)).map(([key, value]) => `${key}=${String(value)}`).join(";");
  return { timestamp: new Date(event.ts).toISOString(), reasonCode: reasonCode(GAME_REASON_CODES, type, "G999"), tick: event.tick, action: type, name, details: tankCopy(details) };
}

function reasonOptions(records: Array<{ reasonCode: string }>): string { return [...new Set(records.map((record) => record.reasonCode))].sort().map((code) => `<option value="${esc(code)}">${esc(code)}</option>`).join(""); }

function logToolbar(tableId: string, records: Array<{ reasonCode: string }>, scopeLabel: string): string {
  const pages = Math.max(1, Math.ceil(records.length / LOG_PAGE_SIZE));
  return `<div class="log-toolbar"><label><span>Search</span><input type="search" data-log-search="${tableId}" aria-label="Search ${esc(scopeLabel)}" placeholder="Action, subject, detail" autocomplete="off"></label><label><span>Reason code</span><select aria-label="Reason code, ${esc(scopeLabel)}" data-log-reason="${tableId}"><option value="">All codes</option>${reasonOptions(records)}</select></label><span class="log-visible-count" id="${tableId}-count" role="status" aria-live="polite" aria-atomic="true">${esc(logCountText(records.length, records.length, 1, pages))}</span></div>`;
}

/**
 * Public evidence page.
 *
 * Two windows, each shown in full rather than as a "most recent 40" teaser:
 *   • Service evidence — every record inside the 90-day retention window.
 *   • Tank captures — every capture from the past 24 hours; the room prunes past that,
 *     so what is on the page is the whole record, not a sample of it.
 *
 * Full history means thousands of rows, so each table pages client-side (25 at a time)
 * on top of the existing search / reason-code filter. Anything the fetch ceiling did
 * drop is stated on the page instead of being silently omitted.
 */
const LOG_PAGE_SIZE = 25;
const CAPTURE_WINDOW_MS = 24 * 60 * 60 * 1000;

function logPager(tableId: string, records: number): string {
  const pages = Math.max(1, Math.ceil(records / LOG_PAGE_SIZE));
  return `<div class="history-pager"><button type="button" class="pager-btn" data-log-prev="${tableId}" aria-disabled="true">← Newer</button><span data-log-page="${tableId}" aria-hidden="true">Page 1 of ${pages}</span><button type="button" class="pager-btn" data-log-next="${tableId}"${pages > 1 ? "" : ' aria-disabled="true"'}>Older →</button></div>`;
}

function publicLogsHtml(events: PublicLogEvent[], _gameLogs: PublicTankLog[], _caps: { serviceTruncated: boolean; captureTruncated: boolean }, embedded = false): string {
  const serviceRecords = events.slice(-LOG_FETCH_SERVICE).map(normalizeServiceLogEvent).reverse(), serviceTableId = "service-log-table";
  const rows = serviceRecords.map((record) => {
    const search = `${record.timestamp} ${record.reasonCode} ${record.action} ${record.subject} ${record.details}`.toLowerCase();
    return `<tr data-log-row="1" data-search="${esc(search)}" data-reason="${esc(record.reasonCode)}"><td class="cell-time" title="${esc(record.timestamp)}"><time datetime="${esc(record.timestamp)}">${esc(record.timestamp)}</time></td><td class="cell-code"><code>${esc(record.reasonCode)}</code></td><td class="cell-code" title="${esc(record.action)}"><code>${esc(record.action)}</code></td><td class="cell-key" title="${esc(record.subject)}">${esc(record.subject)}</td><td class="cell-detail" title="${esc(record.details)}"><span>${esc(record.details)}</span></td></tr>`;
  }).join("");
  const heading = embedded ? "h2" : "h1";
  return `<section class="page-intro${embedded ? " evidence-block" : ""}"${embedded ? ' id="logs" tabindex="-1"' : ""}><div class="eyebrow">Recent logs</div><${heading}>Newest service records.</${heading}><p class="sub">The newest ${LOG_FETCH_SERVICE} server-originated service records are shown inline.</p></section>
    <details class="card log-room" open><summary><span class="log-summary"><strong>Service evidence</strong><code>newest ${LOG_FETCH_SERVICE}</code><span class="log-count">${serviceRecords.length} records</span></span></summary><div class="log-room-body">${logToolbar(serviceTableId, serviceRecords, "service evidence")}<div class="table-scroll" role="region" aria-label="Service evidence" tabindex="0"><table class="events-table" id="${serviceTableId}"><caption class="sr-only">Newest service evidence records</caption><thead><tr><th scope="col">Timestamp</th><th scope="col">Reason</th><th scope="col">Action</th><th scope="col">Subject</th><th scope="col">Detail</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No public events recorded.</td></tr>'}</tbody></table></div>${serviceRecords.length > LOG_PAGE_SIZE ? logPager(serviceTableId, serviceRecords.length) : ""}<p class="table-note">Reason codes are one letter plus three digits.</p></div></details>${gameLogSortScript()}`;
}

/**
 * Log table behaviour: search, reason filter, column sort, and paging.
 *
 * Paging is what makes "show everything" viable — a 90-day service log is thousands of
 * rows, so the DOM holds them all but paints 25 at a time. Rows are hidden with the
 * `hidden` attribute, which the global `[hidden]{display:none!important}` rule enforces
 * against the table's own display rules.
 *
 * The per-table count element is also the live region for that table. Announcing the rows
 * themselves would read out 25 changed cells, so the count speaks instead, as one sentence
 * carrying both the match count and the page. It is written only when the sentence changes
 * (silent on load, since the server rendered the same text) and the search path is debounced
 * so a settled query announces once rather than once per keystroke — the rows still filter
 * on every input.
 *
 * The pager buttons are never `disabled`. Disabling a focused button drops focus to `<body>`
 * and restarts the next Tab at the top of the document, so they stay focusable, report
 * `aria-disabled`, and no-op past the ends.
 */
function gameLogSortScript(): string {
  return `<script nonce="__WG_CSP_NONCE__">(function(){var PER=${LOG_PAGE_SIZE},pages={},timers={};
function rowsOf(tableId){var t=document.getElementById(tableId);return t?Array.prototype.slice.call(t.querySelectorAll('tr[data-log-row]')):[];}
function announce(tableId,text){var el=document.getElementById(tableId+'-count');if(el&&el.textContent!==text)el.textContent=text;}
function schedule(tableId,text,delay){if(timers[tableId])clearTimeout(timers[tableId]);if(!delay){announce(tableId,text);return;}timers[tableId]=setTimeout(function(){announce(tableId,text);},delay);}
function render(tableId,delay){var input=document.querySelector('[data-log-search="'+tableId+'"]'),select=document.querySelector('[data-log-reason="'+tableId+'"]'),query=(input&&input.value||'').trim().toLowerCase(),reason=select&&select.value||'';
var all=rowsOf(tableId),match=all.filter(function(row){return (!query||(row.dataset.search||'').indexOf(query)>-1)&&(!reason||row.dataset.reason===reason);});
var total=Math.max(1,Math.ceil(match.length/PER)),page=Math.min(pages[tableId]||0,total-1);pages[tableId]=page;
all.forEach(function(row){row.hidden=true;});match.slice(page*PER,page*PER+PER).forEach(function(row){row.hidden=false;});
var body=match.length===all.length?match.length+' '+(all.length===1?'record':'records'):match.length+' of '+all.length+' records';
schedule(tableId,total>1?body+', page '+(page+1)+' of '+total:body,delay);
var label=document.querySelector('[data-log-page="'+tableId+'"]');if(label)label.textContent='Page '+(page+1)+' of '+total;
var prev=document.querySelector('[data-log-prev="'+tableId+'"]');if(prev)prev.setAttribute('aria-disabled',page===0?'true':'false');
var next=document.querySelector('[data-log-next="'+tableId+'"]');if(next)next.setAttribute('aria-disabled',page>=total-1?'true':'false');}
function step(control,tableId,by){if(control.getAttribute('aria-disabled')==='true')return;pages[tableId]=Math.max(0,(pages[tableId]||0)+by);render(tableId,0);}
document.querySelectorAll('[data-log-search],[data-log-reason]').forEach(function(control){var picker=control.matches('select');control.addEventListener(picker?'change':'input',function(){var id=control.dataset.logSearch||control.dataset.logReason;pages[id]=0;render(id,picker?0:300);});});
document.querySelectorAll('[data-log-prev]').forEach(function(b){b.addEventListener('click',function(){step(b,b.dataset.logPrev,-1);});});
document.querySelectorAll('[data-log-next]').forEach(function(b){b.addEventListener('click',function(){step(b,b.dataset.logNext,1);});});
document.querySelectorAll('.table-sort').forEach(function(button){button.addEventListener('click',function(){var tableId=button.dataset.table,table=document.getElementById(tableId),body=table&&table.querySelector('tbody');if(!body)return;var key=button.dataset.key,direction=button.dataset.direction==='asc'?'desc':'asc',rows=rowsOf(tableId);table.querySelectorAll('.table-sort').forEach(function(other){delete other.dataset.direction;if(other.parentElement)other.parentElement.setAttribute('aria-sort','none');});button.dataset.direction=direction;if(button.parentElement)button.parentElement.setAttribute('aria-sort',direction==='asc'?'ascending':'descending');rows.sort(function(a,b){var av=a.dataset[key]||'',bv=b.dataset[key]||'',result=key==='tick'?Number(av)-Number(bv):av.localeCompare(bv);return direction==='asc'?result:-result;});rows.forEach(function(row){body.appendChild(row);});pages[tableId]=0;render(tableId,0);});});
document.querySelectorAll('table[id]').forEach(function(t){if(t.querySelector('tr[data-log-row]'))render(t.id,0);});
}());</script>`;
}

/** Evidence renders a bounded service slice. Room capture downloads keep their existing ceiling. */
const LOG_FETCH_SERVICE = 100;
const LOG_FETCH_CAPTURES = 2_000;

interface PublicEvidenceStatus {
  maintenance?: MaintenanceState;
  usage?: { uptimeMs?: number; durableObjects?: { tank?: number; rooms?: number; total?: number } };
  rooms?: Array<{ name: string; players: number; bots: number; capacity: number; topScore: number; topName: string }>;
  maintenanceIncidents?: IncidentRecord[];
  history?: ControlHistoryEntry[];
  historyIntegrity?: ControlHistoryIntegrity;
  backup?: BackupState;
  billingWindow?: Record<string, unknown>;
}

function evidenceDashboardHtml(
  data: PublicEvidenceStatus,
  logs: { serviceEvents: PublicLogEvent[]; tanks?: PublicTankLog[]; caps?: { serviceTruncated: boolean; captureTruncated: boolean } },
): string {
  const rooms = data.rooms ?? [];
  const players = rooms.reduce((n, room) => n + room.players, 0);
  const incidents = [...INCIDENTS, ...(data.maintenanceIncidents ?? [])].map((incident) => ({
    ...incident,
    title: tankCopy(incident.title),
    summary: tankCopy(incident.summary),
  }));
  const availability = incidentSummary(incidents);
  const history = (data.history ?? []).slice(-CONTROL_HISTORY_RENDER_LIMIT);
  const integrity = data.historyIntegrity ?? {
    mode: "append-only tamper-evident hash chain",
    algorithm: "SHA-256",
    entryCount: history.length,
    headHash: history.at(-1)?.hash ?? null,
  };
  const billing = publicBillingWindow(data.billingWindow ?? {});
  const roomRows = rooms.map((room) => `<tr><td><strong>${esc(room.name)}</strong></td><td>${room.players}</td><td>${room.bots}</td><td>${room.topScore}</td><td>${esc(room.topName)}</td></tr>`).join("");

  return `<section class="page-intro evidence-intro"><div class="eyebrow">Evidence · generated by the running service</div><h1>Live operations, with inspectable evidence.</h1><p class="sub">Live status, billing, incidents, control receipts, continuity, and bounded service logs share one operational view.</p><nav class="evidence-jump" aria-label="Evidence sections"><a href="#availability">Live status</a><a href="#spend">Billing</a><a href="#incidents">Incidents</a><a href="#receipts">Control receipts</a><a href="#continuity">State copies</a><a href="#logs">Recent logs</a></nav></section>
  <section class="evidence-block" id="availability" tabindex="-1" aria-labelledby="availability-heading">
    <div class="eyebrow">Live status</div><h2 id="availability-heading">Tank access and activity</h2>
    <p class="action-links"><a class="action-link" href="/status.json">Raw status JSON →</a></p>
    <div class="live-controls"><button type="button" id="status-autoupdate" class="secondary">Pause auto-update</button><p class="sub">Live figures refresh every 15 seconds in place. Last updated <time id="status-updated-at">just now</time>.</p></div>
    <p class="sr-only" id="status-live" role="status" aria-live="polite"></p>
    <div class="metric-grid status-metrics">
      ${metricCard(data.maintenance?.enabled ? "CLOSED" : "OPEN", "Tank access", data.maintenance?.enabled ? "scheduled gate active" : "game traffic available", "traffic", data.maintenance?.enabled ? "tone-violet" : "tone-green", "status-tank-access")}
      ${metricCard(`${availability.availabilityPercent}%`, "Tank availability", `${availability.unscheduledDowntimePercent}% unscheduled downtime`, "availability", "tone-green", "status-tank-availability")}
      ${metricCard(players, "Active players", `${players === 1 ? "human session" : "human sessions"} across ${rooms.length} tanks`, "players", players ? "tone-cyan" : "tone-violet", "status-active-players")}
    </div>
    <div class="card hero-card"><h3 class="u-card-heading">Tank availability since project start</h3>${incidentTimelineSvg(incidents, Date.now(), history)}${timelineLegend(incidents, history)}</div>
    <div class="card"><h3 class="u-card-heading">Tank activity</h3><div class="table-scroll" role="region" aria-label="Tank activity" tabindex="0"><table class="capacity-table"><caption class="sr-only">Tank activity: human players and computer-controlled agents per tank</caption><thead><tr><th scope="col">Tank</th><th scope="col">Active players</th><th scope="col">Agents</th><th scope="col">Top score</th><th scope="col">Leader</th></tr></thead><tbody id="status-tank-rows">${roomRows}</tbody></table></div></div>
  </section>
  ${spendHtml(billing, true)}
  ${incidentsSection(incidents, history)}
  ${controlHistoryListHtml(history, integrity)}
  ${backupPanelHtml(data.backup)}
  ${publicLogsHtml(logs.serviceEvents, logs.tanks ?? [], logs.caps ?? { serviceTruncated: false, captureTruncated: false }, true)}
  ${statusLiveScript()}`;
}

function gameLogText(roomId: string, events: GameLogWireEvent[]): Response {
  // A display name is user-controlled and this file opens in Excel and Sheets, where a
  // leading =, +, -, @, tab or CR makes the cell a live formula. CSV quoting does not stop
  // that — the quotes are stripped on import and the formula still runs. Prefix a single
  // quote so the cell stays text, then quote as before. Tab and CR are folded into the
  // whitespace pass first so they cannot smuggle a formula lead past the check.
  const field = (value: unknown) => {
    const plain = String(value ?? "").replace(/[\r\n\t]+/g, " ");
    const safe = /^[=+\-@]/.test(plain) ? `'${plain}` : plain;
    return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = ["timestamp,reason_code,tick,action,name,details"];
  for (const event of events) {
    const record = normalizeGameLogEvent(event);
    lines.push([record.timestamp, record.reasonCode, record.tick, record.action, record.name, record.details].map(field).join(","));
  }
  return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${roomId}-game-log.txt"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

/** Authenticated operations dashboard. Dynamic values are written with textContent. */
function adminViewerHtml(): string {
  // No template literals / ${} inside, to stay valid in this string.
  const script = [
    "function duration(ms){var s=Math.max(0,Math.floor(ms/1000)),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return d?d+'d '+h+'h':h?h+'h '+m+'m':m+'m';}",
    "function coverageRow(body,name,value,url){var tr=document.createElement('tr'),a=document.createElement('td'),b=document.createElement('td'),span=document.createElement('span');a.className='cell-key';a.title=name;a.textContent=name;b.className='cell-detail';b.title=value;span.textContent=value;b.appendChild(span);if(url){var link=document.createElement('a');link.href=url;link.textContent='Reference';link.className='coverage-reference';b.appendChild(link);}tr.appendChild(a);tr.appendChild(b);body.appendChild(tr);}",
    "async function tick(){try{",
    "var sr=await fetch('/admin/status.json');var sd=await sr.json();var b=sd.billingWindow||{};",
    "document.getElementById('billing-cost').textContent=typeof b.estimatedVariableUsd==='number'?'$'+b.estimatedVariableUsd.toFixed(8):'—';",
    "document.getElementById('billing-requests').textContent=(b.requests||0).toLocaleString();",
    "document.getElementById('billing-duration').textContent=(b.gbSeconds||0).toLocaleString();",
    "document.getElementById('billing-do-rows').textContent=(b.storageRowsRead||0).toLocaleString()+' / '+(b.storageRowsWritten||0).toLocaleString();",
    "document.getElementById('billing-rate').textContent=(b.requestRatePerMinute||0).toFixed(2)+'/min';",
    "var services=b.services||{},dob=services.durableObjects||{},d1=services.d1||{},r2s=services.r2||{},workers=services.workers||{},sources=(b.freeTier||{}).sources||{},coverage=document.getElementById('billing-coverage');coverage.textContent='';if(workers.configured!==false)coverageRow(coverage,'Workers',workers.requests==null?String(workers.note||'Account analytics required'):(workers.requests||0).toLocaleString()+' requests',sources.workers);if(dob.configured!==false)coverageRow(coverage,'Durable Objects',(dob.requests||0).toLocaleString()+' requests · '+(dob.rowsRead||0).toLocaleString()+' reads · '+(dob.rowsWritten||0).toLocaleString()+' writes',sources.durableObjects);if(d1.configured)coverageRow(coverage,'D1',(d1.rowsRead||0).toLocaleString()+' reads · '+(d1.rowsWritten||0).toLocaleString()+' writes',sources.d1);if(r2s.configured)coverageRow(coverage,'R2',(r2s.objects||0).toLocaleString()+' objects · '+((r2s.classAOperations||0)+(r2s.classBOperations||0)).toLocaleString()+' operations · '+((r2s.storageBytes||0)/1000000).toFixed(2)+' MB',sources.r2);document.getElementById('billing-coverage-card').hidden=!coverage.children.length;document.getElementById('billing-r2-footprint').textContent=((r2s.classAOperations||0)+(r2s.classBOperations||0)).toLocaleString()+' · '+((r2s.storageBytes||0)/1000000).toFixed(2)+' MB';",
    "var monthly=b.freeTierProjectedMonthlyUsd||0,ratio=Math.max(0,Math.min(1,monthly/5)),angle=-90+ratio*180,tone=monthly>5?'tone-red':monthly>0?'tone-yellow':'tone-green',state=monthly>5?'REDLINE':monthly>0?'METERED':'INCLUDED';",
    "var needle=document.getElementById('billing-gauge-needle');needle.setAttribute('transform','rotate('+angle+' 110 112)');needle.setAttribute('class','gauge-needle '+tone);document.getElementById('billing-gauge-value').textContent='$'+monthly.toFixed(2);document.getElementById('billing-gauge-state').textContent=state;document.getElementById('billing-gauge-state').className='meter-pill '+tone;document.getElementById('billing-gauge-value').parentElement.className='gauge-readout '+tone;document.getElementById('billing-current-spend').textContent='$'+(b.estimatedVariableUsd||0).toFixed(8);",
    "var rooms=sd.rooms||[],players=rooms.reduce(function(n,x){return n+(x.players||0)},0),seats=rooms.reduce(function(n,x){return n+(x.capacity||0)},0),active=rooms.filter(function(x){return x.players>0}).length,bots=rooms.reduce(function(n,x){return n+(x.bots||0)},0);",
    "document.getElementById('kpi-active-players').textContent=players.toLocaleString();document.getElementById('kpi-human-seats').textContent=players+' / '+seats;document.getElementById('kpi-bot-seats').textContent=bots.toLocaleString();document.getElementById('kpi-active-rooms').textContent=active+' / '+rooms.length;document.getElementById('kpi-uptime').textContent=duration((sd.usage||{}).uptimeMs||0);document.getElementById('kpi-audit-events').textContent=((sd.usage||{}).auditEvents||0).toLocaleString();",
    "var hi=sd.history||[],hib=document.getElementById('history-rows');hib.textContent='';hi.slice().reverse().forEach(function(e){var tr=document.createElement('tr'),cells=['#'+e.sequence,e.code,e.title,e.summary,new Date(e.ts).toLocaleString(),e.reference||'',String(e.hash||'').slice(0,16)+'…'],classes=['cell-seq','cell-code','cell-key','cell-detail','cell-time','cell-key','cell-code'];cells.forEach(function(v,i){var td=document.createElement('td');td.className=classes[i];td.title=String(v);if(i===1||i===6){var c=document.createElement('code');c.textContent=v;td.appendChild(c);}else if(i===3){var span=document.createElement('span');span.textContent=v;td.appendChild(span);}else td.textContent=v;tr.appendChild(td);});hib.appendChild(tr);});if(!hi.length){var hr=document.createElement('tr'),hd=document.createElement('td');hd.colSpan=7;hd.textContent='No control events recorded.';hr.appendChild(hd);hib.appendChild(hr);}var integrity=sd.historyIntegrity||{},head=integrity.headHash||'none',integrityNode=document.getElementById('history-integrity');integrityNode.textContent=(integrity.entryCount||0)+' append-only entries · '+(integrity.algorithm||'SHA-256')+' head '+(head==='none'?head:head.slice(0,16)+'…');integrityNode.title=head;",
    "var m=sd.maintenance||{};var mb=document.getElementById('maintenance-toggle');mb.dataset.enabled=m.enabled?'1':'0';mb.textContent=m.enabled?'Bring server online':'Take server down';mb.className=m.enabled?'restore':'danger';",
    "document.getElementById('maintenance-state').textContent=m.enabled?'OFFLINE':'ONLINE';document.getElementById('maintenance-state').className='m '+(m.enabled?'o':'g');",
    "}catch(err){}}",
    "document.getElementById('maintenance-toggle').addEventListener('click',async function(){var b=this,o=document.getElementById('maintenance-output'),enabling=b.dataset.enabled!=='1';if(enabling&&!confirm('Take the game offline and disconnect every active player? Public evidence, read-only API routes, and Admin will remain available.'))return;b.disabled=true;try{var r=await fetch('/admin/maintenance',{method:'POST',headers:{'content-type':'application/json','x-wg-ops-action':'maintenance'},body:JSON.stringify({enabled:enabling,reason:enabling?'Scheduled maintenance':''})}),d=await r.json();if(!r.ok)throw new Error(d.error||'request failed');o.hidden=false;o.textContent=d.message||'Maintenance state updated.';await tick();}catch(e){o.hidden=false;o.textContent='Unable to change maintenance mode.';}finally{b.disabled=false;}});",
    "document.getElementById('billing-reset').addEventListener('click',async function(){var b=this;if(!confirm('Reset the billing measurement window to zero? Uptime and status history will be preserved.'))return;b.disabled=true;try{var r=await fetch('/admin/billing-reset',{method:'POST',headers:{'x-wg-ops-action':'billing-reset'}});if(!r.ok)throw new Error('request failed');await tick();}catch(e){alert('Unable to reset the billing counter.');}finally{b.disabled=false;}});",
    "tick();setInterval(tick,1500);",
  ].join("");
  return `<section class="page-intro"><div class="eyebrow">Control room · sharp teeth</div><h1>Admin</h1>
    <p class="sub">Authenticated traffic controls, incident receipts, billing thresholds, and live runtime KPIs.</p></section>
    <h2 class="u-ops-pulse-heading">Operations pulse</h2>
    <div class="metric-grid stat-grid">
      ${metricCard("—", "Active players", "live human sessions", "players", "tone-cyan", "kpi-active-players")}
      ${metricCard("—", "Human seats", "used / 24 available", "traffic", "tone-violet", "kpi-human-seats")}
      ${metricCard("—", "Bot seats", "server-authoritative rivals", "bot", "tone-yellow", "kpi-bot-seats")}
      ${metricCard("—", "Active tanks", "tanks with human players", "rooms", "tone-green", "kpi-active-rooms")}
      ${metricCard("—", "Service uptime", "preserved across billing resets", "uptime", "tone-green", "kpi-uptime")}
      ${metricCard("—", "Action log events", "lifetime status counter", "audit", "tone-cyan", "kpi-audit-events")}
    </div>
    <div class="card"><h2 class="u-panel-heading">Server control</h2>
      <p>Game traffic: <strong id="maintenance-state" class="m">CHECKING…</strong></p>
      <div class="server-controls"><button type="button" id="maintenance-toggle" class="danger" data-enabled="0">Take server down</button></div>
      <pre class="control-output" id="maintenance-output" role="status" aria-live="polite" aria-atomic="true" hidden></pre>
      <p class="sub u-m-10-0-0">Taking the game down disconnects active tanks and gates the game shell, assets, and tank WebSockets. Public evidence, read-only API routes, and Admin stay online.</p>
    </div>
    <div class="card"><div class="eyebrow">Control receipts</div><h2 class="u-panel-heading-tight">Append-only control history</h2><p class="sub" id="history-integrity">Loading receipt chain…</p><div class="table-scroll" role="region" aria-label="Append-only control history" tabindex="0"><table class="history-table"><caption class="sr-only">Append-only control history</caption><thead><tr><th scope="col">Seq</th><th scope="col">Code</th><th scope="col">Decision</th><th scope="col">Outcome</th><th scope="col">Time</th><th scope="col">Reference</th><th scope="col">Receipt</th></tr></thead><tbody id="history-rows"></tbody></table></div><p class="sub u-m-0">SHA-256 receipts link each control decision to the previous entry. These rows are not subject to the 90-day user-action retention policy.</p></div>
    <div class="card gauge-card"><h2 class="u-panel-heading">Billing fuel gauge</h2>
      ${billingGaugeSvg("billing")}
      <div class="metric-grid stat-grid">
        ${metricCard("—", "Window spend", "measured variable estimate", "audit", "tone-cyan", "billing-cost")}
        ${metricCard("—", "Billable requests", "since reset", "requests", "tone-violet", "billing-requests")}
        ${metricCard("—", "Request velocity", "current-window average", "availability", "tone-yellow", "billing-rate")}
        ${metricCard("—", "Duration", "measured GB-s", "uptime", "tone-green", "billing-duration")}
        ${metricCard("—", "DO rows R / W", "SQLite threshold window", "audit", "tone-violet", "billing-do-rows")}
        ${metricCard("—", "R2 ops / storage", "bound asset bucket", "rooms", "tone-green", "billing-r2-footprint")}
      </div>
      <div class="card u-mt-14" id="billing-coverage-card" hidden><h3 class="u-m-0-0-8">Billing coverage</h3><div class="table-scroll u-m-0" role="region" aria-label="Billing coverage" tabindex="0"><table class="billing-table"><caption class="sr-only">Billing coverage</caption><thead><tr><th scope="col">Bound service</th><th scope="col">Measured usage or reference</th></tr></thead><tbody id="billing-coverage"></tbody></table></div></div>
      <p><button type="button" id="billing-reset" class="secondary">Reset billing counter</button></p>
    </div>
    <script nonce="__WG_CSP_NONCE__">${script}</script>`;
}

export {
  PAGE_CSS_PATH,
  pageCssResponse,
  tankCopy,
  AUDIT_ROOMS,
  AUDIT_ROOM_NAMES,
  incidentSummary,
  INCIDENTS,
  normalizeServiceLogEvent,
  normalizeGameLogEvent,
  CAPTURE_WINDOW_MS,
  LOG_FETCH_SERVICE,
  LOG_FETCH_CAPTURES,
  evidenceDashboardHtml,
  gameLogText,
  adminViewerHtml,
};

export type {
  IncidentRecord,
  ControlHistoryEntry,
  ControlHistoryIntegrity,
  PublicLogEvent,
  GameLogWireEvent,
  PublicTankLog,
  PublicEvidenceStatus,
};
