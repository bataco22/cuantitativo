
// v6.11.4 · hotfix QRA pendiente/null + QRA-04 + ejecución causal intrabar 1m + radar robusto
(function(){
  if(!("serviceWorker" in navigator)) return;
  let refreshing=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(refreshing) return;
    refreshing=true;
    location.reload();
  });
  window.addEventListener("load", async ()=>{
    try{
      const regs=await navigator.serviceWorker.getRegistrations();
      for(const reg of regs){
        try{ await reg.update(); }catch(e){}
      }
    }catch(e){}
  });
})();


const API_BASE = "https://data-api.binance.vision/api/v3";
const COINGECKO_MARKETS = "https://api.coingecko.com/api/v3/coins/markets";
const STABLE_ASSETS = new Set(["USDT","USDC","FDUSD","TUSD","DAI","USDE","USDS","PYUSD","USD1","BUSD","FRAX","LUSD","GUSD","USDP","EURC","EURI"]);
const DEFAULT_ASSETS = ["BTC","ETH","SOL","LINK","AVAX"];
const DEFAULT_WEIGHTS = {trend:30,momentum:20,strength:15,volume:15,volatility:10,structure:10};
const QRA_LAB_VERSION = "QRA-OOS-1";
const APP_VERSION = "6.11.4";
const RESEARCH_GENERATION = "ARONSON-QRA-2026-08-22-1";
const HYPOTHESIS_FREEZE_VERSION = "ARONSON-HYPOTHESES-2026-08-22-1";
const QRA03_VIRTUAL_VERSION = "QRA03-VIRTUAL-1";
const QRA03_CAPS_VERSION = "QRA03-CAPS-2026-08-23-1";
const QRA03_CAPS = Object.freeze([1,2,3,5,10]);
const MARKET_BENCHMARK_VERSION = "BTC-PRIOR-CLOSE-1";
const QRA04_VERSION = "QRA04-BREADTH-2026-08-24-1";
const QRA04_STORAGE_KEY = "quant_qra04_breadth";
const QRA04_MAX_SNAPSHOTS = 1500;
const HYPOTHESIS_REGISTRY = Object.freeze({
  qra01:"Bloquear SHORT cuando BTC esté ALCISTA según prev-close-3bar-breakout.",
  qra03:"Reducir riesgo marginal cuando aumenta la exposición de la misma dirección; visor virtual, nunca modifica el control.",
  exits:"Control 3R frente a Escalera y Trailing 0.20R/0.25R como comparadores virtuales prospectivos.",
  score:"Evaluar prospectivamente calibración y aporte incremental de los componentes del score.",
  benchmark:"Medir rendimiento de Quant frente a BTC direccional durante la misma ventana, sin usarlo para ejecutar."
});
// Cortes preregistrados y congelados. No dependen de cuándo se actualice/reinstale la PWA.
// 19/8/2026 11:32:53 a.m. MX: laboratorio QRA legado (referencia histórica, NO OOS estricta).
// 22/8/2026 2:54:03 p.m. MX: congelación Aronson/HYPOTHESES; desde aquí empieza OOS estricta.
// 23/8/2026 12:19:08 p.m. MX: experimento prospectivo QRA-03 caps 1/2/3/5/10.
const QRA_LEGACY_STARTED_AT = 1787160773905;
const STRICT_OOS_STARTED_AT = 1787432043024;
const QRA03_CAPS_FROZEN_STARTED_AT = 1787509148837;
const PROSPECTIVE_STARTED_AT = STRICT_OOS_STARTED_AT;
const QRA_LAB_STARTED_AT = QRA_LEGACY_STARTED_AT;
const QRA03_CAPS_STARTED_AT = QRA03_CAPS_FROZEN_STARTED_AT;
// v6.10.7: cohorte prospectiva de salidas 0.20R vs 0.25R. Se fija una sola vez
// en el primer arranque de esta versión y se conserva en respaldos/localStorage.
const TRAILING_AB_STARTED_AT = Number(localStorage.getItem("quant_trailing_ab_started_at")||0) || Date.now();
localStorage.setItem("quant_trailing_ab_started_at",String(TRAILING_AB_STARTED_AT));
localStorage.setItem("quant_aronson_qra_started_at",String(PROSPECTIVE_STARTED_AT));
localStorage.setItem("quant_qra_lab_started_at",String(QRA_LAB_STARTED_AT));
localStorage.setItem("quant_qra03_caps_started_at",String(QRA03_CAPS_STARTED_AT));
const qraRegimeCache=new Map();

const state = {
  assets: JSON.parse(localStorage.getItem("quant_assets") || "null") || DEFAULT_ASSETS,
  weights: JSON.parse(localStorage.getItem("quant_weights") || "null") || DEFAULT_WEIGHTS,
  market: {},
  selected: null,
  analysis: null,
  paperTrades: JSON.parse(localStorage.getItem("quant_paper_trades") || "[]"),
  pendingPaperSignal: null,
  homeInterval: localStorage.getItem("quant_home_timeframe") || "1d",
  autoPaper: JSON.parse(localStorage.getItem("quant_auto_paper") || "null") || {enabled:false,interval:"4h",threshold:85,stopPct:3,targetPct:9,riskPct:1,capital:20000,lastSignals:{},universe:"top100",minQuoteVolume:5000000},
  scannerResults: []
};

// Compatibilidad de cohorte: v6.10.0 compactó correctamente las cerradas, pero
// su esquema compacto omitía qraLab.version/sampleStartedAt. Eso hacía que la UI
// de v6.10.1 dejara de contar cerradas antiguas aunque los datos QRA siguieran ahí.
function isQraLabTrade(t){
  const q=t?.qraLab;
  if(!q || typeof q!=="object") return false;
  if(q.version===QRA_LAB_VERSION) return true;
  const opened=Number(t?.openedAt||0);
  return opened>=QRA_LAB_STARTED_AT && (Object.prototype.hasOwnProperty.call(q,"qra01Accepted") || q.btcRegime!=null || Object.prototype.hasOwnProperty.call(q,"soloLongAccepted"));
}
function isStrictOosTrade(t){
  const opened=Number(t?.openedAt||0);
  if(opened<STRICT_OOS_STARTED_AT) return false;
  const rm=t?.researchMeta||{}, q=t?.qraLab||{};
  return rm.openedAfterHypothesisFreeze===true ||
    rm.researchGeneration===RESEARCH_GENERATION ||
    rm.hypothesisFreezeVersion===HYPOTHESIS_FREEZE_VERSION ||
    q.hypothesisFreezeVersion===HYPOTHESIS_FREEZE_VERSION;
}
function isLegacyHistoricalQraTrade(t){
  return isQraLabTrade(t) && Number(t?.openedAt||0)>=QRA_LEGACY_STARTED_AT && !isStrictOosTrade(t);
}
function repairQraLabContinuity(){
  let repaired=0;
  for(const t of state.paperTrades){
    if(!isQraLabTrade(t)) continue;
    const q=t.qraLab;
    if(q.version!==QRA_LAB_VERSION){q.version=QRA_LAB_VERSION;repaired++;}
    if(!Number(q.sampleStartedAt)) q.sampleStartedAt=QRA_LAB_STARTED_AT;
    if(!q.hypothesisFreezeVersion) q.hypothesisFreezeVersion=t.researchMeta?.hypothesisFreezeVersion||HYPOTHESIS_FREEZE_VERSION;
  }
  if(repaired){
    try{
      savePaperState();
      localStorage.setItem("quant_qra_continuity_repair",JSON.stringify({version:APP_VERSION,at:Date.now(),repaired,qraLabStartedAt:QRA_LAB_STARTED_AT,qra03CapsStartedAt:QRA03_CAPS_STARTED_AT}));
    }catch(e){console.warn("No se pudo persistir toda la reparación QRA; la vista seguirá usando compatibilidad en memoria.",e);}
  }
  return repaired;
}

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = (n,d=2) => Number(n).toLocaleString("es-MX",{maximumFractionDigits:d,minimumFractionDigits:n<1?Math.min(d,4):0});
const money = n => "$" + Number(n).toLocaleString("en-US",{maximumFractionDigits:n<1?6:2});
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

function showView(id){
  $$(".view").forEach(v=>v.classList.toggle("active",v.id===id));
  $$(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
  window.scrollTo({top:0,behavior:"smooth"});
  if(id==="homeView") renderHome();
  if(id==="backtestView") fillAssetSelects();
  if(id==="paperView"){ fillAssetSelects(); renderPaperTrades(); }
}
$$(".bottom-nav button").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));

async function api(path, params={}){
  const url = new URL(API_BASE + path);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),20000);
    try{
      const r = await fetch(url,{signal:controller.signal,cache:"no-store"});
      if(!r.ok){
        const err=new Error("API "+r.status); err.status=r.status; throw err;
      }
      return await r.json();
    }catch(e){
      lastError=e;
      const retryable=e?.name==="AbortError" || !e?.status || e.status===429 || e.status>=500;
      if(!retryable || attempt===2) throw e;
      await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
    }finally{ clearTimeout(timeout); }
  }
  throw lastError||new Error("API sin respuesta");
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
  const decision=s=>s>=85?"Favorable":s>=70?"Esperar / Vigilar":"Evitar";
  const ret5=i>=5?(signalPrice/closes[i-5]-1)*100:null, ret20=i>=20?(signalPrice/closes[i-20]-1)*100:null;
  return {longScore,shortScore,longDecision:decision(longScore),shortDecision:decision(shortScore),
    trend:signalPrice>e20[i]&&e20[i]>e50[i]?"Alcista":signalPrice<e20[i]&&e20[i]<e50[i]?"Bajista":"Mixta",
    rsi:rs[i],adx:ax[i],atrPct,volumeRatio:v20[i]?vols[i]/v20[i]:1,
    signalPrice,signalEma20:e20[i],signalEma50:e50[i],signalEma200:e200[i],ret5,ret20,
    support:Math.min(...closedCandles.slice(-20).map(x=>x.l)),resistance:Math.max(...closedCandles.slice(-20).map(x=>x.h)),
    price,change:(price/signalPrice-1)*100,e20,e50,e200,longFactors,shortFactors};
}
async function getCandles(symbol,interval="1d",limit=500){
  const raw=await api("/klines",{symbol:symbol+"USDT",interval,limit});
  return raw.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],ct:+x[6]}));
}
async function getTicker(symbol){
  return api("/ticker/24hr",{symbol:symbol+"USDT"});
}

async function fetchJsonWithRetry(url,attempts=3){
  let lastError=null;
  for(let attempt=0;attempt<attempts;attempt++){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const r=await fetch(url,{signal:controller.signal,cache:"no-store"});
      if(!r.ok){const e=new Error("HTTP "+r.status);e.status=r.status;throw e;}
      return await r.json();
    }catch(e){
      lastError=e;
      if(attempt===attempts-1) throw e;
      await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
    }finally{clearTimeout(timeout)}
  }
  throw lastError||new Error("Sin respuesta");
}
async function getScannerUniverse(){
  // Universo: Top 100 por capitalización. CoinGecko se usa porque ofrece este ranking
  // sin clave en navegador; después Binance valida que el par USDT sea operable.
  let ranked=[];
  try{
    const u=new URL(COINGECKO_MARKETS);u.searchParams.set("vs_currency","usd");u.searchParams.set("order","market_cap_desc");u.searchParams.set("per_page","100");u.searchParams.set("page","1");u.searchParams.set("sparkline","false");
    ranked=(await fetchJsonWithRetry(u)).map(x=>String(x.symbol||"").toUpperCase()).filter(Boolean);
  }catch(e){console.warn("ranking market cap",e)}
  const [exchange,tickers]=await Promise.all([api("/exchangeInfo"),api("/ticker/24hr")]);
  const tradable=new Set(exchange.symbols.filter(x=>x.status==="TRADING"&&x.quoteAsset==="USDT"&&x.isSpotTradingAllowed!==false).map(x=>x.baseAsset));
  const volume=new Map(tickers.filter(x=>x.symbol.endsWith("USDT")).map(x=>[x.symbol.slice(0,-4),+x.quoteVolume||0]));
  if(!ranked.length) ranked=[...tradable].sort((a,b)=>(volume.get(b)||0)-(volume.get(a)||0)).slice(0,100);
  const minVol=Number(state.autoPaper.minQuoteVolume||5000000);
  return [...new Set(ranked)].filter(x=>!STABLE_ASSETS.has(x)&&tradable.has(x)&&(volume.get(x)||0)>=minVol);
}
async function mapWithConcurrency(items,limit,worker){
  const out=[];let next=0;
  async function run(){while(next<items.length){const i=next++;try{out[i]=await worker(items[i],i)}catch(e){out[i]=null}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return out;
}

const SCANNER_SYMBOL_TIMEOUT_MS=12000;
let autoPaperScanInFlight=false;
async function getScannerCandles(symbol,interval="1d",limit=500){
  const url=new URL(API_BASE+"/klines");
  Object.entries({symbol:symbol+"USDT",interval,limit}).forEach(([k,v])=>url.searchParams.set(k,v));
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),SCANNER_SYMBOL_TIMEOUT_MS);
  try{
    const r=await fetch(url,{signal:controller.signal,cache:"no-store"});
    if(!r.ok){const e=new Error("API "+r.status);e.status=r.status;throw e;}
    const raw=await r.json();
    return raw.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],ct:+x[6]}));
  }finally{clearTimeout(timeout)}
}

// Señal principal: 1D define contexto/tendencia y 4H afina la entrada.
// Peso: 40% diario + 60% 4H. Si ambos marcos discrepan en el sesgo,
// el score combinado recibe una penalización para evitar falsas certezas.
function combineTimeframes(daily,entry4h,side){
  const dScore=activeScore(daily,side), hScore=activeScore(entry4h,side);
  const opposite=side==="long"?"short":"long";
  const dailyAligned=dScore>=activeScore(daily,opposite);
  const h4Aligned=hScore>=activeScore(entry4h,opposite);
  let score=Math.round(dScore*.40+hScore*.60);
  if(!dailyAligned) score-=12;
  if(!h4Aligned) score-=8;
  score=clamp(score,0,100);
  return {score,dailyScore:dScore,entryScore:hScore,dailyAligned,h4Aligned};
}
function combinedSideData(marketRow,side){
  if(!marketRow?.daily||!marketRow?.entry4h) return null;
  return combineTimeframes(marketRow.daily,marketRow.entry4h,side);
}

function scoreClass(score){return score>=85?"good":score>=70?"warn":"bad"}
const HOME_TF_LABELS={"15m":"15M","1h":"1H","4h":"4H","1d":"1D","1w":"1W"};
function homeTfLabel(interval){return HOME_TF_LABELS[interval]||String(interval).toUpperCase()}
function homeTfData(marketRow){
  if(!marketRow)return null;
  const tf=state.homeInterval||"1d";
  return marketRow.timeframes?.[tf] || (tf==="1d"?marketRow.daily:tf==="4h"?marketRow.entry4h:null);
}
function homeBestOpportunity(){
  const rows=[];
  state.assets.forEach(symbol=>{
    const row=state.market[symbol], d=homeTfData(row); if(!row||!d)return;
    ["long","short"].forEach(side=>rows.push({symbol,side,score:activeScore(d,side),d,price:row.price,change:row.change}));
  });
  return rows.sort((a,b)=>b.score-a.score)[0]||null;
}
function homeReasonRows(best){
  if(!best)return [{tone:"neutral",icon:"•",text:"Esperando indicadores del mercado."}];
  const tf=homeTfLabel(state.homeInterval), sideName=best.side==="long"?"LONG":"SHORT";
  const details=scoreBreakdownData(best.d,best.side).sort((a,b)=>b.points-a.points).slice(0,4);
  return [
    {tone:scoreClass(best.score),icon:best.score>=70?"✓":"!",text:`Score ${tf} ${sideName}: ${best.score}/100.`},
    ...details.map(r=>({tone:r.tone,icon:r.tone==="good"?"✓":r.tone==="bad"?"×":"!",text:`${tf} · ${r.label}: aporta ${r.points.toFixed(1)} de ${r.weight} puntos.`}))
  ];
}
function renderHome(){
  const tf=state.homeInterval||"1d", tfLabel=homeTfLabel(tf);
  const selector=$("#homeTimeframeSelect");
  if(selector && selector.value!==tf) selector.value=tf;
  if($("#homeScoreLabel")) $("#homeScoreLabel").textContent=`Score ${tfLabel}`;
  const best=homeBestOpportunity();
  const data=Object.values(state.market).map(homeTfData).filter(Boolean);
  const analyzed=data.length;
  const maxScore=d=>Math.max(d.longScore||0,d.shortScore||0);
  const favorable=data.filter(d=>maxScore(d)>=85).length;
  const neutral=data.filter(d=>{const x=maxScore(d);return x>=70&&x<85}).length;
  const avoid=data.filter(d=>maxScore(d)<70).length;
  if($("#homeAnalyzed")){ $("#homeAnalyzed").textContent=analyzed; $("#homeFavorable").textContent=favorable; $("#homeNeutral").textContent=neutral; $("#homeAvoid").textContent=avoid; }
  if(!best){
    $("#homePair").textContent=`Analizando favoritos · ${tfLabel}…`; $("#homeScore").textContent="--"; $("#homeScore").parentElement.style.setProperty("--home-score",0);
    $("#homeReasons").innerHTML='<div class="reason-row neutral"><span>•</span><p>Cargando esta temporalidad.</p></div>';
    return;
  }
  const {symbol,side,score,d}=best, sideName=side==="long"?"LONG":"SHORT";
  const tone=scoreClass(score), confidence=score>=85?"Alta":score>=70?"Media":"Baja";
  const risk=d.atrPct<=3?"Bajo":d.atrPct<=6?"Medio":"Alto";
  const decision=score>=85?"FAVORABLE PARA EVALUAR":score>=70?"ESPERAR / VIGILAR":"EVITAR POR AHORA";
  const headline=score>=85?`${symbol} tiene una lectura de nivel alto en ${tfLabel}`:score>=70?`${symbol} merece vigilancia en ${tfLabel}, pero aún falta confirmación`:`No hay una entrada disciplinada en ${tfLabel} todavía`;
  $("#homePair").textContent=`${symbol}/USDT · ${sideName} · ${tfLabel}`; $("#homeScore").textContent=score; $("#homeScore").parentElement.style.setProperty("--home-score",score);
  $("#homeSide").textContent=`Sesgo ${sideName}`; $("#homeDecision").textContent=decision; $("#homeDecision").className=`home-decision ${tone}`;
  $("#homeHeadline").textContent=headline; $("#homeSummary").textContent=`Score ${tfLabel} ${score}/100 · Precio ${money(best.price)} · cambio 24h ${best.change>=0?"+":""}${fmt(best.change)}%.`;
  $("#homeConfidence").textContent=confidence; $("#homeRisk").textContent=risk; $("#homeUpdated").textContent=new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
  $("#homeReasons").innerHTML=homeReasonRows(best).map(r=>`<div class="reason-row ${r.tone}"><span>${r.icon}</span><p>${r.text}</p></div>`).join("");
  $("#homeAnalyzeBtn").disabled=false; $("#homeAnalyzeBtn").dataset.symbol=symbol;
  $("#homePaperBtn").dataset.symbol=symbol;
  state.pendingPaperSignal={symbol,side,interval:tf,score,scoreType:"timeframe",snapshot:buildResearchSnapshot(d,side),createdAt:Date.now()};
}
function buildResearchSnapshot(a,side){
  const factors=side==="short"?a?.shortFactors:a?.longFactors;
  const factorScores={};
  if(factors){
    for(const [k,v] of Object.entries(factors)) factorScores[k]=+((Number(v)||0)*(Number(state.weights[k])||0)).toFixed(4);
  }
  return {
    longScore:a?.longScore??null,shortScore:a?.shortScore??null,rsi:a?.rsi??null,adx:a?.adx??null,atrPct:a?.atrPct??null,volumeRatio:a?.volumeRatio??null,trend:a?.trend??null,
    ema20:a?.e20?.at?.(-2)??null,ema50:a?.e50?.at?.(-2)??null,ema200:a?.e200?.at?.(-2)??null,
    selectedSide:side,selectedFactors:factors?{...factors}:null,factorScores,weights:{...state.weights},scoreAlgorithmVersion:APP_VERSION
  };
}
function buildResearchMeta(){
  return {strategyVersion:APP_VERSION,researchGeneration:RESEARCH_GENERATION,prospectiveStartedAt:PROSPECTIVE_STARTED_AT,openedAfterHypothesisFreeze:true,hypothesisFreezeVersion:HYPOTHESIS_FREEZE_VERSION,hypotheses:Object.keys(HYPOTHESIS_REGISTRY),trailingABStartedAt:TRAILING_AB_STARTED_AT};
}

