
const API_BASE = "https://data-api.binance.vision/api/v3";
const DEFAULT_ASSETS = ["BTC","ETH","SOL","LINK","AVAX"];
const DEFAULT_WEIGHTS = {trend:30,momentum:20,strength:15,volume:15,volatility:10,structure:10};
const state = {
  assets: JSON.parse(localStorage.getItem("quant_assets") || "null") || DEFAULT_ASSETS,
  weights: JSON.parse(localStorage.getItem("quant_weights") || "null") || DEFAULT_WEIGHTS,
  market: {},
  selected: null,
  analysis: null
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (n,d=2) => Number(n).toLocaleString("es-MX",{maximumFractionDigits:d,minimumFractionDigits:n<1?Math.min(d,4):0});
const money = n => "$" + Number(n).toLocaleString("en-US",{maximumFractionDigits:n<1?6:2});
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

function showView(id){
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===id));
  $$(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
  window.scrollTo({top:0,behavior:"smooth"});
  if(id==="backtestView") fillAssetSelects();
}
$$(".bottom-nav button").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));

async function api(path, params={}){
  const url = new URL(API_BASE + path);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),12000);
  try{
    const r = await fetch(url,{signal:controller.signal,cache:"no-store"});
    if(!r.ok) throw new Error("API "+r.status);
    return await r.json();
  } finally { clearTimeout(timeout); }
}

function ema(values, period){
  const k=2/(period+1), out=[];
  let prev=values[0];
  values.forEach((v,i)=>{prev=i===0?v:v*k+prev*(1-k);out.push(prev)});
  return out;
}
function sma(values,p){
  return values.map((_,i)=>i<p-1?null:values.slice(i-p+1,i+1).reduce((a,b)=>a+b,0)/p);
}
function rsi(values,p=14){
  const out=Array(values.length).fill(null); let gains=0,losses=0;
  for(let i=1;i<=p;i++){const d=values[i]-values[i-1];gains+=Math.max(d,0);losses+=Math.max(-d,0)}
  let ag=gains/p, al=losses/p; out[p]=al===0?100:100-100/(1+ag/al);
  for(let i=p+1;i<values.length;i++){const d=values[i]-values[i-1];ag=(ag*(p-1)+Math.max(d,0))/p;al=(al*(p-1)+Math.max(-d,0))/p;out[i]=al===0?100:100-100/(1+ag/al)}
  return out;
}
function atr(candles,p=14){
  const tr=candles.map((c,i)=>i===0?c.h-c.l:Math.max(c.h-c.l,Math.abs(c.h-candles[i-1].c),Math.abs(c.l-candles[i-1].c)));
  return ema(tr,p);
}
function adx(c,p=14){
  const trs=[],plus=[],minus=[];
  for(let i=0;i<c.length;i++){
    if(i===0){trs.push(c[i].h-c[i].l);plus.push(0);minus.push(0);continue}
    const up=c[i].h-c[i-1].h, dn=c[i-1].l-c[i].l;
    plus.push(up>dn&&up>0?up:0); minus.push(dn>up&&dn>0?dn:0);
    trs.push(Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c)));
  }
  const atrE=ema(trs,p), pE=ema(plus,p), mE=ema(minus,p);
  const dx=c.map((_,i)=>{const pi=100*pE[i]/(atrE[i]||1),mi=100*mE[i]/(atrE[i]||1);return 100*Math.abs(pi-mi)/((pi+mi)||1)});
  return ema(dx,p);
}
function analyze(candles){
  const closes=candles.map(x=>x.c), vols=candles.map(x=>x.v);
  const e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200),rs=rsi(closes),at=atr(candles),ax=adx(candles),v20=sma(vols,20);
  const i=closes.length-1, price=closes[i], prev=closes[i-1];
  let factors={};
  factors.trend = (price>e20[i]?0.35:0)+(e20[i]>e50[i]?0.35:0)+(e50[i]>e200[i]?0.30:0);
  factors.momentum = rs[i]>=50&&rs[i]<=68?1:rs[i]>=45&&rs[i]<75?.65:rs[i]<35?.45:.2;
  factors.strength = ax[i]>=25?1:ax[i]>=18?.65:.3;
  factors.volume = v20[i]&&vols[i]>v20[i]?1:.45;
  const atrPct=at[i]/price*100;
  factors.volatility = atrPct>=1&&atrPct<=6?1:atrPct<9?.6:.25;
  const look=candles.slice(-12), highs=look.map(x=>x.h), lows=look.map(x=>x.l);
  factors.structure=(highs.at(-1)>Math.max(...highs.slice(0,-1))?.55:0)+(lows.at(-1)>Math.min(...lows.slice(0,-1))?.45:0);
  const score=Math.round(Object.entries(factors).reduce((s,[k,v])=>s+v*(state.weights[k]||0),0));
  let decision=score>=75?"Favorable":score>=58?"Esperar confirmación":score>=42?"Neutral":"Evitar";
  const trend=price>e20[i]&&e20[i]>e50[i]?"Alcista":price<e20[i]&&e20[i]<e50[i]?"Bajista":"Mixta";
  const support=Math.min(...candles.slice(-20).map(x=>x.l)), resistance=Math.max(...candles.slice(-20).map(x=>x.h));
  return {score,decision,trend,rsi:rs[i],adx:ax[i],atrPct,volumeRatio:v20[i]?vols[i]/v20[i]:1,support,resistance,price,change:(price/prev-1)*100,e20,e50,e200,factors};
}
async function getCandles(symbol,interval="1d",limit=500){
  const raw=await api("/klines",{symbol:symbol+"USDT",interval,limit});
  return raw.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));
}
async function getTicker(symbol){
  return api("/ticker/24hr",{symbol:symbol+"USDT"});
}

