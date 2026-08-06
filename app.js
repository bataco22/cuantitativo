
const API_BASE = "https://data-api.binance.vision/api/v3";
const DEFAULT_ASSETS = ["BTC","ETH","SOL","LINK","AVAX"];
const DEFAULT_WEIGHTS = {trend:30,momentum:20,strength:15,volume:15,volatility:10,structure:10};
const state = {
  assets: JSON.parse(localStorage.getItem("quant_assets") || "null") || DEFAULT_ASSETS,
  weights: JSON.parse(localStorage.getItem("quant_weights") || "null") || DEFAULT_WEIGHTS,
  market: {},
  selected: null,
  analysis: null,
  paperTrades: JSON.parse(localStorage.getItem("quant_paper_trades") || "[]")
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
  if(id==="paperView"){ fillAssetSelects(); renderPaperTrades(); }
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
  const i=Math.max(1,closes.length-2), price=closes.at(-1), signalPrice=closes[i], prev=closes[i-1], atrPct=at[i]/signalPrice*100;
  const closedCandles=candles.slice(0,-1), look=closedCandles.slice(-12), highs=look.map(x=>x.h), lows=look.map(x=>x.l);
  const longFactors={
    trend:(signalPrice>e20[i]?.35:0)+(e20[i]>e50[i]?.35:0)+(e50[i]>e200[i]?.30:0),
    momentum:rs[i]>=50&&rs[i]<=68?1:rs[i]>=45&&rs[i]<75?.65:rs[i]<35?.45:.2,
    strength:ax[i]>=25?1:ax[i]>=18?.65:.3,
    volume:v20[i]&&vols[i]>v20[i]?1:.45,
    volatility:atrPct>=1&&atrPct<=6?1:atrPct<9?.6:.25,
    structure:(highs.at(-1)>Math.max(...highs.slice(0,-1))?.55:0)+(lows.at(-1)>Math.min(...lows.slice(0,-1))?.45:0)
  };
  const shortFactors={
    trend:(signalPrice<e20[i]?.35:0)+(e20[i]<e50[i]?.35:0)+(e50[i]<e200[i]?.30:0),
    momentum:rs[i]>=32&&rs[i]<=50?1:rs[i]>25&&rs[i]<55?.65:rs[i]>70?.45:.2,
    strength:ax[i]>=25?1:ax[i]>=18?.65:.3,
    volume:v20[i]&&vols[i]>v20[i]?1:.45,
    volatility:atrPct>=1&&atrPct<=6?1:atrPct<9?.6:.25,
    structure:(lows.at(-1)<Math.min(...lows.slice(0,-1))?.55:0)+(highs.at(-1)<Math.max(...highs.slice(0,-1))?.45:0)
  };
  const calc=f=>Math.round(Object.entries(f).reduce((s,[k,v])=>s+v*(state.weights[k]||0),0));
  const longScore=calc(longFactors),shortScore=calc(shortFactors);
  const decision=s=>s>=75?"Favorable":s>=58?"Esperar confirmación":s>=42?"Neutral":"Evitar";
  return {longScore,shortScore,longDecision:decision(longScore),shortDecision:decision(shortScore),
    trend:signalPrice>e20[i]&&e20[i]>e50[i]?"Alcista":signalPrice<e20[i]&&e20[i]<e50[i]?"Bajista":"Mixta",
    rsi:rs[i],adx:ax[i],atrPct,volumeRatio:v20[i]?vols[i]/v20[i]:1,
    support:Math.min(...closedCandles.slice(-20).map(x=>x.l)),resistance:Math.max(...closedCandles.slice(-20).map(x=>x.h)),
    price,change:(price/signalPrice-1)*100,e20,e50,e200,longFactors,shortFactors};
}
async function getCandles(symbol,interval="1d",limit=500){
  const raw=await api("/klines",{symbol:symbol+"USDT",interval,limit});
  return raw.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));
}
async function getTicker(symbol){
  return api("/ticker/24hr",{symbol:symbol+"USDT"});
}