async function refreshHomeTimeframe(interval){
  state.homeInterval=interval;
  localStorage.setItem("quant_home_timeframe",interval);
  renderHome();
  const missing=state.assets.filter(sym=>!state.market[sym]?.timeframes?.[interval]);
  if(!missing.length){renderHome();return;}
  const selector=$("#homeTimeframeSelect"); if(selector) selector.disabled=true;
  await Promise.all(missing.map(async sym=>{
    try{
      const candles=await getCandles(sym,interval,interval==="1w"?260:500);
      const a=analyze(candles);
      const row=state.market[sym]||(state.market[sym]={timeframes:{}});
      row.timeframes=row.timeframes||{}; row.timeframes[interval]=a;
      if(interval==="1d") row.daily=a; if(interval==="4h") row.entry4h=a;
      renderHome();
    }catch(e){console.warn("Home timeframe",sym,interval,e)}
  }));
  if(selector) selector.disabled=false;
  renderHome();
}
function activeScore(d,mode){return mode==="short"?d.shortScore:d.longScore}

function scoreAtIndex(c,i,pre=null){
  if(i<210)return null;
  const closes=pre?.closes||c.map(x=>x.c),vols=pre?.vols||c.map(x=>x.v);
  const e20=pre?.e20||ema(closes,20),e50=pre?.e50||ema(closes,50),e200=pre?.e200||ema(closes,200),rs=pre?.rs||rsi(closes),at=pre?.at||atr(c),ax=pre?.ax||adx(c),v20=pre?.v20||sma(vols,20);
  const price=closes[i],atrPct=(at[i]||0)/(price||1)*100;
  const look=c.slice(Math.max(0,i-11),i+1),highs=look.map(x=>x.h),lows=look.map(x=>x.l);
  const prevHigh=highs.length>1?Math.max(...highs.slice(0,-1)):highs[0],prevLow=lows.length>1?Math.min(...lows.slice(0,-1)):lows[0];
  const longFactors={trend:(price>e20[i]?.35:0)+(e20[i]>e50[i]?.35:0)+(e50[i]>e200[i]?.30:0),momentum:rs[i]>=50&&rs[i]<=68?1:rs[i]>=45&&rs[i]<75?.65:rs[i]<35?.45:.2,strength:ax[i]>=25?1:ax[i]>=18?.65:.3,volume:v20[i]&&vols[i]>v20[i]?1:.45,volatility:atrPct>=1&&atrPct<=6?1:atrPct<9?.6:.25,structure:(c[i].h>prevHigh?.55:0)+(c[i].l>prevLow?.45:0)};
  const shortFactors={trend:(price<e20[i]?.35:0)+(e20[i]<e50[i]?.35:0)+(e50[i]<e200[i]?.30:0),momentum:rs[i]>=32&&rs[i]<=50?1:rs[i]>25&&rs[i]<55?.65:rs[i]>70?.45:.2,strength:ax[i]>=25?1:ax[i]>=18?.65:.3,volume:v20[i]&&vols[i]>v20[i]?1:.45,volatility:atrPct>=1&&atrPct<=6?1:atrPct<9?.6:.25,structure:(c[i].l<prevLow?.55:0)+(c[i].h<prevHigh?.45:0)};
  const calc=f=>Math.round(Object.entries(f).reduce((sum,[k,v])=>sum+v*(state.weights[k]||0),0));
  return {longScore:calc(longFactors),shortScore:calc(shortFactors),rsi:rs[i],adx:ax[i],atrPct,volumeRatio:v20[i]?vols[i]/v20[i]:1,trend:price>e20[i]&&e20[i]>e50[i]?"Alcista":price<e20[i]&&e20[i]<e50[i]?"Bajista":"Mixta",ema20:e20[i],ema50:e50[i],ema200:e200[i]};
}
function saveAutoPaper(){localStorage.setItem("quant_auto_paper",JSON.stringify(state.autoPaper))}
function syncAutoPaperControls(){
  const a=state.autoPaper;
  if($("#autoPaperEnabled")) $("#autoPaperEnabled").checked=!!a.enabled;
  if($("#autoPaperInterval")) $("#autoPaperInterval").value=a.interval;
  if($("#autoPaperThreshold")) $("#autoPaperThreshold").value=a.threshold;
  if($("#autoPaperStop")) $("#autoPaperStop").value=a.stopPct;
  if($("#autoPaperTarget")) $("#autoPaperTarget").value=a.targetPct;
  if($("#autoPaperRisk")) $("#autoPaperRisk").value=a.riskPct;
  if($("#autoPaperCapital")) $("#autoPaperCapital").value=a.capital;
  if($("#autoPaperStatus")) $("#autoPaperStatus").textContent=a.enabled?`Activo · ${a.interval} · score ≥ ${a.threshold}`:"Apagado";
}
function readAutoPaperControls(){
  state.autoPaper={...state.autoPaper,
    enabled:!!$("#autoPaperEnabled")?.checked,
    interval:$("#autoPaperInterval")?.value||"4h",
    threshold:+$("#autoPaperThreshold")?.value||85,
    stopPct:+$("#autoPaperStop")?.value||3,
    targetPct:+$("#autoPaperTarget")?.value||9,
    riskPct:+$("#autoPaperRisk")?.value||1,
    capital:+$("#autoPaperCapital")?.value||20000,
    universe:"top100", minQuoteVolume:5000000,
    lastSignals:state.autoPaper.lastSignals||{}
  };saveAutoPaper();syncAutoPaperControls();
}

async function getQraBtcRegime(atTime=Date.now()){
  const dayKey=Math.floor(Number(atTime)/86400000);
  if(qraRegimeCache.has(dayKey)) return qraRegimeCache.get(dayKey);
  let out={state:"DESCONOCIDO",close:null,asOf:null,rule:"prev-close-3bar-breakout"};
  try{
    const raw=await api("/klines",{symbol:"BTCUSDT",interval:"1d",endTime:Math.max(0,Number(atTime)-1),limit:8});
    const closed=raw.map(x=>({t:+x[0],c:+x[4],ct:+x[6]})).filter(x=>x.ct<Number(atTime));
    if(closed.length>=4){
      const last=closed.at(-1), prev=closed.slice(-4,-1).map(x=>x.c);
      const stateBtc=last.c>Math.max(...prev)?"ALCISTA":last.c<Math.min(...prev)?"BAJISTA":"TRANSICIÓN";
      out={state:stateBtc,close:last.c,asOf:last.ct,rule:"prev-close-3bar-breakout"};
    }
  }catch(e){ console.warn("QRA BTC regime",e); }
  qraRegimeCache.set(dayKey,out);
  return out;
}
function qraExposureSnapshot(side,openedAt){
  const peers=state.paperTrades.filter(t=>t.status==="open"&&!t.pendingActivation&&t.side===side&&Number(t.openedAt)<=Number(openedAt));
  return {sameDirectionOpen:peers.length,sameDirectionRiskCash:peers.reduce((s,t)=>s+Number(t.riskCash||0),0)};
}
function qra03VirtualDecision(exposure,riskCash,capital){
  const cap=Math.max(1,Number(capital)||1),existing=Number(exposure?.sameDirectionRiskCash||0),existingPct=existing/cap*100;
  let multiplier=1;
  if(existingPct>=30) multiplier=0;
  else if(existingPct>=20) multiplier=.25;
  else if(existingPct>=10) multiplier=.5;
  const virtualRiskCash=Number(riskCash||0)*multiplier;
  return {version:QRA03_VIRTUAL_VERSION,mode:"research-only",policy:"<10%=1.00x; 10-<20%=0.50x; 20-<30%=0.25x; >=30%=0x",existingSameDirectionRiskPct:+existingPct.toFixed(4),multiplier,controlRiskCash:Number(riskCash||0),virtualRiskCash:+virtualRiskCash.toFixed(6),accepted:multiplier>0,reason:multiplier===0?"Bloqueo virtual por concentración >=30%":"Tamaño virtual según concentración"};
}
async function getBtcBenchmarkReference(atTime,interval){
  try{
    const raw=await api("/klines",{symbol:"BTCUSDT",interval:interval||"1h",endTime:Math.max(0,Number(atTime)-1),limit:2});
    if(!raw.length) return {price:null,asOf:null};
    const last=raw.at(-1); return {price:+last[4],asOf:+last[6]};
  }catch(e){ console.warn("BTC benchmark",e); return {price:null,asOf:null}; }
}
async function buildQraLabSnapshot(side,openedAt,interval,riskCash,capital){
  const [regime,btcRef]=await Promise.all([getQraBtcRegime(openedAt),getBtcBenchmarkReference(openedAt,interval)]);
  const blocked=side==="short"&&regime.state==="ALCISTA",exposure=qraExposureSnapshot(side,openedAt);
  const qra03Virtual=qra03VirtualDecision(exposure,riskCash,capital);
  const marketBenchmark={version:MARKET_BENCHMARK_VERSION,asset:"BTC",side,interval:interval||null,entryPrice:btcRef.price,entryAsOf:btcRef.asOf,exitPrice:null,exitAsOf:null,directionalReturnPct:null,benchmarkR:null,excessR:null,status:btcRef.price?"tracking":"missing-entry"};
  return {version:QRA_LAB_VERSION,evaluatedAt:Date.now(),sampleStartedAt:STRICT_OOS_STARTED_AT,hypothesisFreezeVersion:HYPOTHESIS_FREEZE_VERSION,btcRegime:regime.state,btcClose:regime.close,btcAsOf:regime.asOf,rule:regime.rule,qra01Accepted:!blocked,qra01Reason:blocked?"SHORT bloqueado: BTC ALCISTA":"Aceptada por QRA-01",soloLongAccepted:side==="long",soloLongReason:side==="long"?"Aceptada: LONG":"Rechazada: estrategia Solo LONG",qra03Observation:exposure,qra03Virtual,qra03CapsStudy:{version:QRA03_CAPS_VERSION,startedAt:QRA03_CAPS_STARTED_AT,caps:[...QRA03_CAPS],priority:"score-desc,symbol-asc",sameDirectionOnly:true,mode:"research-only"},marketBenchmark};
}
async function finalizeMarketBenchmark(t){
  const b=t?.qraLab?.marketBenchmark;if(!b||b.status==="complete"||!t.closedAt)return;
  const ref=await getBtcBenchmarkReference(Number(t.closedAt)+intervalMs(t.interval),t.interval);
  if(!(b.entryPrice>0&&ref.price>0)){b.status="missing-exit";return;}
  b.exitPrice=ref.price;b.exitAsOf=ref.asOf;
  const raw=(ref.price/b.entryPrice-1)*100;
  b.directionalReturnPct=+(t.side==="long"?raw:-raw).toFixed(6);
  const stopPct=Math.abs(Number(t.entry)-Number(t.stop))/Math.max(1e-12,Number(t.entry))*100;
  b.benchmarkR=stopPct>0?+(b.directionalReturnPct/stopPct).toFixed(6):null;
  const actual=qraActualR(t);b.excessR=actual!=null&&b.benchmarkR!=null?+(actual-b.benchmarkR).toFixed(6):null;b.status="complete";
}
function qra03VirtualR(t){const actual=qraActualR(t),m=Number(t.qraLab?.qra03Virtual?.multiplier);return actual==null||!Number.isFinite(m)?null:actual*m;}
function qra03CapStudy(cap){
  const pool=state.paperTrades.filter(t=>isQraLabTrade(t)&&Number(t.openedAt||0)>=QRA03_CAPS_STARTED_AT).sort((a,b)=>(Number(a.openedAt||0)-Number(b.openedAt||0))||(Number(b.score||0)-Number(a.score||0))||String(a.symbol||"").localeCompare(String(b.symbol||"")));
  const active=[],accepted=[],rejected=[];
  for(const t of pool){
    const ts=Number(t.openedAt||0);
    for(let i=active.length-1;i>=0;i--){const c=Number(active[i].closedAt||0);if(c>0&&c<ts)active.splice(i,1);}
    const same=active.filter(x=>x.side===t.side).length;
    if(same<cap){accepted.push(t);active.push(t);}else rejected.push(t);
  }
  const closed=accepted.filter(t=>t.status!=="open"&&t.exit!=null),open=accepted.filter(t=>t.status==="open");
  const total=closed.reduce((s,t)=>s+Number(qraActualR(t)||0),0);
  return {cap,pool,accepted,rejected,closed,open,total,exp:closed.length?total/closed.length:0};
}
function qraActualR(t){ return t.status!=="open"&&t.exit!=null?signedRFromPrice(t,t.exit):null; }
function qraBranchR(t,key){ const b=t.exitComparison?.[key]; return b?.status==="closed"?Number(b.resultR||0):null; }
function qraStatsFor(lab){
  const closed=lab.filter(t=>t.status!=="open"&&t.exit!=null);
  const accepted=closed.filter(t=>t.qraLab?.qra01Accepted);
  const rejected=closed.filter(t=>!t.qraLab?.qra01Accepted);
  const controlR=closed.reduce((s,t)=>s+Number(qraActualR(t)||0),0);
  const qraR=accepted.reduce((s,t)=>s+Number(qraActualR(t)||0),0);
  const soloLong=closed.filter(t=>(t.qraLab?.soloLongAccepted ?? (t.side==="long")));
  const soloLongR=soloLong.reduce((s,t)=>s+Number(qraActualR(t)||0),0);
  const ladder=accepted.map(t=>qraBranchR(t,"ladder")).filter(v=>v!==null);
  const trail020=accepted.filter(t=>Number(t.openedAt||0)>=TRAILING_AB_STARTED_AT).map(t=>qraBranchR(t,"trailing020")).filter(v=>v!==null);
  const trail=accepted.map(t=>qraBranchR(t,"trailing025")).filter(v=>v!==null);
  return {closed,accepted,rejected,controlR,qraR,soloLong,soloLongR,ladder,trail020,trail,ladderR:ladder.reduce((a,b)=>a+b,0),trail020R:trail020.reduce((a,b)=>a+b,0),trailR:trail.reduce((a,b)=>a+b,0),rejectedControlR:rejected.reduce((s,t)=>s+Number(qraActualR(t)||0),0)};
}
function trailingAbStudy(){
  const pool=state.paperTrades.filter(t=>isStrictOosTrade(t)&&Number(t.openedAt||0)>=TRAILING_AB_STARTED_AT);
  const closed=pool.filter(t=>t.status!=="open");
  const r020=pool.map(t=>qraBranchR(t,"trailing020")).filter(v=>v!==null);
  const r025=pool.map(t=>qraBranchR(t,"trailing025")).filter(v=>v!==null);
  const sum=a=>a.reduce((x,y)=>x+Number(y||0),0);
  return {pool,closed,r020,r025,total020:sum(r020),total025:sum(r025)};
}
function renderQraLabStats(){
  const box=$("#qraLabStats"); if(!box) return;
  const all=state.paperTrades.filter(t=>isQraLabTrade(t));
  if(!all.length){box.innerHTML='<div class="notice">Laboratorio QRA listo. La muestra fuera de entrenamiento empezará con las próximas operaciones guardadas.</div>';return;}
  // La frontera OOS es temporal y fija. La reparación de metadatos nunca puede convertir
  // operaciones anteriores al corte en evidencia prospectiva.
  const strict=all.filter(isStrictOosTrade);
  const historical=all.filter(isLegacyHistoricalQraTrade);
  const x=qraStatsFor(strict), h=qraStatsFor(historical), ab=trailingAbStudy();
  const qra03Closed=x.closed.map(t=>qra03VirtualR(t)).filter(v=>v!==null),qra03R=qra03Closed.reduce((a,b)=>a+b,0);
  const benchmarked=x.closed.filter(t=>t.qraLab?.marketBenchmark?.status==="complete"&&Number.isFinite(Number(t.qraLab.marketBenchmark.benchmarkR)));
  const btcBenchR=benchmarked.reduce((s,t)=>s+Number(t.qraLab.marketBenchmark.benchmarkR||0),0),excessR=benchmarked.reduce((s,t)=>s+Number(t.qraLab.marketBenchmark.excessR||0),0);
  const maxPeers=Math.max(0,...strict.map(t=>Number(t.qraLab?.qra03Observation?.sameDirectionOpen||0)+1));
  const cards=[
    ["OOS estricta Aronson · desde 22/8",`${x.closed.length} cerradas · ${strict.filter(t=>t.status==="open").length} abiertas`],
    ["Control CQ · OOS",`${x.controlR>=0?"+":""}${fmt(x.controlR,2)}R`],
    ["QRA-01 · OOS",`${x.qraR>=0?"+":""}${fmt(x.qraR,2)}R`],
    ["Solo LONG · OOS",`${x.soloLongR>=0?"+":""}${fmt(x.soloLongR,2)}R · ${x.soloLong.length} cerradas`],
    ["Trailing 0.20R · A/B OOS",ab.r020.length?`${ab.total020>=0?"+":""}${fmt(ab.total020,2)}R · ${ab.r020.length} cerradas`:`Esperando nuevas operaciones`],
    ["Trailing 0.25R · A/B OOS",ab.r025.length?`${ab.total025>=0?"+":""}${fmt(ab.total025,2)}R · ${ab.r025.length} cerradas`:`Esperando nuevas operaciones`],
    ["A/B trailing desde",new Date(TRAILING_AB_STARTED_AT).toLocaleString("es-MX")],
    ["QRA-01 + Escalera · OOS",x.ladder.length?`${x.ladderR>=0?"+":""}${fmt(x.ladderR,2)}R · ${x.ladder.length} cerradas`:"Esperando"],
    ["QRA-01 + Trailing · OOS",x.trail.length?`${x.trailR>=0?"+":""}${fmt(x.trailR,2)}R · ${x.trail.length} cerradas`:"Esperando"],
    ["Rechazadas QRA-01 · OOS",`${x.rejected.length} · control ${x.rejectedControlR>=0?"+":""}${fmt(x.rejectedControlR,2)}R`],
    ["QRA-03 virtual · OOS",qra03Closed.length?`${qra03R>=0?"+":""}${fmt(qra03R,2)}R · ${qra03Closed.length} cerradas`:"Esperando"],
    ["QRA histórico 19→22 ago",`${h.closed.length} cerradas · ${historical.filter(t=>t.status==="open").length} abiertas · NO OOS`],
    ["Control CQ · histórico",`${h.controlR>=0?"+":""}${fmt(h.controlR,2)}R`],
    ...QRA03_CAPS.map(cap=>{const z=qra03CapStudy(cap);return [`QRA-03 cap ${cap}`,z.closed.length?`${z.total>=0?"+":""}${fmt(z.total,2)}R · ${z.closed.length} cerradas · ${z.open.length} abiertas`:`Esperando nuevas operaciones`]}),
    ["QRA-03 caps desde",new Date(QRA03_CAPS_STARTED_AT).toLocaleString("es-MX")],
    ["Benchmark BTC · OOS",benchmarked.length?`${btcBenchR>=0?"+":""}${fmt(btcBenchR,2)}R · exceso ${excessR>=0?"+":""}${fmt(excessR,2)}R`:"Esperando"],
    ["Máx. señales misma dirección · OOS",maxPeers],
    ["Inicio OOS estricto",new Date(STRICT_OOS_STARTED_AT).toLocaleString("es-MX")]
  ];
  box.innerHTML=cards.map(([k,v])=>`<div class="result-card"><span>${k}</span><strong>${v}</strong></div>`).join("");
  renderQraLabTrades();
}
function renderQraLabTrades(){
  const box=$("#qraLabTrades"); if(!box) return;
  const lab=state.paperTrades.filter(t=>isStrictOosTrade(t)).sort((a,b)=>(b.openedAt||0)-(a.openedAt||0));
  if(!lab.length){ box.innerHTML='<div class="notice">Todavía no hay operaciones nuevas del Laboratorio QRA.</div>'; return; }
  box.innerHTML=lab.map(t=>{
    const q=(t?.qraLab && typeof t.qraLab==="object")?t.qraLab:null;
    const actual=qraActualR(t), ladder=qraBranchR(t,"ladder"), trail020=qraBranchR(t,"trailing020"), trail=qraBranchR(t,"trailing025");
    const status=t.status==="open"?"ABIERTA":(actual!=null?`${actual>=0?"+":""}${fmt(actual,2)}R`:"CERRADA");
    const val=v=>v==null?"En seguimiento":`${v>=0?"+":""}${fmt(v,2)}R`;
    if(!q){
      const qStatus=t?.pendingActivation?"Pendiente de activación":"QRA pendiente";
      return `<div class="result-card qra-trade-card"><span>${new Date(t.openedAt||t.activationAt||Date.now()).toLocaleString("es-MX")} · ${t.interval||""}</span><strong>${t.symbol} · ${(t.side||"").toUpperCase()} · ${status}</strong><div class="qra-trade-lines"><div>CQ Control: <b>${status}</b></div><div>Laboratorio QRA: <b>${qStatus}</b></div><div>Solo LONG / QRA-01 / QRA-03: <b>Se calculan al activar la entrada causal</b></div></div></div>`;
    }
    return `<div class="result-card qra-trade-card"><span>${new Date(t.openedAt).toLocaleString("es-MX")} · ${t.interval||""}</span><strong>${t.symbol} · ${(t.side||"").toUpperCase()} · ${status}</strong><div class="qra-trade-lines"><div>CQ Control: <b>${status}</b></div><div>Solo LONG: <b>${(q.soloLongAccepted ?? t.side==="long")?"ACEPTA":"RECHAZA"}</b></div><div>QRA-01: <b>${q.qra01Accepted?"ACEPTA":"BLOQUEA"}</b> · BTC ${q.btcRegime||"PENDIENTE"}</div><div>QRA + Escalera: <b>${q.qra01Accepted?val(ladder):"NO TOMADA"}</b></div><div>Trailing 0.20R A/B: <b>${Number(t.openedAt||0)>=TRAILING_AB_STARTED_AT?val(trail020):"PRE-CORTE"}</b></div><div>Trailing 0.25R A/B: <b>${Number(t.openedAt||0)>=TRAILING_AB_STARTED_AT?val(trail):"PRE-CORTE"}</b></div><div>QRA + Trailing 0.25R: <b>${q.qra01Accepted?val(trail):"NO TOMADA"}</b></div><div>QRA-03 virtual: <b>${fmt(Number(q.qra03Virtual?.multiplier??1)*100,0)}%</b> del riesgo · ${Number(q.qra03Observation?.sameDirectionOpen||0)+1} misma dirección</div><div>Benchmark BTC: <b>${q.marketBenchmark?.status==="complete"?`${Number(q.marketBenchmark.excessR)>=0?"+":""}${fmt(q.marketBenchmark.excessR,2)}R exceso`:"En seguimiento"}</b></div></div></div>`;
  }).join("");
}