function scoreClass(score){return score>=75?"good":score>=55?"warn":score<40?"bad":"neutral"}
function renderAssets(){
  const grid=$("#assetGrid"); grid.innerHTML="";
  state.assets.forEach(sym=>{
    const d=state.market[sym];
    const card=document.createElement("article");card.className="asset-card";
    card.innerHTML=d?`
      <div class="asset-top">
        <div class="symbol-wrap"><div class="coin-badge">${sym.slice(0,2)}</div><div><h3>${sym}</h3><span class="pair">${sym}/USDT</span></div></div>
        <div class="score-ring" style="--score:${d.score}"><span>${d.score}</span></div>
      </div>
      <div class="price">${money(d.price)}</div>
      <div class="change ${d.change>=0?"pos":"neg"}">${d.change>=0?"+":""}${fmt(d.change)}% · 24h</div>
      <div class="card-actions"><span class="tag">${d.decision}</span><button class="remove-btn" data-remove="${sym}" aria-label="Eliminar">×</button></div>
    `:`
      <div class="asset-top"><div class="symbol-wrap"><div class="coin-badge">${sym.slice(0,2)}</div><div><h3>${sym}</h3><span class="pair">${sym}/USDT</span></div></div></div>
      <div class="price">Cargando…</div>`;
    card.addEventListener("click",e=>{if(!e.target.dataset.remove) openAnalysis(sym)});
    grid.appendChild(card);
  });
  $$("[data-remove]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();removeAsset(b.dataset.remove)}));
}
async function refreshAll(){
  $("#refreshAllBtn").classList.add("loading");
  renderAssets();
  let ok=0;
  await Promise.all(state.assets.map(async sym=>{
    try{
      const [t,c]=await Promise.all([getTicker(sym),getCandles(sym,"1d",260)]);
      const a=analyze(c);
      state.market[sym]={...a,price:+t.lastPrice,change:+t.priceChangePercent};
      ok++;
      renderAssets();
    }catch(e){console.warn(sym,e)}
  }));
  const scores=Object.values(state.market).map(x=>x.score);
  const avg=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;
  $("#marketSummary").textContent=ok?`${ok} activos analizados · score medio ${avg}/100`:"No fue posible conectar con datos públicos";
  $("#lastUpdate").textContent=new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
  $("#refreshAllBtn").classList.remove("loading");
}
async function openAnalysis(sym){
  state.selected=sym;showView("analysisView");$("#analysisTitle").textContent=sym+"/USDT";await refreshAnalysis();
}
async function refreshAnalysis(){
  if(!state.selected)return;
  $("#analysisView").classList.add("loading");
  try{
    const interval=$("#timeframeSelect").value;
    const candles=await getCandles(state.selected,interval,500);
    const a=analyze(candles);state.analysis={candles,...a};
    $("#mainScore").textContent=a.score+"/100";
    $("#mainDecision").textContent=a.decision;$("#mainDecision").className="decision "+scoreClass(a.score);
    $("#analysisPrice").textContent=money(a.price);
    $("#analysisChange").textContent=`Última vela: ${a.change>=0?"+":""}${fmt(a.change)}%`;
    $("#chartCaption").textContent=`${state.selected}/USDT · ${interval} · ${candles.length} velas`;
    renderDiagnostic(a);drawPriceChart(candles,a);
  }catch(e){$("#plainExplanation").textContent="No se pudieron descargar los datos. Revisa la conexión e intenta de nuevo."}
  $("#analysisView").classList.remove("loading");
}
function renderDiagnostic(a){
  const metrics=[
    ["Tendencia",a.trend],["RSI 14",fmt(a.rsi,1)],["ADX 14",fmt(a.adx,1)],
    ["ATR / precio",fmt(a.atrPct,2)+"%"],["Volumen / promedio",fmt(a.volumeRatio,2)+"x"],
    ["Soporte 20 velas",money(a.support)],["Resistencia 20 velas",money(a.resistance)]
  ];
  $("#diagnosticGrid").innerHTML=metrics.map(([k,v])=>`<div class="diag"><span>${k}</span><strong>${v}</strong></div>`).join("");
  const ext=a.price>a.e20.at(-1)*1.08;
  let txt=`La estructura es ${a.trend.toLowerCase()} y la fuerza ADX está en ${fmt(a.adx,1)}. `;
  txt+=a.rsi>70?"El momentum está sobrecomprado; perseguir el precio aumenta el riesgo. ":a.rsi>=50?"El momentum acompaña la tendencia sin estar en extremo. ":"El momentum es débil. ";
  txt+=a.volumeRatio>1?"El volumen supera su promedio reciente. ":"El volumen todavía no confirma con claridad. ";
  txt+=ext?"El precio está muy separado de la EMA20, por lo que conviene esperar retroceso o consolidación. ":"La distancia respecto a la media corta es razonable. ";
  txt+=`Resultado: ${a.decision.toLowerCase()}.`;
  $("#plainExplanation").textContent=txt;
}
function drawLineChart(canvas, series, labels=[]){
  const ctx=canvas.getContext("2d"),W=canvas.width,H=canvas.height,p={l:54,r:18,t:20,b:36};
  ctx.clearRect(0,0,W,H);ctx.fillStyle="#0b1726";ctx.fillRect(0,0,W,H);
  const vals=series.flatMap(s=>s.values.filter(Number.isFinite)),min=Math.min(...vals),max=Math.max(...vals),range=max-min||1;
  ctx.strokeStyle="#1f3148";ctx.lineWidth=1;
  for(let j=0;j<5;j++){const y=p.t+j*(H-p.t-p.b)/4;ctx.beginPath();ctx.moveTo(p.l,y);ctx.lineTo(W-p.r,y);ctx.stroke();
    ctx.fillStyle="#7186a0";ctx.font="12px system-ui";ctx.fillText(fmt(max-j*range/4,2),5,y+4)}
  const cols=["#edf4ff","#5ee1b7","#73a7ff","#f6c86b"];
  series.forEach((s,si)=>{ctx.strokeStyle=cols[si%cols.length];ctx.lineWidth=si===0?2.4:1.6;ctx.beginPath();
    s.values.forEach((v,i)=>{if(!Number.isFinite(v))return;const x=p.l+i*(W-p.l-p.r)/(s.values.length-1),y=p.t+(max-v)/range*(H-p.t-p.b);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});ctx.stroke()});
}
function drawPriceChart(c,a){
  const n=Math.min(120,c.length),slice=c.slice(-n);
  drawLineChart($("#priceChart"),[
    {values:slice.map(x=>x.c)},{values:a.e20.slice(-n)},{values:a.e50.slice(-n)}
  ]);
}
function removeAsset(sym){
  if(state.assets.length<=1)return alert("Debe quedar al menos un activo.");
  state.assets=state.assets.filter(x=>x!==sym);delete state.market[sym];
  localStorage.setItem("quant_assets",JSON.stringify(state.assets));renderAssets();fillAssetSelects();
}
function fillAssetSelects(){
  $("#btSymbol").innerHTML=state.assets.map(s=>`<option value="${s}">${s}/USDT</option>`).join("");
}
$("#addAssetBtn").onclick=()=>{$("#newAssetInput").value="";$("#assetDialogError").textContent="";$("#assetDialog").showModal()};
$("#confirmAddAsset").onclick=async e=>{
  e.preventDefault();const sym=$("#newAssetInput").value.trim().toUpperCase().replace(/USDT$/,"");
  if(!/^[A-Z0-9]{2,10}$/.test(sym)){return $("#assetDialogError").textContent="Símbolo no válido."}
  if(state.assets.includes(sym)){return $("#assetDialogError").textContent="Ya está en favoritos."}
  try{await getTicker(sym);state.assets.push(sym);localStorage.setItem("quant_assets",JSON.stringify(state.assets));$("#assetDialog").close();refreshAll()}
  catch{$("#assetDialogError").textContent="No encontré ese par contra USDT en Binance."}
};

function entrySignal(preset,i,c,ind){
  if(i<210)return false;
  const price=c[i].c,prev=c[i-1].c;
  if(preset==="trend") return ind.e20[i]>ind.e50[i]&&ind.e50[i]>ind.e200[i]&&ind.rs[i]>=50&&ind.rs[i]<=68;
  if(preset==="pullback") return price>ind.e200[i]&&prev<ind.e20[i-1]&&price>ind.e20[i];
  if(preset==="breakout"){
    const max20=Math.max(...c.slice(i-20,i).map(x=>x.h)),vavg=ind.v20[i];
    return price>max20&&vavg&&c[i].v>vavg*1.2;
  }
  return false;
}
async function runBacktest(){
  const btn=$("#runBacktestBtn");btn.classList.add("loading");btn.textContent="Calculando…";
  try{
    const sym=$("#btSymbol").value,int=$("#btInterval").value,preset=$("#btPreset").value;
    const stop=+$("#btStop").value/100,target=+$("#btTarget").value/100,fee=+$("#btFee").value/100,risk=+$("#btRisk").value/100;
    const initial=+$("#btCapital").value,c=await getCandles(sym,int,1000),cl=c.map(x=>x.c);
    const ind={e20:ema(cl,20),e50:ema(cl,50),e200:ema(cl,200),rs:rsi(cl),v20:sma(c.map(x=>x.v),20)};
    let equity=initial,peak=initial,maxDD=0,wins=0,losses=0,trades=[],curve=[initial],inPos=false,entry=0,size=0,entryI=0;
    for(let i=210;i<c.length;i++){
      if(!inPos&&entrySignal(preset,i,c,ind)){
        entry=c[i].c; const riskCash=equity*risk; size=riskCash/(entry*stop); inPos=true;entryI=i;
      } else if(inPos){
        const stopP=entry*(1-stop),targetP=entry*(1+target);let exit=null,reason="";
        if(c[i].l<=stopP){exit=stopP;reason="stop"}
        else if(c[i].h>=targetP){exit=targetP;reason="target"}
        else if(i-entryI>=40){exit=c[i].c;reason="time"}
        if(exit){
          const gross=(exit-entry)*size,fees=(entry+exit)*size*fee,pnl=gross-fees;
          equity+=pnl;pnl>0?wins++:losses++;trades.push({pnl,reason});curve.push(equity);
          peak=Math.max(peak,equity);maxDD=Math.max(maxDD,(peak-equity)/peak);inPos=false;
        }
      }
    }
    const n=trades.length,winRate=n?wins/n*100:0,total=(equity/initial-1)*100,avg=n?trades.reduce((s,t)=>s+t.pnl,0)/n:0;
    const grossWin=trades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0),grossLoss=Math.abs(trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));
    const pf=grossLoss?grossWin/grossLoss:0;
    const vals=[["Operaciones",n],["Ganadoras",fmt(winRate,1)+"%"],["Resultado",fmt(total,2)+"%"],["Capital final",money(equity)],["Promedio / operación",money(avg)],["Profit factor",fmt(pf,2)],["Drawdown máximo",fmt(maxDD*100,2)+"%"]];
    $("#btResults").innerHTML=vals.map(([k,v])=>`<div class="result-card"><span>${k}</span><strong>${v}</strong></div>`).join("");
    $("#btResults").classList.remove("hidden");$("#btEquityWrap").classList.remove("hidden");
    drawLineChart($("#equityChart"),[{values:curve}]);
  }catch(e){alert("No fue posible completar el backtest: "+e.message)}
  btn.classList.remove("loading");btn.textContent="Ejecutar backtest";
}
$("#runBacktestBtn").onclick=runBacktest;

