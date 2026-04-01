/**
 * Verify AaveLens source code on block explorers via Etherscan V2 API.
 *
 * One API key from etherscan.io works across all chains.
 * Get a key at https://etherscan.io/myapikey
 *
 * Usage:
 *   npx tsx scripts/verify-aave-lens.ts                          # all chains
 *   npx tsx scripts/verify-aave-lens.ts --chain base              # single chain
 *   npx tsx scripts/verify-aave-lens.ts --address 0x...           # custom address
 */

import 'dotenv/config'
import * as fs from 'fs'
import * as path from 'path'

// Default to v2 address — override with --address flag
const DEFAULT_ADDRESS = '0x927c48cf9aaf2141cc76fdc899be250134deea44'
const CONTRACT_NAME = 'AaveLens'

// Must match forge's actual compilation settings (check out/AaveLens.sol/AaveLens.json metadata)
const COMPILER_VERSION = 'v0.8.27+commit.40a35a09'
const OPTIMIZATION = false
const OPTIMIZATION_RUNS = 200
const EVM_VERSION = 'prague'

const ETHERSCAN_V2_URL = 'https://api.etherscan.io/v2/api'

type ChainInfo = {
  name: string
  chainId: number
  explorerUrl: string
}

const CHAINS: ChainInfo[] = [
  { name: 'Base',     chainId: 8453,  explorerUrl: 'https://basescan.org' },
  { name: 'Arbitrum', chainId: 42161, explorerUrl: 'https://arbiscan.io' },
  { name: 'Optimism', chainId: 10,    explorerUrl: 'https://optimistic.etherscan.io' },
  { name: 'Polygon',  chainId: 137,   explorerUrl: 'https://polygonscan.com' },
  { name: 'Ethereum', chainId: 1,     explorerUrl: 'https://etherscan.io' },
]

function buildStandardJsonInput(): string {
  const sourcePath = path.resolve(__dirname, '../contracts/lens/AaveLens.sol')
  const source = fs.readFileSync(sourcePath, 'utf-8')

  return JSON.stringify({
    language: 'Solidity',
    sources: {
      'contracts/lens/AaveLens.sol': { content: source },
    },
    settings: {
      optimizer: { enabled: OPTIMIZATION, runs: OPTIMIZATION_RUNS },
      evmVersion: EVM_VERSION,
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'] },
      },
    },
  })
}

async function submitVerification(chainId: number, apiKey: string, jsonInput: string, contractAddress: string): Promise<string> {
  // V2 API: chainid goes in the URL query string, not in POST body
  const url = `${ETHERSCAN_V2_URL}?chainid=${chainId}`

  const params = new URLSearchParams({
    apikey: apiKey,
    module: 'contract',
    action: 'verifysourcecode',
    contractaddress: contractAddress,
    sourceCode: jsonInput,
    codeformat: 'solidity-standard-json-input',
    contractname: `contracts/lens/AaveLens.sol:${CONTRACT_NAME}`,
    compilerversion: COMPILER_VERSION,
    optimizationUsed: OPTIMIZATION ? '1' : '0',
    runs: String(OPTIMIZATION_RUNS),
    evmversion: EVM_VERSION,
  })

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  const data = await resp.json()

  if (data.status === '1') {
    return data.result
  }

  throw new Error(`Submission failed: ${data.result ?? data.message}`)
}

async function checkStatus(chainId: number, apiKey: string, guid: string): Promise<string> {
  const url = `${ETHERSCAN_V2_URL}?chainid=${chainId}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${apiKey}`
  const resp = await fetch(url)
  const data = await resp.json()
  return data.result
}

async function waitForVerification(chainId: number, apiKey: string, guid: string): Promise<boolean> {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const status = await checkStatus(chainId, apiKey, guid)

    if (status === 'Pass - Verified') return true
    if (status.includes('Already Verified')) return true
    if (status.includes('Fail')) {
      console.log(`    Failed: ${status}`)
      return false
    }

    console.log(`    Waiting... (${status})`)
  }

  console.log(`    Timed out`)
  return false
}

async function main() {
  const args = process.argv.slice(2)
  const chainFilter = args.find((a, i) => args[i - 1] === '--chain')
  const contractAddress = args.find((a, i) => args[i - 1] === '--address') ?? DEFAULT_ADDRESS

  const apiKey = process.env.ETHERSCAN_API_KEY
  if (!apiKey) {
    console.error('Error: ETHERSCAN_API_KEY not set in .env')
    console.error('Get a free key at https://etherscan.io/myapikey — works for all chains via V2 API')
    process.exit(1)
  }

  const jsonInput = buildStandardJsonInput()

  const chainsToProcess = chainFilter
    ? CHAINS.filter(c => c.name.toLowerCase() === chainFilter.toLowerCase())
    : CHAINS

  if (chainsToProcess.length === 0) {
    console.error(`No chain found matching: ${chainFilter}`)
    process.exit(1)
  }

  console.log(`Verifying ${CONTRACT_NAME} at ${contractAddress}`)
  console.log(`Compiler: ${COMPILER_VERSION} | Optimizer: ${OPTIMIZATION ? 'on' : 'off'} | EVM: ${EVM_VERSION}`)
  console.log(`Using Etherscan V2 unified API`)
  console.log()

  const results: { chain: string; status: string; url: string }[] = []

  for (const chain of chainsToProcess) {
    console.log(`── ${chain.name} (chainId: ${chain.chainId}) ──`)

    try {
      console.log(`  Submitting...`)
      const guid = await submitVerification(chain.chainId, apiKey, jsonInput, contractAddress)
      console.log(`  GUID: ${guid}`)

      const verified = await waitForVerification(chain.chainId, apiKey, guid)
      const url = `${chain.explorerUrl}/address/${contractAddress}#code`

      if (verified) {
        console.log(`  Verified! ${url}`)
        results.push({ chain: chain.name, status: 'verified', url })
      } else {
        results.push({ chain: chain.name, status: 'failed', url })
      }
    } catch (e: any) {
      if (e.message?.includes('Already Verified')) {
        const url = `${chain.explorerUrl}/address/${contractAddress}#code`
        console.log(`  Already verified! ${url}`)
        results.push({ chain: chain.name, status: 'already-verified', url })
      } else {
        console.error(`  Error: ${e.message}`)
        results.push({ chain: chain.name, status: 'error', url: '' })
      }
    }

    console.log()
  }

  console.log('── Summary ──')
  console.log()
  for (const r of results) {
    const icon = r.status.includes('verified') ? '✓' : '✗'
    console.log(`  ${icon} ${r.chain.padEnd(12)} ${r.status.padEnd(20)} ${r.url}`)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