function renderScannerResults(){
  const box=$("#scannerResults"), meta=$("#scannerResultsMeta"); if(!box)return;
  const rows=state.scannerResults||[];
  if(meta)meta.textContent=rows.length?`${rows.length} criptos revisadas · ordenadas por mejor Score`:"Aún no hay un barrido terminado.";
  if(!rows.length){box.innerHTML='<div class="scanner-empty">Activa el radar y toca <strong>Revisar señales ahora</strong> para ver aquí todas las criptos analizadas.</div>';return;}
  box.innerHTML=rows.map((r,i)=>{
    const best=Math.max(r.longScore,r.shortScore),side=r.longScore>=r.shortScore?"LONG":"SHORT";
    const cls=best>=85?"scanner-good":best>=70?"scanner-watch":"scanner-low",status=best>=85?"SEÑAL":best>=70?"VIGILAR":"SIN SEÑAL";
    return `<div class="scanner-row ${cls}"><span class="scanner-rank">${i+1}</span><div class="scanner-coin"><strong>${r.symbol}/USDT</strong><small>${status} · mejor lado ${side}</small></div><div class="scanner-side"><span>Long</span><strong>${r.longScore}</strong></div><div class="scanner-side"><span>Short</span><strong>${r.shortScore}</strong></div><div class="scanner-best"><span>Mejor</span><strong>${best}</strong></div></div>`;
  }).join("");
}

function qra04Median(values){
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;
  const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function qra04Pct(rows,predicate){return rows.length?100*rows.filter(predicate).length/rows.length:null}
function qra04Std(values){
  const a=values.filter(Number.isFinite);if(a.length<2)return null;const m=a.reduce((x,y)=>x+y,0)/a.length;
  return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1));
}
function saveQra04BreadthSnapshot(rows,interval,universeCount){
  // QRA-04 es observación pura: resume TODO el universo apto analizado y nunca interviene en candidatos/entradas.
  if(!Array.isArray(rows)||!rows.length)return null;
  const at=Date.now(), bestLong=rows.filter(r=>r.longScore>=r.shortScore), bestShort=rows.filter(r=>r.shortScore>r.longScore);
  const snap={version:QRA04_VERSION,at,interval,universeCount:Number(universeCount||rows.length),analyzed:rows.length,
    pctAboveEma20:qra04Pct(rows,r=>r.signalPrice>r.ema20),pctAboveEma50:qra04Pct(rows,r=>r.signalPrice>r.ema50),pctAboveEma200:qra04Pct(rows,r=>r.signalPrice>r.ema200),
    pctBullStack:qra04Pct(rows,r=>r.signalPrice>r.ema20&&r.ema20>r.ema50&&r.ema50>r.ema200),pctBearStack:qra04Pct(rows,r=>r.signalPrice<r.ema20&&r.ema20<r.ema50&&r.ema50<r.ema200),
    pctRsi50:qra04Pct(rows,r=>r.rsi>50),pctRsi60:qra04Pct(rows,r=>r.rsi>60),medianRsi:qra04Median(rows.map(r=>r.rsi)),medianAdx:qra04Median(rows.map(r=>r.adx)),pctAdx25:qra04Pct(rows,r=>r.adx>=25),
    medianVolumeRatio:qra04Median(rows.map(r=>r.volumeRatio)),pctVolumeAbove1:qra04Pct(rows,r=>r.volumeRatio>=1),pctBestLong:100*bestLong.length/rows.length,pctBestShort:100*bestShort.length/rows.length,
    signals85:rows.filter(r=>Math.max(r.longScore,r.shortScore)>=85).length,longSignals85:rows.filter(r=>r.longScore>=85&&r.longScore>=r.shortScore).length,shortSignals85:rows.filter(r=>r.shortScore>=85&&r.shortScore>r.longScore).length,
    medianBestScore:qra04Median(rows.map(r=>Math.max(r.longScore,r.shortScore))),medianRet5:qra04Median(rows.map(r=>r.ret5)),medianRet20:qra04Median(rows.map(r=>r.ret20)),ret5Dispersion:qra04Std(rows.map(r=>r.ret5)),ret20Dispersion:qra04Std(rows.map(r=>r.ret20))};
  try{
    const history=JSON.parse(localStorage.getItem(QRA04_STORAGE_KEY)||"[]");history.push(snap);
    if(history.length>QRA04_MAX_SNAPSHOTS)history.splice(0,history.length-QRA04_MAX_SNAPSHOTS);
    localStorage.setItem(QRA04_STORAGE_KEY,JSON.stringify(history));
    localStorage.setItem("quant_qra04_meta",JSON.stringify({version:QRA04_VERSION,mode:"research-only",startedAt:Number(localStorage.getItem("quant_qra04_started_at")||at),snapshots:history.length,lastAt:at}));
    if(!localStorage.getItem("quant_qra04_started_at"))localStorage.setItem("quant_qra04_started_at",String(at));
  }catch(e){console.warn("QRA-04 breadth storage",e)}
  return snap;
}

async function scanAutoPaper(manual=false){
  const status=$("#autoPaperStatus");
  if(autoPaperScanInFlight){
    if(status)status.textContent="Barrido anterior aún en curso · evitando escaneo superpuesto…";
    return;
  }
  autoPaperScanInFlight=true;
  let finalStatus="";
  try{
    readAutoPaperControls(); const a=state.autoPaper;
    if(!a.enabled&&!manual){finalStatus="Apagado";return;}
    if(status)status.textContent="Preparando Top 100 y filtros…";
    let opened=0, universe=[];
    try{universe=await getScannerUniverse()}catch(e){
      console.warn("scanner universe",e);
      finalStatus="No se pudo cargar el universo de mercado";
      return;
    }
    if(status)status.textContent=`Escaneando ${universe.length} criptos aptas del Top 100…`;
    let completed=0,failed=0;
    const scanRows=await mapWithConcurrency(universe,3,async sym=>{
      try{
        const candles=await getScannerCandles(sym,a.interval,a.interval==="1w"?260:500),analysis=analyze(candles),signalIndex=Math.max(1,candles.length-2),signalCandle=candles[signalIndex];
        const row={symbol:sym,longScore:analysis.longScore,shortScore:analysis.shortScore,price:analysis.price,signalPrice:analysis.signalPrice,ema20:analysis.signalEma20,ema50:analysis.signalEma50,ema200:analysis.signalEma200,rsi:analysis.rsi,adx:analysis.adx,volumeRatio:analysis.volumeRatio,atrPct:analysis.atrPct,trend:analysis.trend,ret5:analysis.ret5,ret20:analysis.ret20};
        const candidates=[{side:"long",score:analysis.longScore},{side:"short",score:analysis.shortScore}].filter(x=>x.score>=a.threshold).sort((x,y)=>y.score-x.score);
        if(!candidates.length)return row;
        if(manual&&!a.enabled)return row;
        const pick=candidates[0],key=`${sym}:${a.interval}:${pick.side}`,signalId=signalCandle.t;
        const alreadyOpen=state.paperTrades.some(t=>t.status==="open"&&t.symbol===sym&&t.interval===a.interval&&t.side===pick.side&&t.auto);
        if(alreadyOpen||a.lastSignals[key]===signalId)return row;
        // v6.11.3: una señal descubierta a mitad de vela NO puede retroceder al inicio de esa vela.
        // Se arma la operación para ejecutarse al OPEN del siguiente minuto completo. Así toda la
        // vela usada para stop/target/MFE/MAE ocurre después de que la operación existe.
        const createdAt=Date.now(), openedAt=nextExecutionMinute(createdAt), referenceEntry=Number(analysis.price||signalCandle.c);
        const refLv=paperLevels(referenceEntry,pick.side,"percent",a.stopPct,"percent",a.targetPct),refRiskDist=Math.abs(referenceEntry-refLv.stop),refRewardDist=Math.abs(refLv.target-referenceEntry),rr=refRiskDist?refRewardDist/refRiskDist:0;
        if(rr<3)return row;
        const riskCash=a.capital*a.riskPct/100,qty=refRiskDist?riskCash/refRiskDist:0;
        state.paperTrades.unshift({id:createdAt+Math.floor(Math.random()*1000000),symbol:sym,side:pick.side,interval:a.interval,entry:referenceEntry,stop:refLv.stop,target:refLv.target,openedAt,status:"open",current:referenceEntry,score:pick.score,capital:a.capital,riskPct:a.riskPct,riskCash,qty,potentialProfit:qty*refRewardDist,rr,checklist:{trend:true,signal:true,risk:true,noImpulse:true},scoreType:"auto-score-top100",snapshot:buildResearchSnapshot(analysis,pick.side),researchMeta:buildResearchMeta(),notes:`AUTO TOP 100 · Score ≥ ${a.threshold} · filtro liquidez · ejecución causal al siguiente minuto`,auto:true,entryTimingFixed:true,createdAt,signalCandleAt:+signalCandle.t,signalCandleCloseAt:+(signalCandle.ct||signalCandle.t+intervalMs(a.interval)-1),executionModel:"NEXT_1M_OPEN_CAUSAL_V1",monitorInterval:"1m",pendingActivation:true,activationAt:openedAt,plannedStopPct:a.stopPct,plannedTargetPct:a.targetPct,monitorFrom:openedAt,closedAt:null,exit:null,resultPct:null,mfeR:0,maeR:0,candleLog:[],candleFormat:"t,o,h,l,c,v,ct",rPath:[],rPathFormat:"t,oR,bestR,worstR,cR,newLevels,terminal",rLevelsHit:[],exitComparison:newExitComparison(),qraLab:null});
        a.lastSignals[key]=signalId;opened++; return row;
      }catch(e){
        failed++;
        console.warn("auto paper",sym,e?.name==="AbortError"?"timeout":e);
        return null;
      }finally{
        completed++;
        if(status)status.textContent=`Escaneando ${completed}/${universe.length} · ${failed} sin respuesta${opened?` · ${opened} nueva${opened===1?"":"s"}`:""}…`;
      }
    });
    state.scannerResults=scanRows.filter(Boolean).sort((x,y)=>Math.max(y.longScore,y.shortScore)-Math.max(x.longScore,x.shortScore));
    const qra04Snapshot=saveQra04BreadthSnapshot(state.scannerResults,a.interval,universe.length);
    renderScannerResults();
    saveAutoPaper();savePaperState();renderPaperTrades();
    finalStatus=`${a.enabled?"Activo":"Barrido manual"} · ${completed}/${universe.length} revisadas${failed?` · ${failed} sin respuesta`:""} · ${a.interval} · score ≥ ${a.threshold}${opened?` · ${opened} nueva${opened===1?"":"s"}`:" · sin señales nuevas"}${qra04Snapshot?" · QRA-04 ✓":""}`;
  }catch(e){
    console.warn("scanAutoPaper",e);
    finalStatus="Barrido terminado con error · se reintentará en el siguiente ciclo";
  }finally{
    autoPaperScanInFlight=false;
    if(status&&finalStatus)status.textContent=finalStatus;
  }
}

function activeDecision(d,mode){return mode==="short"?d.shortDecision:d.longDecision}
function scoreBreakdownData(a,mode){
  const factors=mode==="short"?a.shortFactors:a.longFactors;
  const labels={trend:"Tendencia EMA",momentum:"Momentum RSI",strength:"Fuerza ADX",volume:"Volumen",volatility:"Volatilidad ATR",structure:"Estructura"};
  return Object.keys(labels).map(key=>{
    const quality=clamp(Number(factors?.[key]||0),0,1),weight=Number(state.weights[key]||0),points=quality*weight;
    const tone=quality>=.8?"good":quality>=.5?"warn":quality<.3?"bad":"neutral";
    const status=quality>=.8?"Fuerte":quality>=.5?"Parcial":quality<.3?"Débil":"Limitado";
    return {key,label:labels[key],quality,weight,points,tone,status};
  });
}
function trafficDecision(a,mode){
  const score=activeScore(a,mode), rows=scoreBreakdownData(a,mode);
  const bad=rows.filter(r=>r.quality<.3);
  const tone=score>=85&&bad.length===0?"green":score>=70?"yellow":"red";
  const title=tone==="green"?"🟢 OPERACIÓN PARA EVALUAR":tone==="yellow"?"🟡 ESPERAR CONFIRMACIÓN":"🔴 NO OPERAR";
  const message=tone==="green"?"La lectura técnica cumple el nivel alto del sistema. Confirma entrada, stop y R/B antes de ejecutar.":tone==="yellow"?"Hay elementos favorables, pero todavía faltan condiciones para una entrada disciplinada.":"La evidencia técnica es insuficiente. Preservar el capital es la decisión correcta.";
  const strongest=[...rows].sort((x,y)=>y.quality-x.quality).slice(0,2);
  const weakest=[...rows].sort((x,y)=>x.quality-y.quality).slice(0,3);
  const reasons=[...strongest.map(r=>({tone:"good",icon:"✓",text:`${r.label}: ${r.status.toLowerCase()} (${Math.round(r.quality*100)}%).`})),...weakest.filter(r=>!strongest.includes(r)).map(r=>({tone:r.quality<.3?"bad":"warn",icon:r.quality<.3?"×":"!",text:`${r.label}: ${r.status.toLowerCase()} (${Math.round(r.quality*100)}%).`}))];
  const targets={trend:.8,momentum:.8,strength:.8,volume:.8,volatility:.5,structure:.5};
  const needs=[];
  if(score<85) needs.push(`Subir el score de ${score} a 85 o más.`);
  rows.forEach(r=>{const target=targets[r.key]??.8;if(r.quality<target){
    const detail=r.key==="strength"?`Esperar ADX de 25 o más (actual ${fmt(a.adx,1)}).`:r.key==="volume"?`Esperar volumen de al menos 1.0x el promedio (actual ${fmt(a.volumeRatio,2)}x).`:r.key==="momentum"?`Esperar que el RSI entre en una zona más favorable para ${mode==="long"?"Long":"Short"} (actual ${fmt(a.rsi,1)}).`:r.key==="trend"?`Esperar alineación más clara de precio, EMA20, EMA50 y EMA200 para ${mode==="long"?"Long":"Short"}.`:r.key==="structure"?`Esperar una ruptura o estructura de máximos y mínimos más clara.`:`Esperar una volatilidad más operable; ATR actual ${fmt(a.atrPct,2)}%.`;
    needs.push(detail);
  }});
  if(!needs.length) needs.push("La lectura técnica ya está en verde. Solo falta validar entrada, stop y R/B mínimo 1:3 en el simulador.");
  return {score,tone,title,message,reasons:reasons.slice(0,4),needs:[...new Set(needs)].slice(0,6)};
}
function renderTrafficLight(a,mode){
  const card=$("#trafficCard");if(!card)return;
  const t=trafficDecision(a,mode), light=$("#trafficLight");
  $("#trafficTitle").textContent=t.title;$("#trafficMessage").textContent=t.message;
  light.className=`traffic-light ${t.tone}`;light.setAttribute("aria-label",t.title.replace(/[🟢🟡🔴]/g,"").trim());
  $("#trafficReasons").innerHTML=t.reasons.map(r=>`<div class="reason-row ${r.tone}"><span>${r.icon}</span><p>${r.text}</p></div>`).join("");
  $("#trafficNeeds").innerHTML=`<strong>Para llegar a verde:</strong><ul>${t.needs.map(n=>`<li>${n}</li>`).join("")}</ul>`;
}

function scoreQualityLabel(score,rr=0){
  if(score>=90&&rr>=3) return {grade:"A+",label:"Excelente"};
  if(score>=85&&rr>=3) return {grade:"A",label:"Alta calidad"};
  if(score>=70) return {grade:"B",label:"Vigilar"};
  return {grade:"C",label:"Evitar"};
}
function scoreWhySummary(a,mode){
  const rows=scoreBreakdownData(a,mode).sort((x,y)=>y.quality-x.quality);
  const good=rows.filter(r=>r.quality>=.8).slice(0,3).map(r=>`✓ ${r.label}: ${r.status.toLowerCase()}`);
  const weak=[...rows].sort((x,y)=>x.quality-y.quality).filter(r=>r.quality<.8).slice(0,2).map(r=>`${r.quality<.3?"✗":"!"} ${r.label}: ${r.status.toLowerCase()}`);
  return [...good,...weak];
}
function renderScoreBreakdown(a,mode){
  const box=$("#scoreBreakdown");if(!box)return;
  const rows=scoreBreakdownData(a,mode),total=Math.round(rows.reduce((s,r)=>s+r.points,0));
  $("#scoreWeightTotal").textContent=`Pesos: ${rows.reduce((s,r)=>s+r.weight,0)} · Score: ${total}`;
  const why=scoreWhySummary(a,mode);
  box.innerHTML=`<div class="score-why"><strong>¿Por qué este score?</strong>${why.map(x=>`<div>${x}</div>`).join("")}</div>`+rows.map(r=>`<div class="score-factor ${r.tone}"><div class="score-factor-top"><div><strong>${r.label}</strong><small>${r.status} · calidad ${Math.round(r.quality*100)}%</small></div><b>+${r.points.toFixed(1)} / ${r.weight}</b></div><div class="factor-track"><span style="width:${r.quality*100}%"></span></div></div>`).join("");
}
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
      const [t,c1d,c4h]=await Promise.all([getTicker(sym),getCandles(sym,"1d",260),getCandles(sym,"4h",500)]);
      const daily=analyze(c1d),entry4h=analyze(c4h);
      state.market[sym]={daily,entry4h,timeframes:{"1d":daily,"4h":entry4h},price:+t.lastPrice,change:+t.priceChangePercent,
        longScore:daily.longScore,shortScore:daily.shortScore,longDecision:daily.longDecision,shortDecision:daily.shortDecision};
      ok++;
      renderAssets();renderRanking();renderHome();
    }catch(e){console.warn(sym,e)}
  }));
  const mode=$("#marketModeSelect")?.value||"long";
  const scores=Object.values(state.market).map(x=>activeScore(x,mode));
  const avg=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0;
  $("#marketSummary").textContent=ok?`${ok} activos analizados · score ${mode==="long"?"Long":"Short"} medio ${avg}/100`:"No fue posible conectar con datos públicos";
  renderRanking();renderHome();
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
    renderDiagnostic(a);renderTrafficLight(a,mode);renderScoreBreakdown(a,mode);drawPriceChart(candles,a);
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
    const sym=$("#btSymbol").value,int=$("#btInterval").value,mode=$("#btPreset").value;
    const stop=+$("#btStop").value/100,target=+$("#btTarget").value/100,fee=+$("#btFee").value/100,risk=+$("#btRisk").value/100;
    const initial=+$("#btCapital").value,threshold=+$("#btScoreThreshold")?.value||85,direction=$("#btDirection")?.value||"auto";
    const c=await getCandles(sym,int,1000),cl=c.map(x=>x.c);
    const vols=c.map(x=>x.v),ind={closes:cl,vols,e20:ema(cl,20),e50:ema(cl,50),e200:ema(cl,200),rs:rsi(cl),v20:sma(vols,20),at:atr(c),ax:adx(c)};
    let equity=initial,peak=initial,maxDD=0,wins=0,losses=0,trades=[],curve=[initial],inPos=false,entry=0,size=0,entryI=0,side="long",entryScore=0;
    for(let i=210;i<c.length-1;i++){
      if(!inPos){
        let signal=false;
        if(mode==="score"){
          const sc=scoreAtIndex(c,i,ind); if(!sc)continue;
          const options=[];
          if(direction!=="short"&&sc.longScore>=threshold)options.push({side:"long",score:sc.longScore});
          if(direction!=="long"&&sc.shortScore>=threshold)options.push({side:"short",score:sc.shortScore});
          options.sort((a,b)=>b.score-a.score);
          if(options.length){side=options[0].side;entryScore=options[0].score;signal=true;}
        }else{
          signal=entrySignal(mode,i,c,ind);side="long";entryScore=0;
        }
        if(signal){entry=c[i].c;const riskCash=equity*risk;size=riskCash/(entry*stop);inPos=true;entryI=i;}
      }else{
        const stopP=side==="long"?entry*(1-stop):entry*(1+stop),targetP=side==="long"?entry*(1+target):entry*(1-target);let exit=null,reason="";
        const stopHit=side==="long"?c[i].l<=stopP:c[i].h>=stopP,targetHit=side==="long"?c[i].h>=targetP:c[i].l<=targetP;
        if(stopHit){exit=stopP;reason="stop"}else if(targetHit){exit=targetP;reason="target"}else if(i-entryI>=40){exit=c[i].c;reason="time"}
        if(exit){
          const gross=(side==="long"?(exit-entry):(entry-exit))*size,fees=(entry+exit)*size*fee,pnl=gross-fees;
          equity+=pnl;pnl>0?wins++:losses++;trades.push({pnl,reason,side,score:entryScore});curve.push(equity);peak=Math.max(peak,equity);maxDD=Math.max(maxDD,(peak-equity)/peak);inPos=false;
        }
      }
    }
    const n=trades.length,winRate=n?wins/n*100:0,total=(equity/initial-1)*100,avg=n?trades.reduce((sum,t)=>sum+t.pnl,0)/n:0;
    const grossWin=trades.filter(t=>t.pnl>0).reduce((sum,t)=>sum+t.pnl,0),grossLoss=Math.abs(trades.filter(t=>t.pnl<0).reduce((sum,t)=>sum+t.pnl,0)),pf=grossLoss?grossWin/grossLoss:(grossWin>0?99:0);
    const avgScore=n?trades.reduce((sum,t)=>sum+(t.score||0),0)/n:0,longs=trades.filter(t=>t.side==="long").length,shorts=trades.filter(t=>t.side==="short").length;
    const vals=[["Operaciones",n],["Ganadoras",fmt(winRate,1)+"%"],["Resultado",(total>=0?"+":"")+fmt(total,2)+"%"],["Capital final",money(equity)],["Profit factor",fmt(pf,2)],["Drawdown máximo",fmt(maxDD*100,2)+"%"],["Long / Short",`${longs} / ${shorts}`],["Score promedio",mode==="score"?fmt(avgScore,1):"—"]];
    $("#btResults").innerHTML=vals.map(([k,v])=>`<div class="result-card"><span>${k}</span><strong>${v}</strong></div>`).join("");
    $("#btResults").classList.remove("hidden");$("#btEquityWrap").classList.remove("hidden");drawLineChart($("#equityChart"),[{values:curve}]);
    const note=$("#btAutoSummary");if(note)note.innerHTML=n?`<strong>${sym} ${int}</strong> · ${mode==="score"?`motor Score ≥ ${threshold}`:"regla clásica"} · ${n} operaciones simuladas sobre el historial disponible de Binance. ${total>0?"La combinación fue rentable en esta muestra.":"La combinación no fue rentable en esta muestra."}`:`No apareció ninguna entrada con estas reglas en el historial descargado.`;
  }catch(e){alert("No fue posible completar el backtest: "+e.message)}
  btn.classList.remove("loading");btn.textContent="Ejecutar simulaciones automáticas";
}
$("#runBacktestBtn").onclick=runBacktest;

