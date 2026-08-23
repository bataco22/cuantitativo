#!/usr/bin/env python3
"""Build Centro Quant point-in-time dataset without a paid CoinMarketCap API.

Sources:
  - Public CoinMarketCap historical snapshot pages, one snapshot per month.
  - Binance Vision monthly 1d klines for historical price candles.

Usage (Windows PowerShell):
  py -m pip install requests beautifulsoup4
  py build_point_in_time_dataset_public.py --start 2024-07-01 --end 2026-08-22 --out cq_point_in_time_public.json

The script never needs or stores a CoinMarketCap API key.
"""
import argparse, calendar, csv, io, json, time, zipfile, re
from datetime import date, datetime, timezone
from pathlib import Path
import requests
from bs4 import BeautifulSoup

CMC_PAGE='https://coinmarketcap.com/historical/{ymd}/'
BV='https://data.binance.vision/data/spot/monthly/klines/{pair}/1d/{pair}-1d-{ym}.zip'
STABLE={'USDT','USDC','FDUSD','TUSD','DAI','USDE','USDS','PYUSD','USD1','BUSD','FRAX','LUSD','GUSD','USDP','EURC','EURI'}

# Known historical ticker migrations relevant to Binance spot archives.
# We keep the CMC symbol in snapshots but use aliases only when fetching candles.
BINANCE_ALIASES={
    'MATIC':['MATIC','POL'],
    'FET':['FET'],
    'RNDR':['RNDR','RENDER'],
}

def month_starts(start,end):
    y,m=start.year,start.month
    out=[]
    while (y,m)<=(end.year,end.month):
        d=date(y,m,1)
        if d < start:
            d=start
        if d<=end: out.append(d)
        m+=1
        if m==13:y+=1;m=1
    return out

def parse_cmc_snapshot(html, limit=100):
    """Parse rank/name/symbol from CMC's public historical snapshot HTML."""
    soup=BeautifulSoup(html,'html.parser')
    assets=[]
    # Current public snapshot pages expose a normal table in server-rendered HTML.
    for tr in soup.find_all('tr'):
        tds=tr.find_all('td')
        if len(tds)<3: continue
        rank_txt=tds[0].get_text(' ',strip=True)
        m=re.match(r'^(\d+)$',rank_txt)
        if not m: continue
        rank=int(m.group(1))
        if rank>limit: continue
        name_cell=tds[1]
        name=name_cell.get_text(' ',strip=True)
        symbol=tds[2].get_text(' ',strip=True).upper()
        # Some layouts duplicate symbol inside the name cell. Keep only plausible ticker.
        symbol=re.sub(r'[^A-Z0-9]','',symbol)
        if not symbol or len(symbol)>20: continue
        assets.append({'symbol':symbol,'rank':rank,'name':name})
    # Deduplicate and sort.
    ded={a['rank']:a for a in assets}
    out=[ded[k] for k in sorted(ded) if k<=limit]
    if len(out)<min(80,limit):
        raise RuntimeError(f'CMC snapshot parse returned only {len(out)} ranked assets; page layout may have changed.')
    return out[:limit]

def cmc_public_snapshot(sess,d,limit=100):
    url=CMC_PAGE.format(ymd=d.strftime('%Y%m%d'))
    r=sess.get(url,timeout=40)
    r.raise_for_status()
    return parse_cmc_snapshot(r.text,limit),url

def iter_months(start,end):
    y,m=start.year,start.month
    while (y,m)<=(end.year,end.month):
        yield y,m
        m+=1
        if m==13:y+=1;m=1

def binance_month(sess,symbol,y,m):
    pair=symbol+'USDT'; ym=f'{y:04d}-{m:02d}'; u=BV.format(pair=pair,ym=ym)
    r=sess.get(u,timeout=40)
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

def fetch_symbol_history(sess,sym,start,end):
    aliases=BINANCE_ALIASES.get(sym,[sym])
    all_rows=[]
    for alias in aliases:
        rows=[]
        for y,m in iter_months(start,end):
            try: rows.extend(binance_month(sess,alias,y,m))
            except Exception as e: print('  aviso',alias,y,m,e)
            time.sleep(.02)
        if rows:
            all_rows.extend(rows)
    ded={r[0]:r for r in all_rows}
    return [ded[k] for k in sorted(ded)]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--start',default='2024-07-01')
    ap.add_argument('--end',default='2026-08-22')
    ap.add_argument('--limit',type=int,default=100)
    ap.add_argument('--out',default='cq_point_in_time_public.json')
    args=ap.parse_args()
    start=date.fromisoformat(args.start); end=date.fromisoformat(args.end)
    sess=requests.Session(); sess.headers.update({'User-Agent':'Mozilla/5.0 CentroQuantResearch/1.0','Accept-Language':'en-US,en;q=0.9'})

    snaps=[]
    for d in month_starts(start,end):
        print('ranking',d)
        assets,url=cmc_public_snapshot(sess,d,args.limit)
        snaps.append({'date':d.isoformat(),'at':int(datetime(d.year,d.month,d.day,tzinfo=timezone.utc).timestamp()*1000),'url':url,'assets':assets})
        print(' ',len(assets),'assets')
        time.sleep(.4)

    symbols=sorted({a['symbol'] for s in snaps for a in s['assets'] if a['symbol'] not in STABLE})
    candles={}; missing=[]
    for idx,sym in enumerate(symbols,1):
        print(f'[{idx}/{len(symbols)}] candles {sym}')
        rows=fetch_symbol_history(sess,sym,start,end)
        if rows: candles[sym]=rows
        else: missing.append(sym)

    payload={
      'version':'CQ-HIST-UNIVERSE-PUBLIC-1',
      'source':'CoinMarketCap public historical snapshot pages + Binance Vision monthly 1d',
      'createdAt':datetime.now(timezone.utc).isoformat(),
      'meta':{
        'start':start.isoformat(),'end':end.isoformat(),'rankingCadence':'monthly-first-day',
        'limit':args.limit,'symbolsUnion':len(symbols),'symbolsWithCandles':len(candles),
        'missingCandles':missing,'stableExcluded':sorted(STABLE),
        'methodNote':'For each signal, Centro Quant uses the latest imported snapshot at or before signal time.'
      },
      'snapshots':snaps,'candles':candles
    }
    Path(args.out).write_text(json.dumps(payload,separators=(',',':')),encoding='utf-8')
    print('saved',args.out,'snapshots',len(snaps),'symbols',len(symbols),'with candles',len(candles),'missing',len(missing))

if __name__=='__main__': main()
