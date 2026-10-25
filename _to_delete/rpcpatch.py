p='app/api/rpc/route.ts'
s=open(p,encoding='utf-8').read()
a='const RPC_URLS = [\n'
assert s.count(a)==1
s=s.replace(a,'const RPC_URLS = [\n  ...(process.env.NEXT_PUBLIC_SOLANA_RPC ? [process.env.NEXT_PUBLIC_SOLANA_RPC] : []),\n')
open(p,'w',encoding='utf-8').write(s)
print('ok')