$("#calcPositionBtn").onclick=()=>{
  const capital=+$("#posCapital").value,riskPct=+$("#posRisk").value/100,entry=+$("#posEntry").value,stop=+$("#posStop").value,target=+$("#posTarget").value;
  if(!(capital>0&&riskPct>0&&entry>0&&stop>0&&target>0)||stop>=entry||target<=entry)return alert("Revisa los datos: stop menor que entrada y objetivo mayor que entrada.");
  const riskCash=capital*riskPct,unitRisk=entry-stop,qty=riskCash/unitRisk,position=qty*entry,potential=(target-entry)*qty,rr=(target-entry)/(entry-stop);
  const vals=[["Riesgo máximo",money(riskCash)],["Cantidad de monedas",fmt(qty,8)],["Tamaño de posición",money(position)],["Pérdida en stop",money(riskCash)],["Ganancia potencial",money(potential)],["Riesgo / beneficio","1 : "+fmt(rr,2)]];
  $("#positionResults").innerHTML=vals.map(([k,v])=>`<div class="result-card"><span>${k}</span><strong>${v}</strong></div>`).join("");$("#positionResults").classList.remove("hidden");
};


const OPEN_EVIDENCE_WINDOW=24;
function mergeRPathSummaryRow(t,row){
  if(!Array.isArray(row)) return;
  const prev=t.rPathSummary||{};
  const ts=Number(row[0]),best=Number(row[2]),worst=Number(row[3]),closeR=Number(row[4]);
  const rows=Math.max(Number(prev.rows||0),Number(t.rPathCount||0));
  t.rPathSummary={
    rows,
    firstAt:prev.firstAt??(Number.isFinite(ts)?ts:null),
    lastAt:Number.isFinite(ts)?ts:(prev.lastAt??null),
    maxBestR:Number.isFinite(best)?Math.max(Number.isFinite(Number(prev.maxBestR))?Number(prev.maxBestR):-Infinity,best):(prev.maxBestR??null),
    minWorstR:Number.isFinite(worst)?Math.min(Number.isFinite(Number(prev.minWorstR))?Number(prev.minWorstR):Infinity,worst):(prev.minWorstR??null),
    lastCloseR:Number.isFinite(closeR)?closeR:(prev.lastCloseR??null),
    terminal:row[6]?String(row[6]):(prev.terminal||""),
    maxLevelR:Array.isArray(t.rLevelsHit)&&t.rLevelsHit.length?Math.max(...t.rLevelsHit.map(Number).filter(Number.isFinite)):Number(prev.maxLevelR||0)
  };
}
function compactOpenEvidenceForStorage(windowSize=OPEN_EVIDENCE_WINDOW){
  const n=Math.max(4,Number(windowSize)||OPEN_EVIDENCE_WINDOW);
  for(const t of state.paperTrades){
    if(t.status!=="open" && !hasVirtualOpen(t)) continue;
    if(Array.isArray(t.candleLog) && t.candleLog.length>n){
      const removed=t.candleLog.length-n;
      t.candleLog=t.candleLog.slice(-n);
      t.candleLogDropped=Number(t.candleLogDropped||0)+removed;
      t.candleLogWindowed=true;
    }
    if(Array.isArray(t.rPath) && t.rPath.length>n){
      const old=t.rPath.slice(0,-n);
      for(const row of old) mergeRPathSummaryRow(t,row);
      const removed=t.rPath.length-n;
      t.rPath=t.rPath.slice(-n);
      t.rPathDropped=Number(t.rPathDropped||0)+removed;
      t.rPathWindowed=true;
    }
  }
}
function compactClosedCandleLogsForStorage(){
  // Primera capa: elimina OHLCV bruto de operaciones cerradas. rPath se conserva.
  const closed=state.paperTrades
    .filter(t=>t.status!=="open" && Array.isArray(t.candleLog) && t.candleLog.length)
    .sort((a,b)=>Number(a.closedAt||0)-Number(b.closedAt||0));
  for(const t of closed){
    t.candleLogCount=Number(t.candleLogCount||t.candleLog.length||0);
    t.candleLog=[];
    t.candleLogCompacted=true;
  }
}
function summarizeRPath(t){
  const rows=Array.isArray(t.rPath)?t.rPath:[];
  if(!rows.length) return t.rPathSummary||null;
  let maxBest=-Infinity,minWorst=Infinity,lastCloseR=null,terminal="",firstAt=null,lastAt=null;
  for(const r of rows){
    if(!Array.isArray(r)) continue;
    const ts=Number(r[0]); if(Number.isFinite(ts)){ if(firstAt==null) firstAt=ts; lastAt=ts; }
    const best=Number(r[2]),worst=Number(r[3]),closeR=Number(r[4]);
    if(Number.isFinite(best)) maxBest=Math.max(maxBest,best);
    if(Number.isFinite(worst)) minWorst=Math.min(minWorst,worst);
    if(Number.isFinite(closeR)) lastCloseR=closeR;
    if(r[6]) terminal=String(r[6]);
  }
  return {
    rows:rows.length,firstAt,lastAt,maxBestR:Number.isFinite(maxBest)?maxBest:null,minWorstR:Number.isFinite(minWorst)?minWorst:null,lastCloseR,terminal,
    maxLevelR:Array.isArray(t.rLevelsHit)&&t.rLevelsHit.length?Math.max(...t.rLevelsHit.map(Number).filter(Number.isFinite)):0
  };
}
function compactClosedRPathsForStorage(keepRecentFull=50){
  // Segunda capa de emergencia: conserva completos los rPath de las últimas N cerradas
  // y resume las cerradas más antiguas. NO cambia resultados, entradas ni comparadores.
  const closedWithPath=state.paperTrades
    .filter(t=>t.status!=="open" && Array.isArray(t.rPath) && t.rPath.length)
    .sort((a,b)=>Number(b.closedAt||0)-Number(a.closedAt||0));
  closedWithPath.slice(Math.max(0,keepRecentFull)).forEach(t=>{
    t.rPathSummary=summarizeRPath(t);
    t.rPathCount=Number(t.rPathCount||t.rPath.length||0);
    t.rPath=[];
    t.rPathCompacted=true;
  });
}
function compactClosedTradeRecord(t){
  if(!t || t.status==="open" || t.storageCompactVersion==="6.10.7") return t;
  const rsum=(Array.isArray(t.rPath)&&t.rPath.length?summarizeRPath(t):t.rPathSummary)||null;
  const s=t.snapshot||{},rm=t.researchMeta||{},ec=t.exitComparison||{},q=t.qraLab||{};
  const obs=q.qra03Observation||{},q3=q.qra03Virtual||{},bm=q.marketBenchmark||{};
  const out={
    id:t.id,symbol:t.symbol,side:t.side,interval:t.interval,entry:t.entry,stop:t.stop,target:t.target,
    openedAt:t.openedAt,status:t.status,score:t.score,capital:t.capital,riskPct:t.riskPct,riskCash:t.riskCash,
    qty:t.qty,potentialProfit:t.potentialProfit,closedAt:t.closedAt,exit:t.exit,resultPct:t.resultPct,mfeR:t.mfeR,maeR:t.maeR,
    snapshot:{
      rsi:s.rsi,adx:s.adx,atrPct:s.atrPct,volumeRatio:s.volumeRatio,trend:s.trend,
      factorScores:s.factorScores||null,weights:s.weights||null,scoreAlgorithmVersion:s.scoreAlgorithmVersion||null
    },
    researchMeta:{researchGeneration:rm.researchGeneration||null,hypothesisFreezeVersion:rm.hypothesisFreezeVersion||null,trailingABStartedAt:Number(rm.trailingABStartedAt||TRAILING_AB_STARTED_AT)},
    exitComparison:ec&&Object.keys(ec).length?{
      ladder:ec.ladder?{status:ec.ladder.status,resultR:ec.ladder.resultR,closedAt:ec.ladder.closedAt,maxR:ec.ladder.maxR}:null,
      trailing020:ec.trailing020?{status:ec.trailing020.status,resultR:ec.trailing020.resultR,closedAt:ec.trailing020.closedAt,maxR:ec.trailing020.maxR}:null,
      trailing025:ec.trailing025?{status:ec.trailing025.status,resultR:ec.trailing025.resultR,closedAt:ec.trailing025.closedAt,maxR:ec.trailing025.maxR}:null
    }:null,
    qraLab:q&&Object.keys(q).length?{
      version:q.version||QRA_LAB_VERSION,sampleStartedAt:Number(q.sampleStartedAt||(Number(t.openedAt||0)>=STRICT_OOS_STARTED_AT?STRICT_OOS_STARTED_AT:QRA_LAB_STARTED_AT)),hypothesisFreezeVersion:q.hypothesisFreezeVersion||rm.hypothesisFreezeVersion||HYPOTHESIS_FREEZE_VERSION,
      btcRegime:q.btcRegime||"DESCONOCIDO",qra01Accepted:q.qra01Accepted!==false,soloLongAccepted:q.soloLongAccepted??(t.side==="long"),
      qra03Observation:{sameDirectionOpen:Number(obs.sameDirectionOpen||0),sameDirectionRiskCash:Number(obs.sameDirectionRiskCash||0)},
      qra03Virtual:{version:q3.version||QRA03_VIRTUAL_VERSION,multiplier:q3.multiplier??null,virtualRiskCash:q3.virtualRiskCash??null,accepted:q3.accepted??null},
      qra03CapsStudy:q.qra03CapsStudy?{version:q.qra03CapsStudy.version||QRA03_CAPS_VERSION,startedAt:Number(q.qra03CapsStudy.startedAt||QRA03_CAPS_STARTED_AT),caps:Array.isArray(q.qra03CapsStudy.caps)?q.qra03CapsStudy.caps:[...QRA03_CAPS],priority:q.qra03CapsStudy.priority||"score-desc,symbol-asc",sameDirectionOnly:true,mode:"research-only"}:null,
      marketBenchmark:{version:bm.version||MARKET_BENCHMARK_VERSION,benchmarkR:bm.benchmarkR??null,excessR:bm.excessR??null,status:bm.status||null}
    }:null,
    rPathSummary:rsum?{rows:rsum.rows??null,maxBestR:rsum.maxBestR??null,minWorstR:rsum.minWorstR??null,maxLevelR:rsum.maxLevelR??0}:null,
    rLevelsHit:Array.isArray(t.rLevelsHit)?t.rLevelsHit:[],
    candleLog:[],candleLogCount:Number(t.candleLogCount||(Array.isArray(t.candleLog)?t.candleLog.length:0)||0),candleLogCompacted:true,
    rPath:[],rPathCount:Number(t.rPathCount||(Array.isArray(t.rPath)?t.rPath.length:0)||0),rPathCompacted:true,
    storageCompactVersion:"6.10.7"
  };
  if(t.notes && !/^AUTO TOP 100/i.test(String(t.notes))) out.notes=t.notes;
  if(t.scoreType && t.scoreType!=="auto-score-top100") out.scoreType=t.scoreType;
  return out;
}
function compactClosedTradeRecordsForStorage(keepRecentFull=20){
  const closed=state.paperTrades.filter(t=>t.status!=="open").sort((a,b)=>Number(b.closedAt||0)-Number(a.closedAt||0));
  const keep=new Set(closed.slice(0,Math.max(0,keepRecentFull)).map(t=>t.id));
  state.paperTrades=state.paperTrades.map(t=>t.status!=="open"&&!keep.has(t.id)?compactClosedTradeRecord(t):t);
}
function storagePayload(){ return JSON.stringify(state.paperTrades); }
function setPaperStorage(payload){ localStorage.setItem("quant_paper_trades",payload); return true; }
function isQuotaError(e){ return e?.name==="QuotaExceededError" || /quota|storage/i.test(String(e?.message||e)); }
function savePaperState(){
  compactOpenEvidenceForStorage();
  let payload=storagePayload();
  try{return setPaperStorage(payload)}catch(e){if(!isQuotaError(e))throw e;}

  // Capa 1: OHLC cerrado.
  compactClosedCandleLogsForStorage();payload=storagePayload();
  try{return setPaperStorage(payload)}catch(e){if(!isQuotaError(e))throw e;}

  // Capa 2: rPath de cerradas antiguas.
  compactClosedRPathsForStorage(20);payload=storagePayload();
  try{return setPaperStorage(payload)}catch(e){if(!isQuotaError(e))throw e;}

  // Capa 3: consolidación científica de cerradas antiguas. Mantiene 20 recientes completas.
  compactClosedTradeRecordsForStorage(20);payload=storagePayload();
  try{return setPaperStorage(payload)}catch(e){if(!isQuotaError(e))throw e;}

  // Capa 4 de emergencia: consolida también las cerradas recientes; NUNCA toca abiertas.
  compactClosedTradeRecordsForStorage(0);payload=storagePayload();
  try{return setPaperStorage(payload)}catch(e2){
    console.error("Centro Quant: almacenamiento local lleno incluso después de compactación v6.10.7",e2);
    throw new Error("Almacenamiento local lleno aun después de compactar abiertas y consolidar cerradas. Exporta un respaldo antes de liberar datos del navegador.");
  }
}
function runStorageMaintenance(){
  // iOS/Safari suele limitar localStorage a ~5 MB y almacena strings en una representación
  // costosa. Si el ledger supera este umbral, compacta sólo cerradas antes de llegar a cuota.
  try{
    compactOpenEvidenceForStorage();
    const before=storagePayload().length;
    if(before<1500000) return;
    compactClosedCandleLogsForStorage();
    compactClosedRPathsForStorage(20);
    compactClosedTradeRecordsForStorage(20);
    let payload=storagePayload();
    if(payload.length>1700000){compactClosedTradeRecordsForStorage(0);payload=storagePayload();}
    setPaperStorage(payload);
    localStorage.setItem("quant_storage_maintenance",JSON.stringify({version:APP_VERSION,at:Date.now(),beforeChars:before,afterChars:payload.length,open:state.paperTrades.filter(t=>t.status==="open").length,closed:state.paperTrades.filter(t=>t.status!=="open").length,openEvidenceWindow:OPEN_EVIDENCE_WINDOW}));
  }catch(e){console.warn("Centro Quant: mantenimiento preventivo de almacenamiento no pudo completarse",e);}
}
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
    const pending=state.pendingPaperSignal;
    const usePending=pending&&pending.symbol===sym&&pending.side===side&&pending.interval===int;
    const score=usePending?pending.score:(side==="long"?a.longScore:a.shortScore);
    const riskDist=Math.abs(entry-lv.stop),rewardDist=Math.abs(lv.target-entry),rr=riskDist?rewardDist/riskDist:0;
    const capital=+$("#paperCapital").value||0,riskPct=+$("#paperRiskPct").value||0,riskCash=capital*riskPct/100,qty=riskDist?riskCash/riskDist:0,potential=qty*rewardDist;
    const warning=rr<3?`<div class="trade-warning">⛔ Relación 1:${fmt(rr,2)}. No se puede guardar: tu mínimo es 1:3.</div>`:`<div class="trade-ok">✓ Relación 1:${fmt(rr,2)} cumple tu regla mínima.</div>`;
    const quality=scoreQualityLabel(score,rr);
    $("#paperPreview").innerHTML=`<div class="trade-quality ${score>=85&&rr>=3?"quality-good":score>=70?"quality-warn":"quality-bad"}"><span>CALIDAD</span><strong>${quality.grade}</strong><small>${quality.label}</small></div><div class="preview-main">Entrada <strong>${money(entry)}</strong> · Stop <strong>${money(lv.stop)}</strong> · Objetivo <strong>${money(lv.target)}</strong> · Score ${side.toUpperCase()} <strong>${score}/100</strong></div><div class="preview-metrics"><span>Riesgo: <strong>${money(riskCash)}</strong></span><span>Cantidad: <strong>${fmt(qty,8)}</strong></span><span>Ganancia potencial: <strong>${money(potential)}</strong></span></div>${warning}`;
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
  const now=Date.now(),pending=state.pendingPaperSignal;
  const usePending=pending&&pending.symbol===sym&&pending.side===side&&pending.interval===int;
  const score=usePending?pending.score:(side==="long"?a.longScore:a.shortScore);
  const riskDist=Math.abs(entry-lv.stop),rewardDist=Math.abs(lv.target-entry),rr=riskDist?rewardDist/riskDist:0;
  const capital=+$("#paperCapital").value||0,riskPct=+$("#paperRiskPct").value||0,riskCash=capital*riskPct/100,qty=riskDist?riskCash/riskDist:0,potentialProfit=qty*rewardDist;
  if(rr<3) return alert(`Esta operación tiene R/B 1:${fmt(rr,2)}. Tu regla mínima es 1:3; ajusta el stop o el objetivo antes de guardarla.`);
  const checklist={trend:$("#checkTrend").checked,signal:$("#checkSignal").checked,risk:$("#checkRisk").checked,noImpulse:$("#checkNoImpulse").checked};
  const completed=Object.values(checklist).filter(Boolean).length;
  if(completed<3&&!confirm(`Solo completaste ${completed} de 4 controles. ¿Guardar de todos modos?`)) return;
  const qraLab=await buildQraLabSnapshot(side,now,int,riskCash,capital);
  state.paperTrades.unshift({id:now,symbol:sym,side,interval:int,entry,stop:lv.stop,target:lv.target,openedAt:now,status:"open",current:entry,score,capital,riskPct,riskCash,qty,potentialProfit,rr,checklist,
    scoreType:usePending&&pending.combo?"1D+4H":"timeframe",scoreDaily:usePending&&pending.combo?pending.combo.dailyScore:null,score4h:usePending&&pending.combo?pending.combo.entryScore:null,
    snapshot:usePending?pending.snapshot:buildResearchSnapshot(a,side),researchMeta:buildResearchMeta(),
    notes:$("#paperNotes").value.trim(),closedAt:null,exit:null,resultPct:null,mfeR:0,maeR:0,candleLog:[],candleFormat:"t,o,h,l,c,v,ct",rPath:[],rPathFormat:"t,oR,bestR,worstR,cR,newLevels,terminal",rLevelsHit:[],exitComparison:newExitComparison(),qraLab});
  savePaperState();state.pendingPaperSignal=null;$("#paperNotes").value="";["checkTrend","checkSignal","checkRisk","checkNoImpulse"].forEach(id=>$("#"+id).checked=false);renderPaperTrades();alert("Prueba guardada. La app seguirá su resultado.");
}
function intervalMs(interval){
  return ({"15m":15*60e3,"1h":60*60e3,"4h":4*60*60e3,"1d":24*60*60e3,"1w":7*24*60*60e3})[interval]||60*60e3;
}
function nextExecutionMinute(ts){
  const minute=60*1000;
  return Math.floor(Number(ts)/minute)*minute+minute;
}
function monitoringInterval(t){
  return t?.executionModel==="NEXT_1M_OPEN_CAUSAL_V1"?"1m":t.interval;
}
async function activateCausalTrade(t,c){
  if(!t?.pendingActivation) return;
  const entry=Number(c?.o); if(!(entry>0)) throw new Error("No se pudo obtener el open causal de activación");
  const stopPct=Number(t.plannedStopPct??3),targetPct=Number(t.plannedTargetPct??9);
  const lv=paperLevels(entry,t.side,"percent",stopPct,"percent",targetPct);
  const riskDist=Math.abs(entry-lv.stop),rewardDist=Math.abs(lv.target-entry);
  t.entry=entry;t.stop=lv.stop;t.target=lv.target;t.current=entry;
  t.qty=riskDist?Number(t.riskCash||0)/riskDist:0;t.potentialProfit=t.qty*rewardDist;t.rr=riskDist?rewardDist/riskDist:0;
  t.openedAt=Number(t.activationAt||c.t);t.monitorFrom=t.openedAt;
  // Mientras se construye QRA, esta operación sigue marcada como pendiente para que no se cuente a sí misma.
  t.qraLab=await buildQraLabSnapshot(t.side,t.openedAt,t.interval,t.riskCash,t.capital);
  t.pendingActivation=false;t.activatedAt=Date.now();
}
function tradeResultPct(t,exit){
  if(!(t?.entry>0&&exit>0)) return 0;
  return (t.side==="long"?(exit-t.entry):(t.entry-exit))/t.entry*100;
}
function firstSafeCandleTime(t){
  // Las operaciones automáticas antiguas (v6.8.3 y previas) guardaban openedAt como
  // apertura de la vela que generó la señal. Para ellas saltamos esa vela completa.
  if(t.auto && !t.entryTimingFixed) return t.openedAt+intervalMs(t.interval);
  return t.openedAt;
}
function favorableRFromPrice(t,price){
  const risk=Math.abs(t.entry-t.stop); if(!(risk>0&&price>0)) return 0;
  const move=t.side==="long"?price-t.entry:t.entry-price;
  return Math.max(0,move/risk);
}
function adverseRFromPrice(t,price){
  const risk=Math.abs(t.entry-t.stop); if(!(risk>0&&price>0)) return 0;
  const move=t.side==="long"?t.entry-price:price-t.entry;
  return Math.max(0,move/risk);
}
function updateTradeExcursions(t,candle){
  const favorablePrice=t.side==="long"?candle.h:candle.l;
  const adversePrice=t.side==="long"?candle.l:candle.h;
  const mfe=favorableRFromPrice(t,favorablePrice);
  const mae=adverseRFromPrice(t,adversePrice);
  if(mfe>(t.mfeR||0)){t.mfeR=mfe;t.mfePrice=favorablePrice;t.mfeAt=candle.t;}
  if(mae>(t.maeR||0)){t.maeR=mae;t.maePrice=adversePrice;t.maeAt=candle.t;}
}
function updateTradeMFE(t,candle){updateTradeExcursions(t,candle)}

