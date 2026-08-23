#!/usr/bin/env python3
"""Builds a reproducible point-in-time crypto universe JSON for Centro Quant v6.9.9.

Preferred mode: official CoinMarketCap API for historical ranking snapshots (CMC_API_KEY env var).
Price history is downloaded from Binance Vision daily klines when available, including archived months.
The output is imported in Laboratorio > Backtest Mercado Aronson-QRA.

Usage:
  pip install requests
  export CMC_API_KEY='...'
  python build_point_in_time_dataset.py --start 2024-06-30 --end 2026-08-31 --out cq_point_in_time.json
"""
import argparse, calendar, csv, io, json, os, time, zipfile
from datetime import date, datetime, timezone
from pathlib import Path
import requests

CMC='https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/historical'
BV='https://data.binance.vision/data/spot/monthly/klines/{pair}/1d/{pair}-1d-{ym}.zip'
STABLE={'USDT','USDC','FDUSD','TUSD','DAI','USDE','USDS','PYUSD','USD1','BUSD','FRAX','LUSD','GUSD','USDP','EURC','EURI'}

def month_ends(start,end):
    y,m=start.year,start.month
    out=[]
    while (y,m)<=(end.year,end.month):
        d=date(y,m,calendar.monthrange(y,m)[1])
        if d>=start and d<=end: out.append(d)
        m+=1
        if m==13:y+=1;m=1
    if start not in out and start.day!=calendar.monthrange(start.year,start.month)[1]:
        out.insert(0,start)
    return out

def cmc_snapshot(sess,key,d,limit=100):
    r=sess.get(CMC,headers={'X-CMC_PRO_API_KEY':key,'Accept':'application/json'},params={'date':d.isoformat(),'limit':limit,'convert':'USD'},timeout=30)
    r.raise_for_status(); data=r.json()['data']
    return [{'id':x.get('id'),'symbol':x.get('symbol','').upper(),'rank':x.get('cmc_rank'),'name':x.get('name')} for x in data if x.get('symbol')]

def iter_months(start,end):
    y,m=start.year,start.month
    while (y,m)<=(end.year,end.month):
        yield y,m
        m+=1
        if m==13:y+=1;m=1

def binance_month(sess,symbol,y,m):
    pair=symbol+'USDT'; ym=f'{y:04d}-{m:02d}'; u=BV.format(pair=pair,ym=ym)
    r=sess.get(u,timeout=30)
    if r.status_code==404:return []
    r.raise_for_status()
    try:
        z=zipfile.ZipFile(io.BytesIO(r.content)); name=z.namelist()[0]
        text=io.TextIOWrapper(z.open(name),encoding='utf-8')
        out=[]
        for row in csv.reader(text):
            if not row or not row[0].isdigit(): continue
            t=int(row[0]); out.append([t,float(row[1]),float(row[2]),float(row[3]),float(row[4]),float(row[5]),int(row[6])])
        return out
    except zipfile.BadZipFile:return []

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--start',default='2024-06-30');ap.add_argument('--end',default=date.today().isoformat());ap.add_argument('--limit',type=int,default=100);ap.add_argument('--out',default='cq_point_in_time.json');args=ap.parse_args()
    start=date.fromisoformat(args.start);end=date.fromisoformat(args.end);key=os.getenv('CMC_API_KEY')
    if not key: raise SystemExit('Falta CMC_API_KEY. CoinMarketCap listings/historical requiere plan/API key.')
    sess=requests.Session(); sess.headers['User-Agent']='CentroQuant-Research/1.0'
    snaps=[]
    for d in month_ends(start,end):
        print('ranking',d); assets=cmc_snapshot(sess,key,d,args.limit); snaps.append({'date':d.isoformat(),'assets':assets});time.sleep(.25)
    symbols=sorted({a['symbol'] for s in snaps for a in s['assets'] if a['symbol'] not in STABLE})
    candles={}
    for idx,sym in enumerate(symbols,1):
        rows=[];print(f'[{idx}/{len(symbols)}] candles {sym}')
        for y,m in iter_months(start,end):
            try: rows.extend(binance_month(sess,sym,y,m))
            except Exception as e: print('  aviso',y,m,e)
            time.sleep(.03)
        if rows:
            ded={r[0]:r for r in rows};candles[sym]=[ded[k] for k in sorted(ded)]
    payload={'version':'CQ-HIST-UNIVERSE-1','source':'CoinMarketCap listings/historical + Binance Vision monthly 1d','createdAt':datetime.now(timezone.utc).isoformat(),'meta':{'start':start.isoformat(),'end':end.isoformat(),'rankingCadence':'month-end','limit':args.limit,'symbolsUnion':len(symbols),'symbolsWithCandles':len(candles)},'snapshots':snaps,'candles':candles}
    Path(args.out).write_text(json.dumps(payload,separators=(',',':')))
    print('saved',args.out,'snapshots',len(snaps),'symbols',len(symbols),'with candles',len(candles))
if __name__=='__main__':main()
