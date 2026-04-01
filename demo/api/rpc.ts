import type { VercelRequest, VercelResponse } from '@vercel/node'

const RPC_URLS: Record<string, string | undefined> = {
  '8453': process.env.RPC_BASE,
  '42161': process.env.RPC_ARBITRUM,
  '10': process.env.RPC_OPTIMISM,
  '1': process.env.RPC_MAINNET,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' })
  }

  const chainId = req.query.chainId as string
  const rpcUrl = RPC_URLS[chainId]

  if (!rpcUrl) {
    return res.status(400).json({ error: `No RPC configured for chain ${chainId}` })
  }

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    })

    const data = await response.json()
    res.status(200).json(data)
  } catch (e: any) {
    res.status(502).json({ error: e.message })
  }
}