// Registro compacto de velas por operación para poder reproducir después cualquier
// regla de salida (BE, trailing, escalera, etc.) sin depender sólo del MFE.
// Formato de cada fila: [t, open, high, low, close, volume, closeTime].
const PAPER_CANDLE_LOG_MAX=OPEN_EVIDENCE_WINDOW;
function appendTradeCandle(t,c){
  if(!Array.isArray(t.candleLog)) t.candleLog=[];
  t.candleFormat="t,o,h,l,c,v,ct";
  const row=[+c.t,+c.o,+c.h,+c.l,+c.c,+c.v,+c.ct];
  const last=t.candleLog.at(-1);
  if(last && +last[0]===+c.t){ t.candleLog[t.candleLog.length-1]=row; return; }
  t.candleLogCount=Number(t.candleLogCount||0)+1;
  t.candleLog.push(row);
  if(t.candleLog.length>PAPER_CANDLE_LOG_MAX){
    t.candleLog.shift();
    t.candleLogDropped=Number(t.candleLogDropped||0)+1;
    t.candleLogWindowed=true;
  }
}
// Recorrido compacto por vela expresado en R. No cambia entradas ni cierres; solo
// agrega evidencia para reconstruir después BE, trailing o escalera.
// Formato: [t, oR, bestR, worstR, cR, newLevels, terminal].
// bestR = mejor avance favorable de la vela; worstR = peor retroceso (negativo).
function signedRFromPrice(t,price){
  const risk=Math.abs(t.entry-t.stop); if(!(risk>0&&price>0)) return 0;
  return (t.side==="long"?(price-t.entry):(t.entry-price))/risk;
}
function appendTradeRPath(t,c,terminal=""){
  if(!Array.isArray(t.rPath)) t.rPath=[];
  if(!Array.isArray(t.rLevelsHit)) t.rLevelsHit=[];
  t.rPathFormat="t,oR,bestR,worstR,cR,newLevels,terminal";
  const oR=signedRFromPrice(t,c.o);
  const hR=signedRFromPrice(t,c.h);
  const lR=signedRFromPrice(t,c.l);
  const cR=signedRFromPrice(t,c.c);
  const bestR=Math.max(hR,lR);
  const worstR=Math.min(hR,lR);
  const hit=new Set(t.rLevelsHit.map(Number));
  const newLevels=[];
  // Niveles de 0.25R hasta el máximo de la vela, sin techo práctico para el análisis.
  const maxStep=Math.floor((bestR+1e-9)/0.25);
  for(let i=1;i<=maxStep;i++){
    const level=+(i*0.25).toFixed(2);
    if(!hit.has(level)){ hit.add(level); newLevels.push(level); }
  }
  t.rLevelsHit=Array.from(hit).sort((a,b)=>a-b);
  const row=[+c.t,+oR.toFixed(6),+bestR.toFixed(6),+worstR.toFixed(6),+cR.toFixed(6),newLevels,terminal||""];
  const last=t.rPath.at(-1);
  if(last && +last[0]===+c.t){ t.rPath[t.rPath.length-1]=row; return; }
  t.rPathCount=Number(t.rPathCount||0)+1;
  t.rPath.push(row);
  if(t.rPath.length>PAPER_CANDLE_LOG_MAX){
    const dropped=t.rPath.shift();
    mergeRPathSummaryRow(t,dropped);
    t.rPathDropped=Number(t.rPathDropped||0)+1;
    t.rPathWindowed=true;
  }
}

// Experimento prospectivo de gestión de salida. Las tres variantes comparten
// exactamente la misma entrada y las mismas velas. La gestión "actual" sigue
// siendo el status/exit original; Escalera y Trailing son salidas virtuales.
function newExitComparison(){
  return {
    version:"6.10.7-TRAILING-AB",startedAt:Date.now(),trailingABStartedAt:TRAILING_AB_STARTED_AT,
    ladder:{status:"open",stopR:-1,resultR:null,closedAt:null,maxR:0},
    trailing020:{status:"open",stopR:-1,resultR:null,closedAt:null,maxR:0},
    trailing025:{status:"open",stopR:-1,resultR:null,closedAt:null,maxR:0}
  };
}
function ensureExitComparison(t){
  if(!t.exitComparison) t.exitComparison=newExitComparison();
  if(!t.exitComparison.ladder) t.exitComparison.ladder={status:"open",stopR:-1,resultR:null,closedAt:null,maxR:0};
  if(Number(t.openedAt||0)>=TRAILING_AB_STARTED_AT && !t.exitComparison.trailing020){
    t.exitComparison.trailing020={status:"open",stopR:-1,resultR:null,closedAt:null,maxR:0};
  }
  if(!t.exitComparison.trailing025) t.exitComparison.trailing025={status:"open",stopR:-1,resultR:null,closedAt:null,maxR:0};
  return t.exitComparison;
}
function hasVirtualOpen(t){
  const x=t.exitComparison;
  return !!(x && (x.ladder?.status==="open" || x.trailing020?.status==="open" || x.trailing025?.status==="open"));
}
function needsPaperMonitoring(t){ return t.status==="open" || hasVirtualOpen(t); }
function ladderStopForMaxR(maxR){
  if(maxR<1) return -1;
  if(maxR<1.25) return 0;
  if(maxR<2) return 1;
  if(maxR<2.5) return 1.25;
  if(maxR<3) return 2;
  const level=Math.floor((maxR+1e-9)*2)/2;
  return Math.max(2.5,level-0.5);
}
function trailingStepStopForMaxR(maxR,step){
  if(maxR<1) return -1;
  if(maxR<1+step-1e-9) return 0;
  const level=Math.floor((maxR+1e-9)/step)*step;
  return Math.max(0,+((level-step).toFixed(10)));
}
function trailing025StopForMaxR(maxR){ return trailingStepStopForMaxR(maxR,0.25); }
function processVirtualExitBranch(branch,c,bestR,worstR,kind,step=0.25){
  if(!branch || branch.status!=="open") return;
  const priorStop=Number(branch.stopR??-1);
  if(worstR<=priorStop+1e-9){
    branch.status="closed"; branch.resultR=priorStop; branch.closedAt=+c.t; return;
  }
  branch.maxR=Math.max(Number(branch.maxR||0),bestR);
  const candidate=kind==="ladder"?ladderStopForMaxR(branch.maxR):trailingStepStopForMaxR(branch.maxR,step);
  const nextStop=Math.max(priorStop,candidate);
  branch.stopR=nextStop;
  // Misma convención conservadora del backtest v6.10.6: si la vela que eleva
  // el trailing también atraviesa el nuevo stop, se considera ejecutado ahí.
  if(worstR<=nextStop+1e-9){
    branch.status="closed"; branch.resultR=nextStop; branch.closedAt=+c.t;
  }
}
function processExitComparison(t,c){
  const x=ensureExitComparison(t);
  const hR=signedRFromPrice(t,c.h),lR=signedRFromPrice(t,c.l);
  const bestR=Math.max(hR,lR),worstR=Math.min(hR,lR);
  processVirtualExitBranch(x.ladder,c,bestR,worstR,"ladder");
  if(Number(t.openedAt||0)>=TRAILING_AB_STARTED_AT) processVirtualExitBranch(x.trailing020,c,bestR,worstR,"trailing",0.20);
  processVirtualExitBranch(x.trailing025,c,bestR,worstR,"trailing",0.25);
}
function comparisonLabel(branch){
  if(!branch) return "—";
  return branch.status==="open"?`Abierta · stop ${branch.stopR>=0?"+":""}${fmt(branch.stopR,2)}R · máx. +${fmt(branch.maxR||0,2)}R`:`${branch.resultR>=0?"+":""}${fmt(branch.resultR,2)}R`;
}
async function backfillPaperMFE(){
  const missing=state.paperTrades.filter(t=>t.status!=="open"&&t.closedAt&&!(t.mfeR>=0));
  for(const t of missing){
    try{
      const raw=await api("/klines",{symbol:t.symbol+"USDT",interval:t.interval,startTime:firstSafeCandleTime(t),endTime:t.closedAt,limit:1000});
      const candles=raw.map(x=>({t:+x[0],h:+x[2],l:+x[3]}));
      t.mfeR=0;t.mfePrice=t.entry;
      for(const c of candles){
        // En la vela del stop no conocemos el orden intravela. No contamos su extremo favorable
        // si el stop fue tocado, para no inflar artificialmente el MFE histórico.
        const stopHit=t.side==="long"?c.l<=t.stop:c.h>=t.stop;
        if(stopHit && t.status==="loss") break;
        updateTradeMFE(t,c);
        if(c.t>=t.closedAt) break;
      }
    }catch(e){console.warn("mfe backfill",t.symbol,e)}
  }
  if(missing.length) savePaperState();
}
let paperTradeUpdateRunning=false;
const PAPER_TRADE_CONCURRENCY=3;
const paperMonitor={lastRun:null,lastDuration:0,checked:0,closed:0,errors:0,totalOpen:0,lastError:"",nextRun:null};

function renderPaperMonitor(){
  const box=$("#paperMonitor"); if(!box) return;
  const active=state.paperTrades.some(needsPaperMonitoring);
  const now=Date.now();
  const next=paperMonitor.nextRun?Math.max(0,Math.ceil((paperMonitor.nextRun-now)/1000)):null;
  const stamp=paperMonitor.lastRun?new Date(paperMonitor.lastRun).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"Aún no revisa";
  let stateClass="ok", stateLabel=paperTradeUpdateRunning?"Revisando…":active?"Seguimiento automático activo":"Sin posiciones abiertas";
  if(paperMonitor.errors>0){stateClass="warn";stateLabel="Seguimiento con errores"}
  box.className=`paper-monitor ${stateClass}`;
  box.innerHTML=`<div class="paper-monitor-head"><div><span class="monitor-dot"></span><strong>${stateLabel}</strong></div><button id="paperCheckNowBtn" class="secondary compact-btn" ${paperTradeUpdateRunning?"disabled":""}>Revisar ahora</button></div>
  <div class="paper-monitor-grid"><span>Última revisión<strong>${stamp}</strong></span><span>Abiertas al iniciar<strong>${paperMonitor.totalOpen}</strong></span><span>Revisadas<strong>${paperMonitor.checked}</strong></span><span>Cerradas<strong>${paperMonitor.closed}</strong></span><span>Errores<strong>${paperMonitor.errors}</strong></span><span>Próxima revisión<strong>${active?(paperTradeUpdateRunning?"al terminar":next===null?"~45 s":`~${next} s`):"—"}</strong></span></div>
  ${paperMonitor.lastError?`<div class="paper-monitor-error">Último error: ${String(paperMonitor.lastError).replace(/</g,"&lt;")}</div>`:""}`;
  const btn=$("#paperCheckNowBtn"); if(btn) btn.onclick=()=>updatePaperTrades(true);
}

async function checkOnePaperTrade(t){
  const before=t.status;
  try{
    if(t.pendingActivation && Date.now()<Number(t.activationAt||t.openedAt||0)) return {ok:true,closed:false,pending:true};
    const monitorInt=monitoringInterval(t),step=intervalMs(monitorInt);
    let startTime=Math.max(firstSafeCandleTime(t),Number(t.monitorFrom||0));
    let all=[];
    // Pagina para poder recuperarse después de una desconexión larga sin quedar limitado
    // a las primeras 1000 velas de la operación.
    for(let page=0;page<20;page++){
      const raw=await api("/klines",{symbol:t.symbol+"USDT",interval:monitorInt,startTime,limit:1000});
      if(!raw.length) break;
      const batch=raw.map(x=>({t:+x[0],o:+x[1],h:+x[2],l:+x[3],c:+x[4],v:+x[5],ct:+x[6]}));
      all.push(...batch);
      if(raw.length<1000) break;
      const next=batch.at(-1).t+step;
      if(next<=startTime) break;
      startTime=next;
    }
    if(!all.length) return {ok:false,closed:false,error:"Sin velas devueltas"};
    if(t.pendingActivation){
      const first=all.find(c=>Number(c.t)>=Number(t.activationAt||t.openedAt||0));
      if(!first) return {ok:true,closed:false,pending:true};
      await activateCausalTrade(t,first);
    }
    t.current=all.at(-1).c;
    for(const c of all){
      if(c.t<firstSafeCandleTime(t)) continue;
      appendTradeCandle(t,c);
      const stopHit=t.side==="long"?c.l<=t.stop:c.h>=t.stop;
      const targetHit=t.side==="long"?c.h>=t.target:c.l<=t.target;
      const terminal=stopHit&&targetHit?"both":stopHit?"stop":targetHit?"target":"";
      appendTradeRPath(t,c,terminal);
      processExitComparison(t,c);
      if(t.status==="open"){
        if(!stopHit) updateTradeMFE(t,c);
        // Si ambos niveles aparecen en una misma vela, sin datos intravela no conocemos
        // cuál ocurrió primero. Conservamos el criterio conservador: stop primero.
        if(stopHit&&targetHit){t.status="loss";t.exit=t.stop;t.closedAt=c.t}
        else if(stopHit){t.status="loss";t.exit=t.stop;t.closedAt=c.t}
        else if(targetHit){updateTradeMFE(t,c);t.status="win";t.exit=t.target;t.closedAt=c.t}
        if(t.status!=="open"){t.resultPct=tradeResultPct(t,t.exit);await finalizeMarketBenchmark(t);}
      }
      if(!needsPaperMonitoring(t)) break;
    }
    if(!needsPaperMonitoring(t)){
      t.monitorFrom=null;
    }else{
      // Reprocesamos solo la última vela en la siguiente ronda porque su máximo/mínimo
      // puede seguir cambiando mientras está abierta; evitamos descargar todo el historial.
      t.monitorFrom=Math.max(firstSafeCandleTime(t),all.at(-1).t);
    }
    return {ok:true,closed:before==="open"&&t.status!=="open"};
  }catch(e){
    console.warn("paper",t.symbol,e);
    return {ok:false,closed:false,error:`${t.symbol}: ${e?.message||e}`};
  }
}

async function updatePaperTrades(manual=false){
  // Evita dos rondas simultáneas. El finally garantiza liberar el bloqueo aun si algo falla.
  if(paperTradeUpdateRunning){renderPaperMonitor();return}
  paperTradeUpdateRunning=true;
  const started=Date.now();
  paperMonitor.lastError="";
  renderPaperMonitor();
  try{
    const open=state.paperTrades.filter(needsPaperMonitoring);
    paperMonitor.totalOpen=open.length; paperMonitor.checked=0; paperMonitor.closed=0; paperMonitor.errors=0;
    // Procesa hasta 3 posiciones a la vez para reducir picos de solicitudes y errores de red.
    for(let i=0;i<open.length;i+=PAPER_TRADE_CONCURRENCY){
      const batch=open.slice(i,i+PAPER_TRADE_CONCURRENCY);
      const results=await Promise.all(batch.map(checkOnePaperTrade));
      for(const r of results){
        if(r?.ok) paperMonitor.checked++;
        else {paperMonitor.errors++; if(r?.error) paperMonitor.lastError=r.error}
        if(r?.closed) paperMonitor.closed++;
      }
      renderPaperMonitor();
    }
    savePaperState();
    renderPaperTrades();
  }catch(e){
    console.warn("paper update round",e);
    paperMonitor.errors++; paperMonitor.lastError=e?.message||String(e);
  }finally{
    paperMonitor.lastRun=Date.now(); paperMonitor.lastDuration=paperMonitor.lastRun-started;
    paperMonitor.nextRun=paperMonitor.lastRun+PAPER_TRADE_CHECK_MS;
    paperTradeUpdateRunning=false;
    renderPaperMonitor();
  }
}