function scoreClass(score){return score>=75?"good":score>=55?"warn":score<40?"bad":"neutral"}
function activeScore(d,mode){return mode==="short"?d.shortScore:d.longScore}
function activeDecision(d,mode){return mode==="short"?d.shortDecision:d.longDecision}
function renderRanking(){
  const mode=$("#marketModeSelect")?.value||"long";
  const rows=state.assets.filter(s=>state.market[s]).map(s=>({s,d:state.market[s]})).sort((a,b)=>activeScore(b.d,mode)-activeScore(a.d,mode));
  $("#marketRanking").innerHTML=rows.length?rows.map((x,i)=>`<button class="rank-row" data-rank="${x.s}">
    <span class="rank-num">${i+1}</span><span class="rank-main"><strong>${x.s}/USDT</strong><small>${mode==="long"?"Oportunidad de compra":"Oportunidad de caída"}</small></span>
    <span class="rank-score">${activeScore(x.d,mode)}/100</span><span class="rank-action">${activeDecision(x.d,mode)}</span></button>`).join(""):"<div class='notice'>Actualizando ranking…</div>";
  $$("[data-rank]").forEach(b=>b.onclick=()=>openAnalysis(b.dataset.rank));
}
function renderAssets(){
  const grid=$("#assetGrid"); grid.innerHTML="";
  state.assets.forEach(sym=>{
    const d=state.market[sym];
    const card=document.createElement("article");card.className="asset-card";
    card.innerHTML=d?`
      <div class="asset-top">
        <div class="symbol-wrap"><div class="coin-badge">${sym.slice(0,2)}</div><div><h3>${sym}</h3><span class="pair">${sym}/USDT</span></div></div>
        <div class="score-ring" style="--score:${Math.max(d.longScore,d.shortScore)}"><span>${Math.max(d.longScore,d.shortScore)}</span></div>
      </div>
      <div class="price">${money(d.price)}</div>
      <div class="change ${d.change>=0?"pos":"neg"}">${d.change>=0?"+":""}${fmt(d.change)}% · 24h</div>
      <div class="dual-scores"><div class="mini-score"><span>Long</span><strong>${d.longScore}/100</strong></div><div class="mini-score"><span>Short</span><strong>${d.shortScore}/100</strong></div></div>
      <div class="card-actions"><span class="tag">${d.longScore>=d.shortScore?"Sesgo Long":"Sesgo Short"}</span><button class="remove-btn" data-remove="${sym}" aria-label="Eliminar">×</button></div>
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
      renderAssets();renderRanking();
    }catch(e){console.warn(sym,e)}
  }));
  const mode=$("#marketModeSelect")?.value||"long";
  const scores=Object.values(state.market).map(x=>activeScore(x,mode));
  const avg=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;
  $("#marketSummary").textContent=ok?`${ok} activos analizados · score ${mode==="long"?"Long":"Short"} medio ${avg}/100`:"No fue posible conectar con datos públicos";
  renderRanking();
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
    const mode=$("#analysisModeSelect").value,score=activeScore(a,mode),decision=activeDecision(a,mode);
    $("#mainScore").textContent=score+"/100";
    $("#mainDecision").textContent=decision;$("#mainDecision").className="decision "+scoreClass(score);
    $("#analysisPrice").textContent=money(a.price);
    $("#analysisChange").textContent=`Última vela: ${a.change>=0?"+":""}${fmt(a.change)}%`;
    $("#chartCaption").textContent=`${state.selected}/USDT · ${interval} · ${candles.length} velas`;
    renderDiagnostic(a);drawPriceChart(candles,a);
  }catch(e){$("#plainExplanation").textContent="No se pudieron descargar los datos. Revisa la conexión e intenta de nuevo."}
  $("#analysisView").classList.remove("loading");
}
function metricInterpretation(type,a,mode){
  const long=mode==="long";
  if(type==="trend"){
    const status=a.trend==="Alcista"?"Alcista":a.trend==="Bajista"?"Bajista":"Mixta";
    const tone=(long&&a.trend==="Alcista")||(!long&&a.trend==="Bajista")?"good":a.trend==="Mixta"?"warn":"bad";
    return {status,tone,min:0,max:2,pos:a.trend==="Bajista"?0:a.trend==="Mixta"?1:2,labels:["Bajista","Mixta","Alcista"],
      meaning:"Resume la dirección usando el precio y las medias EMA20, EMA50 y EMA200.",
      current:long?`Para Long, una tendencia ${a.trend.toLowerCase()} ${a.trend==="Alcista"?"ayuda":"no ayuda"}.`:`Para Short, una tendencia ${a.trend.toLowerCase()} ${a.trend==="Bajista"?"ayuda":"no ayuda"}.`,
      guide:"Alcista: buscar compras. Mixta: esperar. Bajista: favorece shorts."};
  }
  if(type==="rsi"){
    const v=a.rsi; let status,tone;
    if(v<30){status="Sobreventa";tone=long?"warn":"bad"} else if(v<45){status="Impulso débil";tone=long?"warn":"good"} else if(v<=65){status="Zona equilibrada";tone="good"} else if(v<=70){status="Impulso alto";tone="warn"} else {status="Sobrecompra";tone=long?"bad":"warn"}
    return {status,tone,min:0,max:100,pos:v,labels:["0","30","50","70","100"],
      meaning:"Mide la velocidad del movimiento. No indica por sí solo que debas comprar o vender.",
      current:`RSI ${fmt(v,1)}: ${status.toLowerCase()}.`,
      guide:"0–30: sobreventa · 45–65: zona saludable · 70–100: sobrecompra."};
  }
  if(type==="adx"){
    const v=a.adx; const status=v<20?"Muy poca fuerza":v<25?"Fuerza naciente":v<40?"Tendencia fuerte":"Tendencia muy fuerte";
    const tone=v<20?"bad":v<25?"warn":"good";
    return {status,tone,min:0,max:60,pos:Math.min(v,60),labels:["0","20","25","40","60+"],
      meaning:"Mide la fuerza de la tendencia, no si va hacia arriba o hacia abajo.",
      current:`ADX ${fmt(v,1)}: ${status.toLowerCase()}.`,
      guide:"Menos de 20: lateral · 20–25: empieza · 25–40: fuerte · más de 40: muy fuerte."};
  }
  if(type==="atr"){
    const v=a.atrPct; const status=v<1?"Movimiento bajo":v<=3?"Movimiento moderado":v<=6?"Movimiento alto":"Movimiento extremo";
    const tone=v<=3?"good":v<=6?"warn":"bad";
    return {status,tone,min:0,max:10,pos:Math.min(v,10),labels:["0%","1%","3%","6%","10%+"],
      meaning:"Es como el medidor de movimiento del mercado: estima cuánto recorre una vela en promedio.",
      current:`ATR ${fmt(v,2)}%: una vela suele recorrer cerca de ese porcentaje.`,
      guide:"Sirve para no colocar un stop más pequeño que el movimiento normal del activo."};
  }
  if(type==="volume"){
    const v=a.volumeRatio; const status=v<.5?"Muy bajo":v<.9?"Bajo":v<1.2?"Normal":v<2?"Alto":"Extraordinario";
    const tone=v<.5?"bad":v<.9?"warn":v<2?"good":"warn";
    return {status,tone,min:0,max:3,pos:Math.min(v,3),labels:["0x","0.5x","1x","2x","3x+"],
      meaning:"Compara el volumen de la última vela cerrada contra el promedio de las últimas 20.",
      current:`Volumen ${fmt(v,2)}x: ${status.toLowerCase()}.`,
      guide:"1x es normal · 2x es el doble de actividad · menos de 0.5x muestra poco interés."};
  }
  if(type==="support") return {status:"Zona inferior",tone:"neutral",meaning:"Es el precio más bajo observado en las últimas 20 velas cerradas.",current:`Soporte aproximado: ${money(a.support)}.`,guide:"No es una pared exacta; es una zona donde antes apareció demanda."};
  return {status:"Zona superior",tone:"neutral",meaning:"Es el precio más alto observado en las últimas 20 velas cerradas.",current:`Resistencia aproximada: ${money(a.resistance)}.`,guide:"No es una pared exacta; es una zona donde antes apareció oferta."};
}
function metricCard(type,label,value,a,mode){
  const x=metricInterpretation(type,a,mode);
  const gauge=x.pos!==undefined?`<div class="meter"><div class="meter-fill ${x.tone}" style="width:${clamp((x.pos-x.min)/(x.max-x.min)*100,0,100)}%"></div><span class="meter-marker" style="left:${clamp((x.pos-x.min)/(x.max-x.min)*100,0,100)}%"></span></div><div class="meter-labels">${x.labels.map(l=>`<span>${l}</span>`).join("")}</div>`:"";
  return `<button class="diag metric-help" type="button" aria-expanded="false">
    <span class="metric-title">${label}<b class="help-symbol">?</b></span><strong>${value}</strong><em class="metric-status ${x.tone}">${x.status}</em>
    <div class="metric-detail">${gauge}<p><b>Qué mide:</b> ${x.meaning}</p><p><b>Tu lectura:</b> ${x.current}</p><p><b>Guía rápida:</b> ${x.guide}</p></div>
  </button>`;
}
function renderDiagnostic(a){
  const mode=$("#analysisModeSelect").value;
  const metrics=[
    ["trend","Tendencia",a.trend],["rsi","RSI 14",fmt(a.rsi,1)],["adx","ADX 14",fmt(a.adx,1)],
    ["atr","ATR / precio",fmt(a.atrPct,2)+"%"],["volume","Volumen / promedio",fmt(a.volumeRatio,2)+"x"],
    ["support","Soporte 20 velas",money(a.support)],["resistance","Resistencia 20 velas",money(a.resistance)]
  ];
  $("#diagnosticGrid").innerHTML=metrics.map(m=>metricCard(...m,a,mode)).join("");
  $$(".metric-help").forEach(card=>card.addEventListener("click",()=>{
    const open=card.classList.toggle("open");card.setAttribute("aria-expanded",open?"true":"false");
  }));
  let txt;
  if(mode==="long"){
    txt=`Lectura Long: tendencia ${a.trend.toLowerCase()}, ADX ${fmt(a.adx,1)} y RSI ${fmt(a.rsi,1)}. `;
    txt+=a.rsi>70?"Está sobrecomprado; no conviene perseguirlo. ":a.rsi>=50?"El momentum acompaña la compra. ":"El momentum comprador es débil. ";
    txt+=a.volumeRatio>1?"El volumen confirma mejor. ":"El volumen aún no confirma. ";
    txt+=`Resultado: ${a.longDecision.toLowerCase()}.`;
  }else{
    txt=`Lectura Short: busca debilidad bajista, no una compra barata. Tendencia ${a.trend.toLowerCase()}, ADX ${fmt(a.adx,1)} y RSI ${fmt(a.rsi,1)}. `;
    txt+=a.rsi<30?"Ya está sobrevendido; abrir short tarde aumenta el riesgo de rebote. ":a.rsi<50?"El momentum favorece presión bajista. ":"El momentum todavía no confirma caída. ";
    txt+=a.volumeRatio>1?"El volumen confirma mejor. ":"El volumen aún no confirma. ";
    txt+=`Resultado: ${a.shortDecision.toLowerCase()}.`;
  }
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
  const opts=state.assets.map(s=>`<option value="${s}">${s}/USDT</option>`).join("");
  $("#btSymbol").innerHTML=opts;
  if($("#paperSymbol")) $("#paperSymbol").innerHTML=opts;
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


function savePaperState(){localStorage.setItem("quant_paper_trades",JSON.stringify(state.paperTrades))}
function paperLevels(entry,side,stopMode,stopValue,targetMode,targetValue){
  const stop=stopMode==="percent"?(side==="long"?entry*(1-stopValue/100):entry*(1+stopValue/100)):stopValue;
  const target=targetMode==="percent"?(side==="long"?entry*(1+targetValue/100):entry*(1-targetValue/100)):targetValue;
  return {stop,target};
}
async function previewPaper(){
  const sym=$("#paperSymbol").value,side=$("#paperSide").value,int=$("#paperInterval").value;
  try{
    const candles=await getCandles(sym,int,500),a=analyze(candles),entry=+$("#paperEntry").value||a.price;
    if(!$("#paperEntry").value) $("#paperEntry").value=entry;
    const lv=paperLevels(entry,side,$("#paperStopMode").value,+$("#paperStop").value,$("#paperTargetMode").value,+$("#paperTarget").value);
    const score=side==="long"?a.longScore:a.shortScore;
    const riskDist=Math.abs(entry-lv.stop),rewardDist=Math.abs(lv.target-entry),rr=riskDist?rewardDist/riskDist:0;
    const capital=+$("#paperCapital").value||0,riskPct=+$("#paperRiskPct").value||0,riskCash=capital*riskPct/100,qty=riskDist?riskCash/riskDist:0,potential=qty*rewardDist;
    const warning=rr<3?`<div class="trade-warning">⚠️ Relación 1:${fmt(rr,2)}. Tu regla recomienda mínimo 1:3.</div>`:`<div class="trade-ok">✓ Relación 1:${fmt(rr,2)} compatible con tu regla.</div>`;
    $("#paperPreview").innerHTML=`<div class="preview-main">Entrada <strong>${money(entry)}</strong> · Stop <strong>${money(lv.stop)}</strong> · Objetivo <strong>${money(lv.target)}</strong> · Score ${side.toUpperCase()} <strong>${score}/100</strong></div><div class="preview-metrics"><span>Riesgo: <strong>${money(riskCash)}</strong></span><span>Cantidad: <strong>${fmt(qty,8)}</strong></span><span>Ganancia potencial: <strong>${money(potential)}</strong></span></div>${warning}`;
  }catch(e){$("#paperPreview").textContent="No se pudo preparar la prueba. Revisa la conexión."}
}
async function createPaperTrade(){
  const sym=$("#paperSymbol").value,side=$("#paperSide").value,int=$("#paperInterval").value;
  const candles=await getCandles(sym,int,500),a=analyze(candles),entry=+$("#paperEntry").value||a.price;
  const sv=+$("#paperStop").value,tv=+$("#paperTarget").value;
  if(!(entry>0&&sv>0&&tv>0)) return alert("Revisa entrada, stop y objetivo.");
  const lv=paperLevels(entry,side,$("#paperStopMode").value,sv,$("#paperTargetMode").value,tv);
  if(side==="long"&&!(lv.stop<entry&&lv.target>entry)) return alert("En Long, el stop debe quedar debajo y el objetivo arriba de la entrada.");
  if(side==="short"&&!(lv.stop>entry&&lv.target<entry)) return alert("En Short, el stop debe quedar arriba y el objetivo debajo de la entrada.");
  const now=Date.now(),score=side==="long"?a.longScore:a.shortScore;
  const riskDist=Math.abs(entry-lv.stop),rewardDist=Math.abs(lv.target-entry),rr=riskDist?rewardDist/riskDist:0;
  const capital=+$("#paperCapital").value||0,riskPct=+$("#paperRiskPct").value||0,riskCash=capital*riskPct/100,qty=riskDist?riskCash/riskDist:0,potentialProfit=qty*rewardDist;
  if(rr<1) return alert("La ganancia potencial es menor que la pérdida. Ajusta stop u objetivo.");
  state.paperTrades.unshift({id:now,symbol:sym,side,interval:int,entry,stop:lv.stop,target:lv.target,openedAt:now,status:"open",current:entry,score,capital,riskPct,riskCash,qty,potentialProfit,rr,
    snapshot:{longScore:a.longScore,shortScore:a.shortScore,rsi:a.rsi,adx:a.adx,atrPct:a.atrPct,volumeRatio:a.volumeRatio,trend:a.trend,ema20:a.e20.at(-1),ema50:a.e50.at(-1),ema200:a.e200.at(-1)},
    notes:$("#paperNotes").value.trim(),closedAt:null,exit:null,resultPct:null});
  savePaperState();$("#paperNotes").value="";renderPaperTrades();alert("Prueba guardada. La app seguirá su resultado.");
}
async function updatePaperTrades(){
  const open=state.paperTrades.filter(t=>t.status==="open");
  for(const t of open){
    try{
      const raw=await api("/klines",{symbol:t.symbol+"USDT",interval:t.interval,startTime:t.openedAt,limit:1000});
      const candles=raw.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5]}));
      if(!candles.length) continue;
      t.current=candles.at(-1).c;
      for(const c of candles){
        const stopHit=t.side==="long"?c.l<=t.stop:c.h>=t.stop;
        const targetHit=t.side==="long"?c.h>=t.target:c.l<=t.target;
        if(stopHit&&targetHit){t.status="loss";t.exit=t.stop;t.closedAt=c.t;break}
        if(stopHit){t.status="loss";t.exit=t.stop;t.closedAt=c.t;break}
        if(targetHit){t.status="win";t.exit=t.target;t.closedAt=c.t;break}
      }
      if(t.status!=="open") t.resultPct=(t.side==="long"?(t.exit/t.entry-1):(t.entry/t.exit-1))*100;
    }catch(e){console.warn("paper",t.symbol,e)}
  }
  savePaperState();renderPaperTrades();
}
function closePaperManual(id){
  const t=state.paperTrades.find(x=>x.id===id);if(!t)return;
  const value=prompt("Precio de cierre manual",t.current||t.entry);if(value===null)return;
  const exit=+value;if(!(exit>0))return alert("Precio inválido.");
  t.status="manual";t.exit=exit;t.closedAt=Date.now();t.resultPct=(t.side==="long"?(exit/t.entry-1):(t.entry/exit-1))*100;savePaperState();renderPaperTrades();
}
function deletePaper(id){if(confirm("¿Eliminar esta prueba del diario?")){state.paperTrades=state.paperTrades.filter(x=>x.id!==id);savePaperState();renderPaperTrades()}}
function tradeCard(t){
  const status={open:"Abierta",win:"Ganada",loss:"Perdida",manual:"Cierre manual"}[t.status];
  const cls={open:"status-open",win:"status-win",loss:"status-loss",manual:"status-manual"}[t.status];
  const current=t.status==="open"?(t.current||t.entry):t.exit;
  const running=(t.side==="long"?(current/t.entry-1):(t.entry/current-1))*100;
  return `<article class="paper-trade"><div class="paper-head"><div><h3>${t.symbol}/USDT · ${t.side.toUpperCase()}</h3><div class="paper-meta">${t.interval} · ${new Date(t.openedAt).toLocaleString("es-MX")}</div></div><strong class="${cls}">${status}</strong></div>
  <div class="paper-levels"><div class="paper-level"><span>Entrada</span><strong>${money(t.entry)}</strong></div><div class="paper-level"><span>Stop</span><strong>${money(t.stop)}</strong></div><div class="paper-level"><span>Objetivo</span><strong>${money(t.target)}</strong></div><div class="paper-level"><span>${t.status==="open"?"Precio actual":"Salida"}</span><strong>${money(current)}</strong></div><div class="paper-level"><span>Resultado</span><strong class="${running>=0?"status-win":"status-loss"}">${running>=0?"+":""}${fmt(running,2)}%</strong></div><div class="paper-level"><span>R/B inicial</span><strong>1 : ${fmt(t.rr||Math.abs(t.target-t.entry)/Math.abs(t.entry-t.stop),2)}</strong></div><div class="paper-level"><span>Riesgo planeado</span><strong>${money(t.riskCash||0)} (${fmt(t.riskPct||0,1)}%)</strong></div><div class="paper-level"><span>Ganancia potencial</span><strong>${money(t.potentialProfit||0)}</strong></div><div class="paper-level"><span>Score inicial</span><strong>${t.score}/100</strong></div></div>
  <div class="paper-snapshot"><span class="tag">RSI ${fmt(t.snapshot.rsi,1)}</span><span class="tag">ADX ${fmt(t.snapshot.adx,1)}</span><span class="tag">ATR ${fmt(t.snapshot.atrPct,2)}%</span><span class="tag">Vol ${fmt(t.snapshot.volumeRatio,2)}x</span><span class="tag">${t.snapshot.trend}</span></div>
  ${t.notes?`<p class="paper-note">${t.notes.replace(/</g,"&lt;")}</p>`:""}<div class="paper-actions">${t.status==="open"?`<button class="ghost" data-close-paper="${t.id}">Cerrar manual</button>`:"<span></span>"}<button class="danger" data-delete-paper="${t.id}">Eliminar</button></div></article>`;
}
function renderPaperTrades(){
  const openCountEl=$("#paperOpenCount"); if(openCountEl) openCountEl.textContent=state.paperTrades.filter(t=>t.status==="open").length;
  if(!$("#paperOpenList"))return;
  const open=state.paperTrades.filter(t=>t.status==="open"),closed=state.paperTrades.filter(t=>t.status!=="open");
  $("#paperOpenList").innerHTML=open.length?open.map(tradeCard).join(""):'<div class="notice">Todavía no hay operaciones simuladas abiertas.</div>';
  $("#paperClosedList").innerHTML=closed.length?closed.map(tradeCard).join(""):'<div class="notice">El diario todavía no tiene resultados cerrados.</div>';
  const wins=closed.filter(t=>t.status==="win"||t.resultPct>0).length,losses=closed.filter(t=>t.status==="loss"||t.resultPct<0).length,rate=closed.length?wins/closed.length*100:0,avg=closed.length?closed.reduce((s,t)=>s+(t.resultPct||0),0)/closed.length:0;
  const totalPct=closed.reduce((s,t)=>s+(t.resultPct||0),0),avgRR=closed.length?closed.reduce((s,t)=>s+(t.rr||Math.abs(t.target-t.entry)/Math.abs(t.entry-t.stop)||0),0)/closed.length:0;
  $("#paperStats").innerHTML=[["Pruebas cerradas",closed.length],["Ganadoras",wins],["Perdedoras",losses],["Acierto",fmt(rate,1)+"%"],["Resultado acumulado",(totalPct>=0?"+":"")+fmt(totalPct,2)+"%"],["Resultado promedio",(avg>=0?"+":"")+fmt(avg,2)+"%"],["R/B promedio","1 : "+fmt(avgRR,2)]].map(([k,v])=>`<div class="result-card"><span>${k}</span><strong>${v}</strong></div>`).join("");
  renderPaperInsights(closed);
  $$('[data-close-paper]').forEach(b=>b.onclick=()=>closePaperManual(+b.dataset.closePaper));$$('[data-delete-paper]').forEach(b=>b.onclick=()=>deletePaper(+b.dataset.deletePaper));
}


function renderPaperInsights(closed){
  const box=$("#paperInsights");if(!box)return;
  if(closed.length<5){box.innerHTML=`<h3>🧠 Qué está aprendiendo el Centro Quant</h3><p>Necesita al menos 5 operaciones cerradas. Llevas ${closed.length}. Con 20 o más, las conclusiones serán mucho más útiles.</p>`;return}
  const insights=[];
  const groups=[
    ["RSI menor de 45",t=>t.snapshot?.rsi<45],["RSI entre 45 y 55",t=>t.snapshot?.rsi>=45&&t.snapshot?.rsi<=55],["RSI mayor de 55",t=>t.snapshot?.rsi>55],
    ["ADX menor de 20",t=>t.snapshot?.adx<20],["ADX de 20 o más",t=>t.snapshot?.adx>=20],
    ["volumen por encima del promedio",t=>t.snapshot?.volumeRatio>=1],["volumen bajo",t=>t.snapshot?.volumeRatio<1],
    ["score de 70 o más",t=>t.score>=70],["score menor de 70",t=>t.score<70]
  ];
  const ranked=groups.map(([name,test])=>{const a=closed.filter(test);return {name,n:a.length,avg:a.length?a.reduce((s,t)=>s+(t.resultPct||0),0)/a.length:-999,win:a.length?a.filter(t=>(t.resultPct||0)>0).length/a.length*100:0}}).filter(x=>x.n>=3).sort((a,b)=>b.avg-a.avg);
  if(ranked.length){const best=ranked[0],worst=ranked.at(-1);insights.push(`Tus mejores resultados aparecen con <strong>${best.name}</strong>: ${fmt(best.win,0)}% de acierto y ${best.avg>=0?"+":""}${fmt(best.avg,2)}% promedio (${best.n} operaciones).`);if(worst.name!==best.name)insights.push(`La condición más débil hasta ahora es <strong>${worst.name}</strong>: ${fmt(worst.win,0)}% de acierto y ${worst.avg>=0?"+":""}${fmt(worst.avg,2)}% promedio.`)}
  const longs=closed.filter(t=>t.side==="long"),shorts=closed.filter(t=>t.side==="short");
  if(longs.length>=3&&shorts.length>=3){const la=longs.reduce((s,t)=>s+(t.resultPct||0),0)/longs.length,sa=shorts.reduce((s,t)=>s+(t.resultPct||0),0)/shorts.length;insights.push(`${la>=sa?"Long":"Short"} ha sido tu dirección más rentable hasta ahora (${fmt(Math.max(la,sa),2)}% promedio).`)}
  const goodRR=closed.filter(t=>(t.rr||0)>=3),lowRR=closed.filter(t=>(t.rr||0)<3);
  if(goodRR.length>=3&&lowRR.length>=3){const ga=goodRR.reduce((s,t)=>s+(t.resultPct||0),0)/goodRR.length,ba=lowRR.reduce((s,t)=>s+(t.resultPct||0),0)/lowRR.length;insights.push(`Las operaciones con R/B mínimo 1:3 promedian ${ga>=0?"+":""}${fmt(ga,2)}%, frente a ${ba>=0?"+":""}${fmt(ba,2)}% en las menores a 1:3.`)}
  box.innerHTML=`<h3>🧠 Qué está aprendiendo el Centro Quant</h3>${insights.length?`<ul>${insights.map(x=>`<li>${x}</li>`).join("")}</ul>`:`<p>Aún faltan operaciones repetidas bajo condiciones comparables para detectar un patrón confiable.</p>`}<small>Estas observaciones describen tu diario; no garantizan resultados futuros.</small>`;
}

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
$("#analysisModeSelect").onchange=refreshAnalysis;
$("#marketModeSelect").onchange=()=>{renderRanking();refreshAll()};
$("#refreshAllBtn").onclick=refreshAll;
$("#savePaperBtn").onclick=()=>createPaperTrade().catch(e=>alert("No se pudo guardar la prueba: "+e.message));
["paperSymbol","paperSide","paperInterval","paperEntry","paperStopMode","paperStop","paperTargetMode","paperTarget","paperCapital","paperRiskPct"].forEach(id=>$("#"+id)?.addEventListener("change",()=>previewPaper()));
$("#refreshPaperBtn").onclick=updatePaperTrades;
["paperSymbol","paperSide","paperInterval","paperEntry","paperStopMode","paperStop","paperTargetMode","paperTarget"].forEach(id=>$("#"+id)?.addEventListener("change",previewPaper));

renderWeights();fillAssetSelects();renderAssets();renderRanking();renderPaperTrades();refreshAll();updatePaperTrades();
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js?v=61").catch(console.warn);