$("#calcPositionBtn").onclick=()=>{
  const capital=+$("#posCapital").value,riskPct=+$("#posRisk").value/100,entry=+$("#posEntry").value,stop=+$("#posStop").value,target=+$("#posTarget").value;
  if(!(capital>0&&riskPct>0&&entry>0&&stop>0&&target>0)||stop>=entry||target<=entry)return alert("Revisa los datos: stop menor que entrada y objetivo mayor que entrada.");
  const riskCash=capital*riskPct,unitRisk=entry-stop,qty=riskCash/unitRisk,position=qty*entry,potential=(target-entry)*qty,rr=(target-entry)/(entry-stop);
  const vals=[["Riesgo máximo",money(riskCash)],["Cantidad de monedas",fmt(qty,8)],["Tamaño de posición",money(position)],["Pérdida en stop",money(riskCash)],["Ganancia potencial",money(potential)],["Riesgo / beneficio","1 : "+fmt(rr,2)]];
  $("#positionResults").innerHTML=vals.map(([k,v])=>`<div class="result-card"><span>${k}</span><strong>${v}</strong></div>`).join("");$("#positionResults").classList.remove("hidden");
};

function renderWeights(){
  const names={trend:"Tendencia",momentum:"Momentum",strength:"Fuerza ADX",volume:"Volumen",volatility:"Volatilidad",structure:"Estructura"};
  $("#weightsForm").innerHTML=Object.entries(names).map(([k,n])=>`<div class="weight-row"><label>${n}</label><input data-weight="${k}" type="number" min="0" max="100" value="${state.weights[k]}"></div>`).join("");
}
$("#saveWeightsBtn").onclick=()=>{
  let total=0,next={};$$("[data-weight]").forEach(i=>{next[i.dataset.weight]=+i.value;total+=+i.value});
  if(total!==100)return alert("Los pesos deben sumar exactamente 100. Ahora suman "+total+".");
  state.weights=next;localStorage.setItem("quant_weights",JSON.stringify(next));alert("Pesos guardados.");refreshAll();
};
$("#resetDataBtn").onclick=()=>{if(confirm("¿Borrar favoritos, pesos y configuración local?")){localStorage.clear();location.reload()}};
$("#backToDashboard").onclick=()=>showView("dashboardView");
$("#refreshAnalysisBtn").onclick=refreshAnalysis;
$("#timeframeSelect").onchange=refreshAnalysis;
$("#refreshAllBtn").onclick=refreshAll;

renderWeights();fillAssetSelects();renderAssets();refreshAll();
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