// Mientras la PWA esté activa, revisa stops/objetivos cada 45 s.
// iOS puede suspender JavaScript en segundo plano; al volver a primer plano
// hacemos una revisión inmediata y updatePaperTrades reconstruye lo ocurrido
// usando las velas desde openedAt.
const PAPER_TRADE_CHECK_MS=45*1000;
paperMonitor.nextRun=Date.now()+PAPER_TRADE_CHECK_MS;
setInterval(renderPaperMonitor,1000);
setInterval(()=>{
  if(document.visibilityState==="visible" && state.paperTrades.some(needsPaperMonitoring)){
    updatePaperTrades();
  }
},PAPER_TRADE_CHECK_MS);
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible" && state.paperTrades.some(needsPaperMonitoring)){
    updatePaperTrades();
  }
});
window.addEventListener("focus",()=>{
  if(state.paperTrades.some(needsPaperMonitoring)) updatePaperTrades();
});
async function closePaperManual(id){
  const t=state.paperTrades.find(x=>x.id===id);if(!t)return;
  const value=prompt("Precio de cierre manual",t.current||t.entry);if(value===null)return;
  const exit=+value;if(!(exit>0))return alert("Precio inválido.");
  t.status="manual";t.exit=exit;t.closedAt=Date.now();t.resultPct=tradeResultPct(t,exit);await finalizeMarketBenchmark(t);savePaperState();renderPaperTrades();
}
function deletePaper(id){if(confirm("¿Eliminar esta prueba del diario?")){state.paperTrades=state.paperTrades.filter(x=>x.id!==id);savePaperState();renderPaperTrades()}}
function tradeCard(t){
  const status={open:"Abierta",win:"Ganada",loss:"Perdida",manual:"Cierre manual"}[t.status];
  const cls={open:"status-open",win:"status-win",loss:"status-loss",manual:"status-manual"}[t.status];
  const current=t.status==="open"?(t.current||t.entry):t.exit;
  const running=tradeResultPct(t,current);
  const pnlCash=(t.side==="long"?(current-t.entry):(t.entry-current))*(t.qty||0);
  const checklistDone=t.checklist?Object.values(t.checklist).filter(Boolean).length:0;
  return `<article class="paper-trade"><div class="paper-head"><div><h3>${t.symbol}/USDT · ${t.side.toUpperCase()}</h3><div class="paper-meta">${t.interval} · ${new Date(t.openedAt).toLocaleString("es-MX")}</div></div><strong class="${cls}">${status}</strong></div>
  <div class="paper-levels"><div class="paper-level"><span>Entrada</span><strong>${money(t.entry)}</strong></div><div class="paper-level"><span>Stop</span><strong>${money(t.stop)}</strong></div><div class="paper-level"><span>Objetivo</span><strong>${money(t.target)}</strong></div><div class="paper-level"><span>${t.status==="open"?"Precio actual":"Salida"}</span><strong>${money(current)}</strong></div><div class="paper-level"><span>Resultado</span><strong class="${running>=0?"status-win":"status-loss"}">${running>=0?"+":""}${fmt(running,2)}%</strong></div><div class="paper-level"><span>Resultado $</span><strong class="${pnlCash>=0?"status-win":"status-loss"}">${pnlCash>=0?"+":""}${money(pnlCash)}</strong></div><div class="paper-level"><span>R/B inicial</span><strong>1 : ${fmt(t.rr||Math.abs(t.target-t.entry)/Math.abs(t.entry-t.stop),2)}</strong></div><div class="paper-level"><span>Máx. avance (MFE)</span><strong>${t.mfeR>=0?"+"+fmt(t.mfeR,2)+"R":"Calculando…"}</strong></div><div class="paper-level"><span>Máx. retroceso (MAE)</span><strong>${t.maeR>=0?"-"+fmt(t.maeR,2)+"R":"Calculando…"}</strong></div><div class="paper-level"><span>Velas OHLC guardadas</span><strong>${Array.isArray(t.candleLog)?t.candleLog.length:0}${t.candleLogCompacted?` · compactadas (${Number(t.candleLogCount||0)} originales)`:t.candleLogWindowed?` · ventana reciente (${Number(t.candleLogCount||0)} totales)`:""}</strong></div><div class="paper-level"><span>Recorrido R</span><strong>${Array.isArray(t.rPath)?t.rPath.length:0}${t.rPathCompacted?` · compactado (${Number(t.rPathCount||t.rPathSummary?.rows||0)} originales)`:t.rPathWindowed?` · ventana reciente (${Number(t.rPathCount||0)} totales)`:""} velas · máx. nivel ${Array.isArray(t.rLevelsHit)&&t.rLevelsHit.length?fmt(Math.max(...t.rLevelsHit),2)+"R":"0R"}${t.rPathTruncated?" + (límite)":""}</strong></div>${t.exitComparison?`<div class="paper-level"><span>Escalera</span><strong>${comparisonLabel(t.exitComparison.ladder)}</strong></div><div class="paper-level"><span>Trailing 0.20R</span><strong>${comparisonLabel(t.exitComparison.trailing020)}</strong></div><div class="paper-level"><span>Trailing 0.25R</span><strong>${comparisonLabel(t.exitComparison.trailing025)}</strong></div>`:""}${t.qraLab?`<div class="paper-level"><span>QRA-01</span><strong>${t.qraLab.qra01Accepted?"ACEPTA":"BLOQUEA"} · BTC ${t.qraLab.btcRegime}</strong></div><div class="paper-level"><span>Solo LONG</span><strong>${(t.qraLab.soloLongAccepted ?? (t.side==="long"))?"ACEPTA":"RECHAZA"}</strong></div><div class="paper-level"><span>QRA-03 virtual</span><strong>${fmt(Number(t.qraLab.qra03Virtual?.multiplier??1)*100,0)}% riesgo · ${Number(t.qraLab.qra03Observation?.sameDirectionOpen||0)+1} misma dirección</strong></div><div class="paper-level"><span>Benchmark BTC</span><strong>${t.qraLab.marketBenchmark?.status==="complete"?`Exceso ${Number(t.qraLab.marketBenchmark.excessR)>=0?"+":""}${fmt(t.qraLab.marketBenchmark.excessR,2)}R`:"En seguimiento"}</strong></div>`:""}<div class="paper-level"><span>Riesgo planeado</span><strong>${money(t.riskCash||0)} (${fmt(t.riskPct||0,1)}%)</strong></div><div class="paper-level"><span>Ganancia potencial</span><strong>${money(t.potentialProfit||0)}</strong></div><div class="paper-level"><span>Score inicial</span><strong>${t.score}/100${t.scoreType==="1D+4H"?` · combinado (1D ${t.scoreDaily} / 4H ${t.score4h})`:""}</strong></div></div>
  <div class="paper-snapshot"><span class="tag">Control ${checklistDone}/4</span><span class="tag">RSI ${fmt(t.snapshot.rsi,1)}</span><span class="tag">ADX ${fmt(t.snapshot.adx,1)}</span><span class="tag">ATR ${fmt(t.snapshot.atrPct,2)}%</span><span class="tag">Vol ${fmt(t.snapshot.volumeRatio,2)}x</span><span class="tag">${t.snapshot.trend}</span></div>
  ${t.notes?`<p class="paper-note">${t.notes.replace(/</g,"&lt;")}</p>`:""}<div class="paper-actions">${t.status==="open"?`<button class="ghost" data-close-paper="${t.id}">Cerrar manual</button>`:"<span></span>"}<button class="danger" data-delete-paper="${t.id}">Eliminar</button></div></article>`;
}


function renderPaperTrades(){
  const openCountEl=$("#paperOpenCount");
  const openList=$("#paperOpenList"), closedList=$("#paperClosedList");
  if(!openList||!closedList)return;

  const open=state.paperTrades.filter(t=>t.status==="open");
  const closed=state.paperTrades.filter(t=>t.status!=="open");
  if(openCountEl) openCountEl.textContent=open.length;

  const frames=["15m","1h","4h","1d","1w"];
  const frameLabel={"15m":"15 min","1h":"1 hora","4h":"4 horas","1d":"1 día","1w":"1 semana"};

  const sideGroup=(rows,side)=>{
    const filtered=rows.filter(t=>(t.side||"").toLowerCase()===side);
    const label=side==="long"?"LONG":"SHORT";
    return `<details class="paper-side-group" ${filtered.length ? "open" : ""}>
      <summary>
        <span class="paper-side-title ${side}">${label}</span>
        <span class="paper-side-count">${filtered.length} ${filtered.length===1?"operación":"operaciones"}</span>
      </summary>
      <div class="paper-side-body">
        ${filtered.length ? filtered.map(tradeCard).join("") : `<div class="notice compact-notice">No hay operaciones ${label}.</div>`}
      </div>
    </details>`;
  };

  const timeframeGroup=(tf)=>{
    const rows=open.filter(t=>(t.interval||"4h").toLowerCase()===tf);
    return `<details class="paper-tf-group">
      <summary class="paper-tf-summary">
        <span class="paper-tf-title">${frameLabel[tf]}</span>
        <span class="paper-tf-count">${rows.length} ${rows.length===1?"operación":"operaciones"}</span>
      </summary>
      <div class="paper-tf-body">
        ${sideGroup(rows,"long")}
        ${sideGroup(rows,"short")}
      </div>
    </details>`;
  };

  const standard=frames.map(timeframeGroup).join("");
  const otherRows=open.filter(t=>!frames.includes((t.interval||"").toLowerCase()));
  const other=otherRows.length?`<details class="paper-tf-group">
    <summary class="paper-tf-summary">
      <span class="paper-tf-title">Otras temporalidades</span>
      <span class="paper-tf-count">${otherRows.length} operaciones</span>
    </summary>
    <div class="paper-tf-body">${sideGroup(otherRows,"long")}${sideGroup(otherRows,"short")}</div>
  </details>`:"";

  openList.innerHTML=standard+other;

  const filter=$("#paperFilter")?.value||"all";
  const visible=closed.filter(t=>filter==="all"||(filter==="wins"&&(t.resultPct||0)>0)||(filter==="losses"&&(t.resultPct||0)<0)||filter===t.side);

  const won=visible.filter(t=>t.status==="win"||(t.resultPct||0)>0);
  const lost=visible.filter(t=>t.status==="loss"||(t.resultPct||0)<0);
  const neutral=visible.filter(t=>!won.includes(t)&&!lost.includes(t));

  const closedGroup=(label,rows,kind)=>`<details class="paper-closed-group">
    <summary>
      <span class="paper-closed-title ${kind}">${label}</span>
      <span class="paper-closed-count">${rows.length} ${rows.length===1?"operación":"operaciones"}</span>
    </summary>
    <div class="paper-closed-body">
      ${rows.length?rows.slice().reverse().map(tradeCard).join(""):`<div class="notice compact-notice">No hay operaciones ${label.toLowerCase()}.</div>`}
    </div>
  </details>`;

  closedList.innerHTML=visible.length
    ? closedGroup("GANADAS",won,"won")+closedGroup("PERDIDAS",lost,"lost")+(neutral.length?closedGroup("OTRAS",neutral,"other"):"")
    : '<div class="notice">No hay operaciones que coincidan con este filtro.</div>';

  const wins=closed.filter(t=>t.status==="win"||t.resultPct>0).length;
  const losses=closed.filter(t=>t.status==="loss"||t.resultPct<0).length;
  const rate=closed.length?wins/closed.length*100:0;
  const avg=closed.length?closed.reduce((sum,t)=>sum+(t.resultPct||0),0)/closed.length:0;
  // resultPct es movimiento del activo (+9/-3 con la configuración actual), NO retorno de cuenta.
  const totalMovePct=closed.reduce((sum,t)=>sum+(t.resultPct||0),0);
  const avgRR=closed.length?closed.reduce((sum,t)=>sum+(t.rr||Math.abs(t.target-t.entry)/Math.abs(t.entry-t.stop)||0),0)/closed.length:0;
  const totalCash=closed.reduce((sum,t)=>sum+((t.side==="long"?((t.exit||t.entry)-t.entry):(t.entry-(t.exit||t.entry)))*(t.qty||0)),0);
  const totalR=closed.reduce((sum,t)=>sum+(t.exit!=null?signedRFromPrice(t,t.exit):0),0);
  const baseCapital=Number(state.autoPaper?.capital||closed.find(t=>Number(t.capital)>0)?.capital||0);
  const returnOnBase=baseCapital>0?totalCash/baseCapital*100:0;
  const openRiskCash=open.reduce((sum,t)=>sum+Number(t.riskCash||0),0);
  const openRiskPct=baseCapital>0?openRiskCash/baseCapital*100:0;
  const openLongRisk=open.filter(t=>t.side==="long").reduce((s,t)=>s+Number(t.riskCash||0),0);
  const openShortRisk=open.filter(t=>t.side==="short").reduce((s,t)=>s+Number(t.riskCash||0),0);
  const ambiguousBoth=closed.filter(t=>Array.isArray(t.rPath)&&t.rPath.some(r=>r?.[6]==="both")).length;

  const compared=state.paperTrades.filter(t=>t.exitComparison);
  const actualDone=compared.filter(t=>t.status!=="open"&&t.exit!=null);
  const actualR=actualDone.reduce((sum,t)=>sum+signedRFromPrice(t,t.exit),0);
  const ladderDone=compared.filter(t=>t.exitComparison.ladder?.status==="closed");
  const trail020Done=compared.filter(t=>Number(t.openedAt||0)>=TRAILING_AB_STARTED_AT&&t.exitComparison.trailing020?.status==="closed");
  const trailDone=compared.filter(t=>t.exitComparison.trailing025?.status==="closed");
  const ladderR=ladderDone.reduce((s,t)=>s+Number(t.exitComparison.ladder.resultR||0),0);
  const trail020R=trail020Done.reduce((s,t)=>s+Number(t.exitComparison.trailing020.resultR||0),0);
  const trailR=trailDone.reduce((s,t)=>s+Number(t.exitComparison.trailing025.resultR||0),0);

  $("#paperStats").innerHTML=[
    ["Pruebas cerradas",closed.length],["Ganadoras",wins],["Perdedoras",losses],
    ["Acierto",fmt(rate,1)+"%"],
    ["P&L simulado",(totalCash>=0?"+":"")+money(totalCash)],
    ["Retorno s/capital base",(returnOnBase>=0?"+":"")+fmt(returnOnBase,2)+"% · no compuesto"],
    ["Resultado real en R",(totalR>=0?"+":"")+fmt(totalR,2)+"R"],
    ["Movimiento acumulado (no rentabilidad)",(totalMovePct>=0?"+":"")+fmt(totalMovePct,2)+"%"],
    ["Riesgo abierto agregado",money(openRiskCash)+` · ${fmt(openRiskPct,1)}% del capital base`],
    ["Riesgo abierto LONG / SHORT",`${money(openLongRisk)} / ${money(openShortRisk)}`],
    ["Velas stop+target ambiguas",`${ambiguousBoth} · criterio conservador: stop primero`],
    ["Movimiento promedio",(avg>=0?"+":"")+fmt(avg,2)+"%"],["R/B promedio","1 : "+fmt(avgRR,2)],
    ["Actual · cerradas",actualDone.length],["Actual · acumulado",(actualR>=0?"+":"")+fmt(actualR,2)+"R"],
    ["Escalera · cerradas",ladderDone.length],["Escalera · acumulado",(ladderR>=0?"+":"")+fmt(ladderR,2)+"R"],
    ["Trailing 0.20R · cerradas",trail020Done.length],["Trailing 0.20R · acumulado",(trail020R>=0?"+":"")+fmt(trail020R,2)+"R"],
    ["Trailing 0.25R · cerradas",trailDone.length],["Trailing 0.25R · acumulado",(trailR>=0?"+":"")+fmt(trailR,2)+"R"]
  ].map(([k,v])=>`<div class="result-card"><span>${k}</span><strong>${v}</strong></div>`).join("");
  if(openRiskPct>10){
    $("#paperStats").insertAdjacentHTML("afterbegin",`<div class="result-card risk-alert-card"><span>ALERTA DE EXPOSICIÓN</span><strong>${fmt(openRiskPct,1)}% del capital está en riesgo simultáneo</strong></div>`);
  }
  renderQraLabStats();

  const mfeKnown=closed.filter(t=>t.mfeR>=0);
  const rLevels=[1,1.5,2,2.5,3];
  const objectiveCards=rLevels.map(r=>{
    const hits=mfeKnown.filter(t=>t.mfeR>=r).length;
    const pct=mfeKnown.length?hits/mfeKnown.length*100:0;
    return `<div class="result-card mfe-card"><span>Habrían llegado a 1:${r}</span><strong>${hits}/${mfeKnown.length} · ${fmt(pct,1)}%</strong></div>`;
  }).join("");
  const mfeBox=$("#paperMfeStats");
  if(mfeBox) mfeBox.innerHTML=objectiveCards+(mfeKnown.length<closed.length?`<p class="mfe-note">Calculando recorrido de ${closed.length-mfeKnown.length} operaciones anteriores…</p>`:``);

  renderPaperInsights(closed);
  $$('[data-close-paper]').forEach(b=>b.onclick=()=>closePaperManual(+b.dataset.closePaper));
  $$('[data-delete-paper]').forEach(b=>b.onclick=()=>deletePaper(+b.dataset.deletePaper));
}

function renderPaperInsights(closed){
  const box=$("#paperInsights");if(!box)return;
  if(closed.length<5){box.innerHTML=`<h3>🧠 Qué está aprendiendo el Centro Quant</h3><p>Necesita al menos 5 operaciones cerradas. Llevas ${closed.length}. Con 20 o más, las conclusiones serán mucho más útiles.</p>`;return}
  const insights=[];
  const groups=[
    ["RSI menor de 45",t=>t.snapshot?.rsi<45],["RSI entre 45 y 55",t=>t.snapshot?.rsi>=45&&t.snapshot?.rsi<=55],["RSI mayor de 55",t=>t.snapshot?.rsi>55],
    ["ADX menor de 20",t=>t.snapshot?.adx<20],["ADX de 20 o más",t=>t.snapshot?.adx>=20],
    ["volumen por encima del promedio",t=>t.snapshot?.volumeRatio>=1],["volumen bajo",t=>t.snapshot?.volumeRatio<1],
    ["score de 85 o más",t=>t.score>=85],["score de 70 a 84",t=>t.score>=70&&t.score<85],["score menor de 70",t=>t.score<70]
  ];
  const ranked=groups.map(([name,test])=>{const a=closed.filter(test);return {name,n:a.length,avg:a.length?a.reduce((s,t)=>s+(t.resultPct||0),0)/a.length:-999,win:a.length?a.filter(t=>(t.resultPct||0)>0).length/a.length*100:0}}).filter(x=>x.n>=3).sort((a,b)=>b.avg-a.avg);
  if(ranked.length){const best=ranked[0],worst=ranked.at(-1);insights.push(`Tus mejores resultados aparecen con <strong>${best.name}</strong>: ${fmt(best.win,0)}% de acierto y ${best.avg>=0?"+":""}${fmt(best.avg,2)}% promedio (${best.n} operaciones).`);if(worst.name!==best.name)insights.push(`La condición más débil hasta ahora es <strong>${worst.name}</strong>: ${fmt(worst.win,0)}% de acierto y ${worst.avg>=0?"+":""}${fmt(worst.avg,2)}% promedio.`)}
  const longs=closed.filter(t=>t.side==="long"),shorts=closed.filter(t=>t.side==="short");
  if(longs.length>=3&&shorts.length>=3){const la=longs.reduce((s,t)=>s+(t.resultPct||0),0)/longs.length,sa=shorts.reduce((s,t)=>s+(t.resultPct||0),0)/shorts.length;insights.push(`${la>=sa?"Long":"Short"} ha sido tu dirección más rentable hasta ahora (${fmt(Math.max(la,sa),2)}% promedio).`)}
  const goodRR=closed.filter(t=>(t.rr||0)>=3),lowRR=closed.filter(t=>(t.rr||0)<3);
  if(goodRR.length>=3&&lowRR.length>=3){const ga=goodRR.reduce((s,t)=>s+(t.resultPct||0),0)/goodRR.length,ba=lowRR.reduce((s,t)=>s+(t.resultPct||0),0)/lowRR.length;insights.push(`Las operaciones con R/B mínimo 1:3 promedian ${ga>=0?"+":""}${fmt(ga,2)}%, frente a ${ba>=0?"+":""}${fmt(ba,2)}% en las menores a 1:3.`)}
  box.innerHTML=`<h3>🧠 Qué está aprendiendo el Centro Quant</h3>${insights.length?`<ul>${insights.map(x=>`<li>${x}</li>`).join("")}</ul>`:`<p>Aún faltan operaciones repetidas bajo condiciones comparables para detectar un patrón confiable.</p>`}<small>Estas observaciones describen tu diario; no garantizan resultados futuros.</small>`;
}

