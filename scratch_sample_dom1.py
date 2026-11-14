import zipfile, statistics
pts=[('nord-west',398095,5818998),('nord-mitte',398088,5818995),('nord-knick',398039,5818969),
     ('sued-west',398037,5818965),('sued-mitte',398149,5818945),('sued-ost',398179,5818940)]
R=3.0
buckets={i:[] for i,_,_ in pts}
with zipfile.ZipFile('data/dom1/DOM1_398_5818.zip') as z:
    with z.open(z.namelist()[0]) as f:
        for line in f:
            try: e,n,h=line.split()
            except ValueError: continue
            e=float(e); n=float(n)
            for i,E,N in pts:
                if abs(e-E)<=R and abs(n-N)<=R:
                    buckets[i].append(float(h))
for i,_,_ in pts:
    v=sorted(buckets[i]); k=len(v)
    hist={}
    for h in v: hist[round(h,1)]=hist.get(round(h,1),0)+1
    print(i,'n=',k)
    print('  sorted:', ' '.join(f'{h:.1f}' for h in v))
