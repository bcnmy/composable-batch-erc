import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const RPC_URLS: Record<string, string | undefined> = {
    '8453': env.RPC_BASE,
    '42161': env.RPC_ARBITRUM,
    '10': env.RPC_OPTIMISM,
    '137': env.RPC_POLYGON,
    '1': env.RPC_MAINNET,
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      nodePolyfills({
        include: ['buffer', 'process'],
        globals: { Buffer: true, process: true },
      }),
      // Local dev RPC proxy — mirrors the Vercel serverless function
      {
        name: 'rpc-proxy',
        configureServer(server) {
          server.middlewares.use('/api/rpc', async (req, res) => {
            const url = new URL(req.url!, `http://${req.headers.host}`)
            const chainId = url.searchParams.get('chainId')
            const rpcUrl = chainId ? RPC_URLS[chainId] : undefined

            if (!rpcUrl) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: `No RPC for chain ${chainId}` }))
              return
            }

            const chunks: Buffer[] = []
            req.on('data', (c: Buffer) => chunks.push(c))
            req.on('end', async () => {
              try {
                const response = await fetch(rpcUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: Buffer.concat(chunks),
                })
                const data = await response.text()
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(data)
              } catch (e: any) {
                res.writeHead(502, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: e.message }))
              }
            })
          })
        },
      },
    ],
  }
})