function exportPaperCSV(){
  const rows=state.paperTrades.map(t=>({
    fecha:new Date(t.openedAt).toISOString(),activo:t.symbol,direccion:t.side,temporalidad:t.interval,
    entrada:t.entry,stop:t.stop,objetivo:t.target,salida:t.exit||"",estado:t.status,
    resultado_pct:t.resultPct??"",cantidad:t.qty||"",riesgo_dinero:t.riskCash||"",score:t.score,
    rsi:t.snapshot?.rsi??"",adx:t.snapshot?.adx??"",volumen:t.snapshot?.volumeRatio??"",
    actual_r:t.status!=="open"&&t.exit!=null?signedRFromPrice(t,t.exit):"",
    escalera_estado:t.exitComparison?.ladder?.status||"",escalera_r:t.exitComparison?.ladder?.resultR??"",
    trailing020_estado:t.exitComparison?.trailing020?.status||"",trailing020_r:t.exitComparison?.trailing020?.resultR??"",
    trailing025_estado:t.exitComparison?.trailing025?.status||"",trailing025_r:t.exitComparison?.trailing025?.resultR??"",
    qra_version:t.qraLab?.version||"",btc_regimen:t.qraLab?.btcRegime||"",qra01:t.qraLab?(t.qraLab.qra01Accepted?"ACEPTA":"BLOQUEA"):"",qra01_motivo:t.qraLab?.qra01Reason||"",solo_long:t.qraLab?((t.qraLab.soloLongAccepted ?? (t.side==="long"))?"ACEPTA":"RECHAZA"):"",solo_long_motivo:t.qraLab?.soloLongReason||(t.qraLab?(t.side==="long"?"Aceptada: LONG":"Rechazada: estrategia Solo LONG"):""),qra03_misma_direccion:t.qraLab?(Number(t.qraLab.qra03Observation?.sameDirectionOpen||0)+1):"",qra03_multiplicador:t.qraLab?.qra03Virtual?.multiplier??"",qra03_riesgo_virtual:t.qraLab?.qra03Virtual?.virtualRiskCash??"",btc_benchmark_r:t.qraLab?.marketBenchmark?.benchmarkR??"",btc_exceso_r:t.qraLab?.marketBenchmark?.excessR??"",hipotesis_version:t.qraLab?.hypothesisFreezeVersion||t.researchMeta?.hypothesisFreezeVersion||"",
    notas:(t.notes||"").replace(/\n/g," ")
  }));
  if(!rows.length)return alert("No hay operaciones para exportar.");
  const headers=Object.keys(rows[0]);
  const csv=[headers.join(","),...rows.map(r=>headers.map(h=>`"${String(r[h]).replace(/"/g,'""')}"`).join(","))].join("\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`centro-quant-diario-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
}

function downloadJSON(data,filename){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}

function createFullBackup(){
  const data={};
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(key&&key.startsWith("quant_")) data[key]=localStorage.getItem(key);
  }
  const backup={
    app:"Centro Quant",
    version:APP_VERSION,
    format:1,
    createdAt:new Date().toISOString(),
    data
  };
  downloadJSON(backup,`centro-quant-respaldo-${new Date().toISOString().slice(0,10)}.json`);
}

async function restoreFullBackup(file){
  let parsed;
  try{parsed=JSON.parse(await file.text())}catch(e){throw new Error("El archivo no es un JSON válido.")}
  if(!parsed||parsed.app!=="Centro Quant"||parsed.format!==1||!parsed.data||typeof parsed.data!=="object"){
    throw new Error("Este archivo no parece ser un respaldo válido de Centro Quant.");
  }
  const entries=Object.entries(parsed.data).filter(([k,v])=>k.startsWith("quant_")&&(typeof v==="string"||v===null));
  if(!entries.length) throw new Error("El respaldo no contiene datos de Centro Quant.");
  // Valida JSON de las claves estructuradas antes de tocar los datos actuales.
  for(const [k,v] of entries){
    if(v===null) continue;
    if(["quant_assets","quant_weights","quant_paper_trades","quant_auto_paper"].includes(k)) JSON.parse(v);
  }
  if(!confirm(`Se reemplazarán los datos actuales por el respaldo del ${parsed.createdAt?new Date(parsed.createdAt).toLocaleString("es-MX"):"archivo seleccionado"}. ¿Continuar?`)) return;
  const oldKeys=[];
  for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith("quant_"))oldKeys.push(k)}
  oldKeys.forEach(k=>localStorage.removeItem(k));
  for(const [k,v] of entries){
    if(v===null) continue;
    if(k==="quant_paper_trades"){
      state.paperTrades=JSON.parse(v);
      savePaperState();
    }else{
      localStorage.setItem(k,v);
    }
  }
  alert("Respaldo cargado correctamente. Si era grande, Centro Quant aplicó compactación segura por capas en operaciones cerradas. La aplicación se reiniciará.");
  location.reload();
}

function updateWeightsTotal(){
  const total=$$("[data-weight]").reduce((s,i)=>s+Number(i.value||0),0),el=$("#weightsTotal");
  if(el){el.textContent=`${total} / 100`;el.className=total===100?"weight-total-ok":"weight-total-bad";}
}
function renderWeights(){
  const names={trend:"Tendencia EMA",momentum:"Momentum RSI",strength:"Fuerza ADX",volume:"Volumen",volatility:"Volatilidad ATR",structure:"Estructura"};
  $("#weightsForm").innerHTML=Object.entries(names).map(([k,n])=>`<div class="weight-row"><label><strong>${n}</strong><small>Peso máximo dentro del score</small></label><div class="weight-control"><input data-weight-range="${k}" type="range" min="0" max="50" step="1" value="${state.weights[k]}"><input data-weight="${k}" type="number" min="0" max="100" value="${state.weights[k]}"><span>pts</span></div></div>`).join("");
  $$('[data-weight]').forEach(i=>i.addEventListener('input',()=>{const r=$(`[data-weight-range="${i.dataset.weight}"]`);if(r)r.value=i.value;updateWeightsTotal()}));
  $$('[data-weight-range]').forEach(r=>r.addEventListener('input',()=>{const i=$(`[data-weight="${r.dataset.weightRange}"]`);if(i)i.value=r.value;updateWeightsTotal()}));
  updateWeightsTotal();
}
function applyWeightPreset(name){
  const presets={balanced:{trend:30,momentum:20,strength:15,volume:15,volatility:10,structure:10},trend:{trend:40,momentum:15,strength:20,volume:10,volatility:5,structure:10},momentum:{trend:20,momentum:30,strength:15,volume:20,volatility:5,structure:10}};
  const p=presets[name];if(!p)return;state.weights={...p};renderWeights();
}

$("#saveWeightsBtn").onclick=()=>{
  let total=0,next={};$$("[data-weight]").forEach(i=>{next[i.dataset.weight]=+i.value;total+=+i.value});
  if(total!==100)return alert("Los pesos deben sumar exactamente 100. Ahora suman "+total+".");
  state.weights=next;localStorage.setItem("quant_weights",JSON.stringify(next));alert("Pesos guardados.");refreshAll();
};
$("#backupDataBtn").onclick=createFullBackup;
$("#restoreDataBtn").onclick=()=>$("#restoreDataInput").click();
$("#restoreDataInput").onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{await restoreFullBackup(file)}catch(err){alert("No se pudo cargar el respaldo: "+err.message)}finally{e.target.value=""}};
$("#newOosCohortBtn").onclick=()=>{
  if(!confirm("¿Iniciar una nueva cohorte OOS?\n\nSe borrarán SOLO las operaciones abiertas/cerradas de Pruebas. Se conservarán activos, pesos, configuración y los snapshots QRA-04 ya guardados."))return;
  const at=Date.now();
  state.paperTrades=[];
  setPaperStorage("[]");
  state.pendingPaperSignal=null;
  // Evita que lastSignals heredadas impidan señales nuevas tras el reinicio.
  state.autoPaper={...state.autoPaper,lastSignals:{}};
  saveAutoPaper();
  localStorage.setItem("quant_v611_oos_cohort_started_at",String(at));
  localStorage.setItem("quant_v611_oos_cohort_meta",JSON.stringify({version:"QRA04-OOS-v6.11",startedAt:at,mode:"prospective-clean",strategyVersion:"6.11.4"}));
  alert("Nueva cohorte OOS iniciada. Operaciones: 0. Estrategia y QRA-04 conservados.");
  location.reload();
};
$("#resetDataBtn").onclick=()=>{if(confirm("¿Borrar favoritos, pesos, operaciones y configuración local?")){localStorage.clear();location.reload()}};
$$(`[data-weight-preset]`).forEach(b=>b.onclick=()=>applyWeightPreset(b.dataset.weightPreset));
$("#backToDashboard").onclick=()=>showView("dashboardView");
$("#refreshAnalysisBtn").onclick=refreshAnalysis;
$("#timeframeSelect").onchange=refreshAnalysis;
$("#analysisModeSelect").onchange=refreshAnalysis;
$("#marketModeSelect").onchange=()=>{renderRanking();refreshAll()};
$("#refreshAllBtn").onclick=refreshAll;
$("#homeTimeframeSelect").onchange=e=>refreshHomeTimeframe(e.target.value);
$("#homeAnalyzeBtn").onclick=()=>{const sym=$("#homeAnalyzeBtn").dataset.symbol;if($("#timeframeSelect"))$("#timeframeSelect").value=state.homeInterval;if(sym)openAnalysis(sym);};
$("#homePaperBtn").onclick=()=>{const sym=$("#homePaperBtn").dataset.symbol;showView("paperView");fillAssetSelects();if(sym)$("#paperSymbol").value=sym;if(state.pendingPaperSignal){$("#paperSide").value=state.pendingPaperSignal.side;$("#paperInterval").value=state.pendingPaperSignal.interval||"1d";}previewPaper();};
$("#homeMarketBtn").onclick=()=>showView("dashboardView");
$("#homeBacktestBtn").onclick=()=>showView("backtestView");
$("#savePaperBtn").onclick=()=>createPaperTrade().catch(e=>alert("No se pudo guardar la prueba: "+e.message));
["paperSymbol","paperSide","paperInterval","paperEntry","paperStopMode","paperStop","paperTargetMode","paperTarget","paperCapital","paperRiskPct"].forEach(id=>{
  $("#"+id)?.addEventListener("change",previewPaper);
  $("#"+id)?.addEventListener("input",previewPaper);
});
$("#refreshPaperBtn").onclick=async()=>{await updatePaperTrades();await backfillPaperMFE();renderPaperTrades();await scanAutoPaper();};
["autoPaperEnabled","autoPaperInterval","autoPaperThreshold","autoPaperStop","autoPaperTarget","autoPaperRisk","autoPaperCapital"].forEach(id=>$("#"+id)?.addEventListener("change",()=>{readAutoPaperControls();if(state.autoPaper.enabled)scanAutoPaper();}));
$("#scanAutoPaperBtn")?.addEventListener("click",()=>scanAutoPaper(true));
$("#trafficNeedsBtn").onclick=()=>{const box=$("#trafficNeeds"),btn=$("#trafficNeedsBtn");const open=box.hidden;box.hidden=!open;btn.setAttribute("aria-expanded",open?"true":"false");btn.textContent=open?"Ocultar condiciones":"¿Qué tendría que pasar para ponerse en verde?";};
$("#paperFilter").onchange=renderPaperTrades;
$("#exportPaperBtn").onclick=exportPaperCSV;

repairQraLabContinuity();
runStorageMaintenance();
renderWeights();fillAssetSelects();renderAssets();renderRanking();renderPaperTrades();renderPaperMonitor();renderScannerResults();syncAutoPaperControls();if($("#homeTimeframeSelect"))$("#homeTimeframeSelect").value=state.homeInterval;renderHome();refreshAll().then(async()=>{await refreshHomeTimeframe(state.homeInterval);await updatePaperTrades();await backfillPaperMFE();renderPaperTrades();await scanAutoPaper();});
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);


// --- v6.9.8: Backtest de mercado Aronson-QRA + sensibilidad trailing + cartera -----------------------
// Investigación retrospectiva. NO sustituye la cohorte prospectiva. Usa el
// Top 100 actual, por lo que existe sesgo de supervivencia. La entrada se hace
// causalmente en la apertura de la vela siguiente a la señal cerrada.
let lastMarketAronsonResult=null;
function btIndicators(c){
  const closes=c.map(x=>x.c),vols=c.map(x=>x.v);
  return {closes,vols,e20:ema(closes,20),e50:ema(closes,50),e200:ema(closes,200),rs:rsi(closes),v20:sma(vols,20),at:atr(c),ax:adx(c)};
}

