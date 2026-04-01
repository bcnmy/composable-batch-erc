/**
 * Deploy AaveLens to all supported chains via CREATE2 deterministic deployer.
 *
 * Deployer factory: 0x4e59b44847b379578588920cA78FbF26c0B4956C
 * (Arachnid's deterministic deployer — deployed on all major EVM chains)
 *
 * Same salt + same bytecode = same address on every chain.
 *
 * Usage:
 *   npx tsx scripts/deploy-aave-lens.ts            # reads .env
 *   npx tsx scripts/deploy-aave-lens.ts --dry-run   # preview only
 *   npx tsx scripts/deploy-aave-lens.ts --chain base # single chain
 */

import 'dotenv/config'
import {
  createWalletClient,
  createPublicClient,
  http,
  getContractAddress,
  type Address,
  type Chain,
  type Hex,
  concat,
  keccak256,
  encodePacked,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, arbitrum, optimism, polygon, mainnet } from 'viem/chains'
import * as fs from 'fs'
import * as path from 'path'

// ── Config ────────────────────────────────────────────────────

const DETERMINISTIC_DEPLOYER: Address = '0x4e59b44847b379578588920cA78FbF26c0B4956C'

// Salt — bump when bytecode changes to deploy a new version
// v1: 0x01 (original: getSafeBorrowAmount, getSafeWithdrawAmount, getHealthFactor)
// v2: 0x02 (added: getSafeWithdrawAmountWithOracle — oracle-aware withdraw)
const SALT: Hex = '0x0000000000000000000000000000000000000000000000000000000000000002'

const CHAINS: { chain: Chain; rpcEnv: string }[] = [
  { chain: base, rpcEnv: 'RPC_BASE' },
  { chain: arbitrum, rpcEnv: 'RPC_ARBITRUM' },
  { chain: optimism, rpcEnv: 'RPC_OPTIMISM' },
  { chain: polygon, rpcEnv: 'RPC_POLYGON' },
  { chain: mainnet, rpcEnv: 'RPC_MAINNET' },
]

// ── Load bytecode from forge output ───────────────────────────

function loadBytecode(): Hex {
  const artifactPath = path.resolve(
    __dirname,
    '../out/AaveLens.sol/AaveLens.json',
  )
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'))
  return artifact.bytecode.object as Hex
}

// ── Compute CREATE2 address ───────────────────────────────────

function computeCreate2Address(salt: Hex, bytecode: Hex): Address {
  const hash = keccak256(
    encodePacked(
      ['bytes1', 'address', 'bytes32', 'bytes32'],
      ['0xff', DETERMINISTIC_DEPLOYER, salt, keccak256(bytecode)],
    ),
  )
  return `0x${hash.slice(26)}` as Address
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const chainFilter = args.find((a, i) => args[i - 1] === '--chain')

  const pk = process.env.PRIVATE_KEY
  if (!pk) {
    console.error('Error: PRIVATE_KEY env var is required')
    process.exit(1)
  }

  const account = privateKeyToAccount(pk as Hex)
  console.log(`Deployer EOA: ${account.address}`)

  const bytecode = loadBytecode()
  const expectedAddress = computeCreate2Address(SALT, bytecode)
  console.log(`Expected AaveLens address: ${expectedAddress}`)
  console.log(`Bytecode size: ${bytecode.length / 2 - 1} bytes`)
  console.log()

  const chainsToProcess = chainFilter
    ? CHAINS.filter(c => c.chain.name.toLowerCase() === chainFilter.toLowerCase())
    : CHAINS

  if (chainsToProcess.length === 0) {
    console.error(`No chain found matching: ${chainFilter}`)
    process.exit(1)
  }

  const results: { chain: string; status: string; address: string; txHash?: string }[] = []

  for (const { chain, rpcEnv } of chainsToProcess) {
    const rpcUrl = process.env[rpcEnv]
    const transport = rpcUrl ? http(rpcUrl) : http()

    console.log(`── ${chain.name} (${chain.id}) ──`)

    const publicClient = createPublicClient({ chain, transport })

    // Check if already deployed
    const existingCode = await publicClient.getCode({ address: expectedAddress })
    if (existingCode && existingCode !== '0x') {
      console.log(`  Already deployed at ${expectedAddress}`)
      results.push({ chain: chain.name, status: 'already-deployed', address: expectedAddress })
      console.log()
      continue
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would deploy to ${expectedAddress}`)
      results.push({ chain: chain.name, status: 'dry-run', address: expectedAddress })
      console.log()
      continue
    }

    // Check deployer balance
    const balance = await publicClient.getBalance({ address: account.address })
    console.log(`  Deployer balance: ${Number(balance) / 1e18} ${chain.nativeCurrency.symbol}`)

    if (balance === 0n) {
      console.log(`  Skipping — no balance`)
      results.push({ chain: chain.name, status: 'skipped-no-balance', address: expectedAddress })
      console.log()
      continue
    }

    // Deploy via CREATE2 factory: send tx to factory with salt + bytecode as calldata
    const walletClient = createWalletClient({ account, chain, transport })
    const deployData = concat([SALT, bytecode])

    try {
      console.log(`  Deploying...`)
      const txHash = await walletClient.sendTransaction({
        to: DETERMINISTIC_DEPLOYER,
        data: deployData,
      })
      console.log(`  TX: ${txHash}`)

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      console.log(`  Status: ${receipt.status}`)
      console.log(`  Gas used: ${receipt.gasUsed}`)

      // Verify deployment
      const deployedCode = await publicClient.getCode({ address: expectedAddress })
      if (deployedCode && deployedCode !== '0x') {
        console.log(`  Deployed at: ${expectedAddress}`)
        results.push({ chain: chain.name, status: 'deployed', address: expectedAddress, txHash })
      } else {
        console.error(`  WARNING: TX succeeded but no code at expected address!`)
        results.push({ chain: chain.name, status: 'failed-no-code', address: expectedAddress, txHash })
      }
    } catch (e: any) {
      console.error(`  Error: ${e.message}`)
      results.push({ chain: chain.name, status: 'error', address: expectedAddress })
    }

    console.log()
  }

  // Summary
  console.log('── Summary ──')
  console.log()
  for (const r of results) {
    const icon = r.status === 'deployed' || r.status === 'already-deployed' ? '✓' : r.status === 'dry-run' ? '○' : '✗'
    console.log(`  ${icon} ${r.chain.padEnd(12)} ${r.status.padEnd(20)} ${r.address}`)
  }

  console.log()
  console.log(`AaveLens v2 address for chains.ts: '${expectedAddress}'`)
  console.log()
  console.log(`After deploying, update:`)
  console.log(`  1. demo/src/config/chains.ts  → AAVE_LENS = '${expectedAddress}'`)
  console.log(`  2. scripts/verify-aave-lens.ts → CONTRACT_ADDRESS = '${expectedAddress}'`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