let historicalUniverseDataset=null;
function histUnixMs(v){
  let n=Number(v); if(!Number.isFinite(n))return NaN;
  // Binance Vision usa microsegundos en spot desde 2025. Normalizamos todo a ms.
  while(n>1e14)n/=1000;
  return Math.round(n);
}
function normalizeHistoricalDataset(raw){
  if(!raw||!Array.isArray(raw.snapshots)) throw new Error("El JSON debe contener snapshots[].");
  const snapshots=raw.snapshots.map(x=>({date:String(x.date||x.asOf||"").slice(0,10),at:histUnixMs(x.at||Date.parse(String(x.date||x.asOf||"")+"T23:59:59Z")),assets:(x.assets||x.symbols||[]).map(a=>typeof a==="string"?{symbol:a.toUpperCase(),rank:null}:{symbol:String(a.symbol||"").toUpperCase(),rank:Number(a.rank||a.cmc_rank||0)||null,id:a.id??null}).filter(a=>a.symbol)})).filter(x=>Number.isFinite(x.at)&&x.assets.length).sort((a,b)=>a.at-b.at);
  if(!snapshots.length) throw new Error("No hay snapshots válidos.");
  const candles={};
  if(raw.candles&&typeof raw.candles==="object") for(const [sym,rows] of Object.entries(raw.candles)){
    candles[String(sym).toUpperCase()]=(rows||[]).map(r=>{const z=Array.isArray(r)?{t:histUnixMs(r[0]),o:+r[1],h:+r[2],l:+r[3],c:+r[4],v:+(r[5]||0),ct:histUnixMs(r[6]||r[0])}:{t:histUnixMs(r.t),o:+r.o,h:+r.h,l:+r.l,c:+r.c,v:+(r.v||0),ct:histUnixMs(r.ct||r.t)};return z;}).filter(r=>Number.isFinite(r.t)&&Number.isFinite(r.c)).sort((a,b)=>a.t-b.t);
  }
  return {version:raw.version||"CQ-HIST-UNIVERSE-1",source:raw.source||"importado",snapshots,candles,meta:raw.meta||{},firstSnapshotAt:snapshots[0].at,lastSnapshotAt:snapshots.at(-1).at};
}
function histSnapshotForTime(at){
  if(!historicalUniverseDataset?.snapshots?.length)return null;
  at=histUnixMs(at);
  const snaps=historicalUniverseDataset.snapshots;
  // Antes del primer snapshot no existe información point-in-time válida: nunca imputar el primer universo hacia atrás.
  if(!Number.isFinite(at)||at<snaps[0].at)return null;
  let ans=null;for(const s of snaps){if(s.at<=at)ans=s;else break;}return ans;
}
function histEligible(symbol,at,maxRank=100){
  const snap=histSnapshotForTime(at);if(!snap)return false;
  const a=snap.assets.find(x=>x.symbol===String(symbol).toUpperCase());return !!a && (!a.rank||a.rank<=maxRank) && !STABLE_ASSETS.has(a.symbol);
}
function histUnionSymbols(maxRank=100){
  if(!historicalUniverseDataset)return [];const set=new Set();for(const s of historicalUniverseDataset.snapshots)for(const a of s.assets)if((!a.rank||a.rank<=maxRank)&&!STABLE_ASSETS.has(a.symbol))set.add(a.symbol);return [...set];
}
async function loadHistoricalUniverseFile(file){
  const raw=JSON.parse(await file.text());historicalUniverseDataset=normalizeHistoricalDataset(raw);
  const unique=histUnionSymbols(100),withCandles=unique.filter(s=>(historicalUniverseDataset.candles[s]||[]).length>=220).length;
  const el=$("#marketBtUniverseStatus");if(el)el.textContent=`Dataset ${historicalUniverseDataset.version}: ${historicalUniverseDataset.snapshots.length} snapshots · ${unique.length} símbolos · ${withCandles} con velas incluidas.`;
}
function btRegimeFromDaily(daily,atTime){
  const prior=daily.filter(x=>Number(x.ct)<Number(atTime));
  if(prior.length<4)return "DESCONOCIDO";
  const last=prior.at(-1),prev=prior.slice(-4,-1).map(x=>x.c);
  return last.c>Math.max(...prev)?"ALCISTA":last.c<Math.min(...prev)?"BAJISTA":"TRANSICIÓN";
}
function btNearestPriorClose(candles,atTime){
  let lo=0,hi=candles.length-1,ans=null;
  while(lo<=hi){const m=(lo+hi)>>1;if(Number(candles[m].ct)<Number(atTime)){ans=candles[m];lo=m+1}else hi=m-1;}
  return ans;
}
function btNearestExitClose(candles,closeTime){
  // Cierre de la vela de benchmark que contiene/termina tras el cierre de la operación.
  for(const x of candles){if(Number(x.ct)>=Number(closeTime))return x;}
  return candles.at(-1)||null;
}
function btVirtualStops(){return {ladder:{status:"open",stopR:-1,resultR:null,maxR:0,closedAt:null,closeIndex:null},trail:{status:"open",stopR:-1,resultR:null,maxR:0,closedAt:null,closeIndex:null}};}
const BT_TRAILING_SENSITIVITY_STEPS=[0.20,0.25,0.30,0.40,0.50];
function btGenericTrailingStopForMaxR(maxR,step){
  step=Number(step);
  if(!Number.isFinite(step)||step<=0) return -1;
  if(maxR<1) return -1;
  if(maxR<1+step-1e-9) return 0;
  const level=Math.floor((maxR+1e-9)/step)*step;
  return Math.max(0,level-step);
}
function btSensitivityBranches(){
  const out={};
  for(const step of BT_TRAILING_SENSITIVITY_STEPS) out[step.toFixed(2)]={status:"open",stopR:-1,resultR:null,maxR:0,closedAt:null,closeIndex:null};
  return out;
}
function btCloseVirtualBranch(branch,bar,index){
  branch.status="closed"; branch.resultR=branch.stopR; branch.closedAt=Number(bar.t); branch.closeIndex=index;
}
function btAdvanceSensitivity(branch,bestR,worstR,step,bar,index){
  if(branch.status!=="open")return;
  // OHLC conservador: primero respetar el stop heredado; luego elevar trailing
  // con el mejor extremo de esta vela y, si el peor extremo también cruza
  // ese nuevo stop, considerar ejecutado el stop dentro de la misma vela.
  const priorStop=branch.stopR;
  if(worstR<=priorStop+1e-9){btCloseVirtualBranch(branch,bar,index);return;}
  branch.maxR=Math.max(branch.maxR,bestR);
  const nextStop=Math.max(priorStop,btGenericTrailingStopForMaxR(branch.maxR,step));
  branch.stopR=nextStop;
  if(worstR<=nextStop+1e-9){btCloseVirtualBranch(branch,bar,index);return;}
}
function btAdvanceBranch(branch,bestR,worstR,kind,bar,index){
  if(branch.status!=="open")return;
  const priorStop=branch.stopR;
  if(worstR<=priorStop+1e-9){btCloseVirtualBranch(branch,bar,index);return;}
  branch.maxR=Math.max(branch.maxR,bestR);
  const candidate=kind==="ladder"?ladderStopForMaxR(branch.maxR):trailing025StopForMaxR(branch.maxR);
  const nextStop=Math.max(priorStop,candidate);
  branch.stopR=nextStop;
  if(worstR<=nextStop+1e-9){btCloseVirtualBranch(branch,bar,index);return;}
}
function btSignedR(side,entry,stopDist,price){return (side==="long"?(price-entry):(entry-price))/stopDist;}
function btSimTrade(symbol,side,score,c,i,feeRate){
  if(i+1>=c.length)return null;
  const entryBar=c[i+1],entry=Number(entryBar.o),stopPct=.03,targetPct=.09,stopDist=entry*stopPct;
  const stop=side==="long"?entry*(1-stopPct):entry*(1+stopPct),target=side==="long"?entry*(1+targetPct):entry*(1-targetPct);
  const virt=btVirtualStops(),sens=btSensitivityBranches(); let close=null,grossR=null,closeIndex=null;
  for(let j=i+1;j<c.length;j++){
    const bar=c[j],bestR=Math.max(btSignedR(side,entry,stopDist,bar.h),btSignedR(side,entry,stopDist,bar.l)),worstR=Math.min(btSignedR(side,entry,stopDist,bar.h),btSignedR(side,entry,stopDist,bar.l));
    btAdvanceBranch(virt.ladder,bestR,worstR,"ladder",bar,j); btAdvanceBranch(virt.trail,bestR,worstR,"trail",bar,j); for(const [k,b] of Object.entries(sens))btAdvanceSensitivity(b,bestR,worstR,Number(k),bar,j);
    const stopHit=side==="long"?bar.l<=stop:bar.h>=stop,targetHit=side==="long"?bar.h>=target:bar.l<=target;
    if(stopHit||targetHit){ // conservador: si ambos ocurren en la misma vela, stop primero
      close=stopHit?stop:target;grossR=stopHit?-1:3;closeIndex=j;break;
    }
  }
  if(close==null)return {symbol,side,score,openedAt:Number(entryBar.t),status:"open",entry};
  // Seguir comparadores virtuales hasta que cierren o se acaben los datos.
  if(virt.ladder.status==="open"||virt.trail.status==="open"||Object.values(sens).some(b=>b.status==="open")){
    for(let j=closeIndex+1;j<c.length;j++){
      const bar=c[j],bestR=Math.max(btSignedR(side,entry,stopDist,bar.h),btSignedR(side,entry,stopDist,bar.l)),worstR=Math.min(btSignedR(side,entry,stopDist,bar.h),btSignedR(side,entry,stopDist,bar.l));
      btAdvanceBranch(virt.ladder,bestR,worstR,"ladder",bar,j);btAdvanceBranch(virt.trail,bestR,worstR,"trail",bar,j);for(const [k,b] of Object.entries(sens))btAdvanceSensitivity(b,bestR,worstR,Number(k),bar,j);
      if(virt.ladder.status!=="open"&&virt.trail.status!=="open"&&Object.values(sens).every(b=>b.status!=="open"))break;
    }
  }
  const feeR=((entry+close)*feeRate)/stopDist,netR=grossR-feeR;
  const branchExitPrice=b=>b?.status==="closed"?(side==="long"?entry+b.resultR*stopDist:entry-b.resultR*stopDist):null;
  return {symbol,side,score,openedAt:Number(entryBar.t),closedAt:Number(c[closeIndex].t),entry,exit:close,grossR,netR,feeR,
    ladderR:virt.ladder.status==="closed"?virt.ladder.resultR:null,ladderExitAt:virt.ladder.closedAt,ladderExitPrice:branchExitPrice(virt.ladder),ladderBarsHeld:virt.ladder.closeIndex!=null?virt.ladder.closeIndex-(i+1)+1:null,
    trailingR:virt.trail.status==="closed"?virt.trail.resultR:null,trailingExitAt:virt.trail.closedAt,trailingExitPrice:branchExitPrice(virt.trail),trailingBarsHeld:virt.trail.closeIndex!=null?virt.trail.closeIndex-(i+1)+1:null,
    trailingSensitivity:Object.fromEntries(Object.entries(sens).map(([k,b])=>[k,b.status==="closed"?b.resultR:null])),
    trailingSensitivityExitAt:Object.fromEntries(Object.entries(sens).map(([k,b])=>[k,b.status==="closed"?b.closedAt:null])),
    trailingSensitivityExitPrice:Object.fromEntries(Object.entries(sens).map(([k,b])=>[k,branchExitPrice(b)])),
    trailingSensitivityBarsHeld:Object.fromEntries(Object.entries(sens).map(([k,b])=>[k,b.closeIndex!=null?b.closeIndex-(i+1)+1:null]))};
}
function btMaxDrawdown(rows,key="netR",weightKey=null){
  let eq=0,peak=0,dd=0; for(const t of [...rows].sort((a,b)=>a.closedAt-b.closedAt)){const w=weightKey?Number(t[weightKey]??1):1;eq+=Number(t[key]||0)*w;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);} return dd;
}
function btSummary(rows,key="netR",weightKey=null){
  const done=rows.filter(t=>t.status!=="open"&&Number.isFinite(Number(t[key]))),n=done.length;
  const vals=done.map(t=>Number(t[key])* (weightKey?Number(t[weightKey]??1):1));
  const total=vals.reduce((a,b)=>a+b,0),wins=vals.filter(v=>v>0).length;
  return {n,total,exp:n?total/n:0,win:n?wins/n*100:0,dd:btMaxDrawdown(done,key,weightKey)};
}
function btPortfolioFromTrailing(rows,step="0.25",capPct=Infinity){
  const key=`trailSens_${String(step).replace(".","_")}`;
  const eligible=rows.filter(t=>Number.isFinite(Number(t[key]))&&Number.isFinite(Number(t.trailingSensitivityExitAt?.[step])));
  const ordered=[...eligible].sort((a,b)=>a.openedAt-b.openedAt || b.score-a.score || String(a.symbol).localeCompare(String(b.symbol)));
  const accepted=[],rejected=[]; let active=[]; let maxConcurrent=0;
  for(const t of ordered){
    // Si sale en la misma marca temporal, aún consume riesgo durante la apertura de esa vela.
    active=active.filter(x=>Number(x.exitAt)>=Number(t.openedAt));
    const currentRisk=active.length;
    if(currentRisk+1<=capPct+1e-9){
      const x={trade:t,exitAt:Number(t.trailingSensitivityExitAt?.[step]),r:Number(t[key])};
      accepted.push(x);active.push(x);maxConcurrent=Math.max(maxConcurrent,active.length);
    }else rejected.push(t);
  }
  const exits=[...accepted].sort((a,b)=>a.exitAt-b.exitAt || a.trade.openedAt-b.trade.openedAt);
  let eq=0,peak=0,dd=0;for(const x of exits){eq+=x.r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}
  return {step,capPct:Number.isFinite(capPct)?capPct:null,signals:eligible.length,accepted:accepted.length,rejected:rejected.length,total:eq,exp:accepted.length?eq/accepted.length:0,dd,maxConcurrent,maxRiskPct:maxConcurrent,acceptRate:eligible.length?accepted.length/eligible.length*100:0};
}
function btFmtPortfolio(name,p){return `<div class="result-card"><span>${name}</span><strong>${p.total>=0?"+":""}${fmt(p.total,2)}R</strong><small>${p.accepted}/${p.signals} señales · exp ${p.exp>=0?"+":""}${fmt(p.exp,3)}R · DD realizado ${fmt(p.dd,2)}R · riesgo máx. ${fmt(p.maxRiskPct,0)}%</small></div>`;}
function btFmtBranch(name,s){return `<div class="result-card"><span>${name}</span><strong>${s.total>=0?"+":""}${fmt(s.total,2)}R</strong><small>${s.n} cerradas · exp ${s.exp>=0?"+":""}${fmt(s.exp,3)}R · DD ${fmt(s.dd,2)}R</small></div>`;}
async function runMarketAronsonBacktest(){
  const btn=$("#runMarketAronsonBtn"),prog=$("#marketBtProgress"),out=$("#marketBtResults"),detail=$("#marketBtDetail");
  btn.disabled=true;btn.textContent="Preparando mercado…";out.classList.add("hidden");detail.classList.add("hidden");
  try{
    const interval=$("#marketBtInterval")?.value||"1h",maxAssets=Number($("#marketBtMaxAssets")?.value||100),bars=Number($("#marketBtBars")?.value||1000),feeRate=Number($("#marketBtFee")?.value||.1)/100;
    const universeMode=$("#marketBtUniverseMode")?.value||"current";
    if(universeMode==="historical"&&!historicalUniverseDataset) throw new Error("Seleccionaste universo histórico, pero no has cargado el JSON point-in-time.");
    if(universeMode==="historical"&&interval!=="1d") throw new Error("El dataset point-in-time importado contiene velas 1D; usa temporalidad Diario.");
    prog.textContent=universeMode==="historical"?"Preparando universo histórico point-in-time estricto y BTC…":"Obteniendo Top 100 actual y BTC de referencia…";
    const universe=(universeMode==="historical"?histUnionSymbols(maxAssets):(await getScannerUniverse()).slice(0,maxAssets));
    const histBTC=historicalUniverseDataset?.candles?.BTC;
    if(universeMode==="historical"&&(!histBTC||histBTC.length<220)) throw new Error("El dataset histórico no contiene suficientes velas BTC 1D; no se permite fallback a datos actuales.");
    const btcSame=(universeMode==="historical"?histBTC.slice(-bars):await getCandles("BTC",interval,bars));
    const btcDaily=(universeMode==="historical"?histBTC.slice(-1000):await getCandles("BTC","1d",1000));
    const all=[];let ok=0,failed=0,excludedNoImported=0,rejectedBeforeFirstSnapshot=0,rejectedNotInSnapshot=0;
    const results=await mapWithConcurrency(universe,4,async(sym,idx)=>{
      prog.textContent=`Descargando y simulando ${idx+1}/${universe.length}: ${sym}…`;
      try{
        const imported=historicalUniverseDataset?.candles?.[sym];
        if(universeMode==="historical"&&(!imported||imported.length<220)){excludedNoImported++;failed++;return [];}
        const c=(universeMode==="historical"?imported.slice(-bars):await getCandles(sym,interval,bars)),ind=btIndicators(c),local=[];
        let activeLongUntil=-1,activeShortUntil=-1;
        for(let i=210;i<c.length-1;i++){
          const signalAt=histUnixMs(c[i].ct||c[i].t);
          if(universeMode==="historical"){
            const snap=histSnapshotForTime(signalAt);
            if(!snap){rejectedBeforeFirstSnapshot++;continue;}
            if(!histEligible(sym,signalAt,maxAssets)){rejectedNotInSnapshot++;continue;}
          }
          const sc=scoreAtIndex(c,i,ind);if(!sc)continue;
          const opts=[];if(sc.longScore>=85)opts.push({side:"long",score:sc.longScore});if(sc.shortScore>=85)opts.push({side:"short",score:sc.shortScore});opts.sort((a,b)=>b.score-a.score);if(!opts.length)continue;
          const pick=opts[0],openAt=Number(c[i+1].t),activeUntil=pick.side==="long"?activeLongUntil:activeShortUntil;if(activeUntil>=openAt)continue;
          const t=btSimTrade(sym,pick.side,pick.score,c,i,feeRate);if(!t)continue;
          t.btcRegime=btRegimeFromDaily(btcDaily,t.openedAt);t.qra01Accepted=!(t.side==="short"&&t.btcRegime==="ALCISTA");
          if(t.status!=="open"){
            const be=btNearestPriorClose(btcSame,t.openedAt),bx=btNearestExitClose(btcSame,t.closedAt);
            if(be&&bx&&be.c>0){const raw=(bx.c/be.c-1)*100,dir=t.side==="long"?raw:-raw;t.benchmarkR=dir/3;t.excessR=t.netR-t.benchmarkR;}
            if(t.ladderR!=null)t.ladderNetR=t.ladderR-((entryFee=>entryFee)(2*feeRate/.03));
            if(t.trailingR!=null)t.trailingNetR=t.trailingR-(2*feeRate/.03);
            t.trailingSensitivityNet={};
            for(const step of BT_TRAILING_SENSITIVITY_STEPS){const k=step.toFixed(2),r=t.trailingSensitivity?.[k];t.trailingSensitivityNet[k]=r==null?null:r-(2*feeRate/.03);}

            if(pick.side==="long")activeLongUntil=t.closedAt;else activeShortUntil=t.closedAt;
          }else{if(pick.side==="long")activeLongUntil=Number.MAX_SAFE_INTEGER;else activeShortUntil=Number.MAX_SAFE_INTEGER;}
          local.push(t);
        }
        ok++;return local;
      }catch(e){failed++;console.warn("market backtest",sym,e);return [];}
    });
    results.forEach(r=>all.push(...r));
    // QRA-03: se calcula cronológicamente sobre las posiciones del control ya abiertas.
    const sorted=[...all].filter(t=>t.status!=="open").sort((a,b)=>a.openedAt-b.openedAt);
    const prior=[];for(const t of sorted){const same=prior.filter(p=>p.side===t.side&&p.closedAt>=t.openedAt);const existingRiskPct=same.length*1;let m=1;if(existingRiskPct>=30)m=0;else if(existingRiskPct>=20)m=.25;else if(existingRiskPct>=10)m=.5;t.qra03Multiplier=m;t.qra03NetR=t.netR*m;prior.push(t);}
    const closed=sorted,qra01=closed.filter(t=>t.qra01Accepted),soloLong=closed.filter(t=>t.side==="long");
    const controlS=btSummary(closed),longS=btSummary(soloLong),q1S=btSummary(qra01),q3S=btSummary(closed,"qra03NetR"),q13S=btSummary(closed.filter(t=>t.qra01Accepted),"qra03NetR");
    const ladderRows=closed.filter(t=>t.ladderNetR!=null),trailRows=closed.filter(t=>t.trailingNetR!=null),ladS=btSummary(ladderRows,"ladderNetR"),trailS=btSummary(trailRows,"trailingNetR"),q1TrailS=btSummary(trailRows.filter(t=>t.qra01Accepted),"trailingNetR");
    const trailingSensitivity={};
    for(const step of BT_TRAILING_SENSITIVITY_STEPS){const k=step.toFixed(2),key=`trailSens_${k.replace(".","_")}`;for(const t of closed)t[key]=t.trailingSensitivityNet?.[k]??null;const rows=closed.filter(t=>t[key]!=null);trailingSensitivity[k]={...btSummary(rows,key),coverage:closed.length?rows.length/closed.length*100:0,long:btSummary(rows.filter(t=>t.side==="long"),key),short:btSummary(rows.filter(t=>t.side==="short"),key),regimes:Object.fromEntries(["ALCISTA","TRANSICIÓN","BAJISTA","DESCONOCIDO"].map(r=>[r,btSummary(rows.filter(t=>t.btcRegime===r),key)]).filter(([,v])=>v.n))};}
    const trailingPortfolio={
      unlimited:btPortfolioFromTrailing(closed,"0.25",Infinity),
      cap10:btPortfolioFromTrailing(closed,"0.25",10),
      cap20:btPortfolioFromTrailing(closed,"0.25",20)
    };

    const bench=closed.filter(t=>Number.isFinite(t.benchmarkR)),benchR=bench.reduce((s,t)=>s+t.benchmarkR,0),excessR=bench.reduce((s,t)=>s+t.excessR,0);
    const regimes={};for(const r of ["ALCISTA","TRANSICIÓN","BAJISTA","DESCONOCIDO"]){const z=closed.filter(t=>t.btcRegime===r);if(z.length)regimes[r]=btSummary(z);}
    const clusters=new Map();closed.forEach(t=>{const k=t.openedAt;clusters.set(k,(clusters.get(k)||0)+1)});const maxCluster=Math.max(0,...clusters.values());
    lastMarketAronsonResult={version:universeMode==="historical"?"CQ-MARKET-BT-ARONSON-6-POINT-IN-TIME-STRICT-INTRABAR":"CQ-MARKET-BT-ARONSON-3-PORTFOLIO",createdAt:new Date().toISOString(),interval,bars,universeCount:universe.length,assetsOk:ok,assetsFailed:failed,pointInTimeAudit:universeMode==="historical"?{strict:true,noNetworkFallback:true,timestampsNormalizedToMs:true,intrabarTrailingConservative:true,firstSnapshotAt:historicalUniverseDataset.firstSnapshotAt,lastSnapshotAt:historicalUniverseDataset.lastSnapshotAt,excludedNoImported,rejectedBeforeFirstSnapshot,rejectedNotInSnapshot}:null,assumptions:{top100:universeMode==="historical"?"Top histórico point-in-time importado":"Top 100 actual (sesgo de supervivencia)",historicalDataset:universeMode==="historical"?{version:historicalUniverseDataset.version,source:historicalUniverseDataset.source,snapshots:historicalUniverseDataset.snapshots.length}:null,threshold:85,stopPct:3,targetPct:9,riskPct:1,feePerSidePct:feeRate*100,entry:"apertura de vela siguiente",sameCandle:"stop antes de target",virtualTrailingIntrabar:"si la misma vela eleva el trailing y también atraviesa el nuevo stop, se ejecuta el nuevo stop en esa vela",qra03:"<10%=1x;10-<20%=0.5x;20-<30%=0.25x;>=30%=0x",trailingSensitivitySteps:BT_TRAILING_SENSITIVITY_STEPS,portfolioTrailingStep:"0.25",portfolioPriority:"score desc, symbol asc within same timestamp",portfolioCapsPct:[10,20]},summaries:{control:controlS,soloLong:longS,qra01:q1S,qra03:q3S,qra01_qra03:q13S,ladder:ladS,trailing025:trailS,qra01_trailing025:q1TrailS},trailingSensitivity,trailingPortfolio,benchmark:{n:bench.length,btcR:benchR,excessR,excessPerTrade:bench.length?excessR/bench.length:0},regimes,clusters:{count:clusters.size,maxSize:maxCluster},trades:closed};
    out.innerHTML=btFmtBranch("Control neto",controlS)+btFmtBranch("Solo LONG",longS)+btFmtBranch("QRA-01",q1S)+btFmtBranch("QRA-03 virtual",q3S)+btFmtBranch("QRA-01 + QRA-03",q13S)+btFmtBranch("Escalera",ladS)+btFmtBranch("Trailing 0.25R",trailS)+btFmtBranch("QRA-01 + Trailing",q1TrailS)+Object.entries(trailingSensitivity).map(([k,v])=>btFmtBranch(`Sensibilidad trailing ${k}R`,v)).join("")+btFmtPortfolio("Cartera 0.25R · sin límite",trailingPortfolio.unlimited)+btFmtPortfolio("Cartera 0.25R · límite 10%",trailingPortfolio.cap10)+btFmtPortfolio("Cartera 0.25R · límite 20%",trailingPortfolio.cap20)+`<div class="result-card"><span>Benchmark BTC</span><strong>${excessR>=0?"+":""}${fmt(excessR,2)}R exceso</strong><small>${bench.length} trades · BTC ${benchR>=0?"+":""}${fmt(benchR,2)}R</small></div>`;
    out.classList.remove("hidden");
    detail.innerHTML=`<h3>Lectura Aronson-QRA</h3><p><b>${universe.length}</b> activos del ${universeMode==="historical"?"universo histórico point-in-time ESTRICTO":"Top 100 actual"} · ${ok} procesados · ${failed} excluidos/fallidos${universeMode==="historical"?` (sin velas importadas: ${excludedNoImported})`:""} · ${closed.length} operaciones cerradas · ${clusters.size} clusters · máximo ${maxCluster} señales simultáneas.</p><p><b>Sensibilidad trailing:</b> ${Object.entries(trailingSensitivity).map(([k,v])=>`${k}R: ${v.total>=0?"+":""}${fmt(v.total,1)}R · exp ${v.exp>=0?"+":""}${fmt(v.exp,3)} · DD ${fmt(v.dd,1)}R`).join(" · ")}.</p><p><b>Cartera 0.25R:</b> sin límite ${trailingPortfolio.unlimited.total>=0?"+":""}${fmt(trailingPortfolio.unlimited.total,1)}R · límite 10% ${trailingPortfolio.cap10.total>=0?"+":""}${fmt(trailingPortfolio.cap10.total,1)}R, ${trailingPortfolio.cap10.accepted}/${trailingPortfolio.cap10.signals} señales, DD realizado ${fmt(trailingPortfolio.cap10.dd,1)}R · límite 20% ${trailingPortfolio.cap20.total>=0?"+":""}${fmt(trailingPortfolio.cap20.total,1)}R, ${trailingPortfolio.cap20.accepted}/${trailingPortfolio.cap20.signals} señales, DD realizado ${fmt(trailingPortfolio.cap20.dd,1)}R. Prioridad cuando coinciden señales: score mayor y luego símbolo.</p><p><b>Regímenes BTC:</b> ${Object.entries(regimes).map(([k,v])=>`${k}: ${v.n} trades, ${v.total>=0?"+":""}${fmt(v.total,1)}R`).join(" · ")||"sin datos"}.</p><p><b>Advertencia metodológica:</b> es investigación retrospectiva. ${universeMode==="historical"?`Modo estricto: sin fallback a la API actual, timestamps ms/µs normalizados, cero señales antes del primer snapshot, pertenencia al Top histórico validada en cada señal y trailing/escalera con ejecución intravela conservadora sobre OHLC diario. Rechazos por fecha previa: ${rejectedBeforeFirstSnapshot}; por no pertenecer al snapshot: ${rejectedNotInSnapshot}.`:"Usa el Top 100 actual, por lo que existe sesgo de supervivencia."} La sensibilidad busca una meseta robusta, no el mejor punto. La validación principal sigue siendo la cohorte prospectiva Aronson-QRA ya congelada.</p>`;detail.classList.remove("hidden");$("#exportMarketBtBtn").classList.remove("hidden");
    prog.textContent=`Terminado${universeMode==="historical"?" ESTRICTO":""} · ${ok}/${universe.length} activos · ${closed.length} cerradas · control ${controlS.total>=0?"+":""}${fmt(controlS.total,2)}R netas.`;
  }catch(e){console.error(e);prog.textContent="Error: "+e.message;alert("No fue posible completar el backtest de mercado: "+e.message);}finally{btn.disabled=false;btn.textContent="Ejecutar backtest de mercado";}
}
function exportMarketAronsonResult(){if(!lastMarketAronsonResult)return alert("Primero ejecuta el backtest de mercado.");const blob=new Blob([JSON.stringify(lastMarketAronsonResult,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`centro-quant-backtest-aronson-${lastMarketAronsonResult.interval}-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
setTimeout(()=>{const b=$("#runMarketAronsonBtn");if(b)b.onclick=runMarketAronsonBacktest;const e=$("#exportMarketBtBtn");if(e)e.onclick=exportMarketAronsonResult;const f=$("#marketBtUniverseFile");if(f)f.onchange=async()=>{try{if(f.files?.[0])await loadHistoricalUniverseFile(f.files[0]);}catch(err){historicalUniverseDataset=null;const st=$("#marketBtUniverseStatus");if(st)st.textContent="Dataset inválido: "+err.message;}};},0);
// -----------------------------------------------------------------------------
