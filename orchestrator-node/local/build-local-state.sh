#!/usr/bin/env bash
#
# Bakes the LOCAL developer environment into a committed anvil state file.
#
# Run this only when the contracts change. Developers never run it: they run `docker compose up`,
# which starts anvil with `--load-state` and hands them a chain where every PropAMM address already
# has code. Addresses are written to addresses.txt next to the state file (not .env: this
# repo gitignores every env file, and these are public addresses, not secrets).
#
# Needs: anvil, cast, forge, and an archive RPC for Base mainnet (to copy the external dependencies
# that PropAMM expects to already exist on chain: Permit2 and the two ERC-8211 contracts).

set -euo pipefail

CONTRACTS="${CONTRACTS:-$HOME/Projects/propamm-contracts}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$HERE/anvil-state.json"
ADDRESSES="$HERE/addresses.txt"
RPC="http://127.0.0.1:8545"
PORT=8545

# anvil's deterministic mnemonic - these keys are public by design and hold nothing anywhere else.
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266        # acct 0, also relay owner locally
FEE_QUOTE_SIGNER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8  # acct 1
MM1_SIGNER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC        # acct 2
MM2_SIGNER=0x90F79bf6EB2c4f870365E785982E1f101E93b906        # acct 3
RELAY_WORKER=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65      # acct 4
TAKER=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc            # acct 5

# Salts from docs/deploy.md. Local initcode may differ from the audited commit, in which case the
# addresses simply are not the vanity ones - the script reads back whatever was actually deployed.
SETTLEMENT_SALT=0x6fbb4c4a936527dff7bf3e0948c8082bea890b2fbf6a6b9da5e032bc90364c6f
EXECUTOR_SALT=0xe74db34f5f8bf180320abf275ef3e748c3d0ec850645e1e9f7337c30647a98b1
HOSTED_SALT=0x772ea59efba40d1e49417d0b9bf7b1fe4e665c6d352ba8897025275403cbee12
RELAY_SALT=0xccb794245867e0265367a3f234eab53b3f51c0a1ac6e6dcb4fd9b11b92812fa2

PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
ERC8211_MODULE=0x0000821108B5C9F3fe17E40811bE5b66DaF8f0e7
ERC8211_STORAGE=0x00008211dea1Aca67ac55fc44AE3bF88CF41281d

step() { echo ""; echo "==> $*"; }

[ -n "${RPC_8453:-}" ] || { echo "ERROR: RPC_8453 must be set (source it, never print it)" >&2; exit 1; }

step "starting anvil (chain 31337), dumping to $STATE on exit"
rm -f "$STATE"
anvil --chain-id 31337 --port "$PORT" --silent --dump-state "$STATE" &
ANVIL_PID=$!
trap 'kill -INT $ANVIL_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
    cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && break
    sleep 0.2
done
cast block-number --rpc-url "$RPC" >/dev/null || { echo "anvil did not come up" >&2; exit 1; }

step "copying external dependencies from Base mainnet"
# PropAMM assumes these already exist on any chain it runs on. Permit2 rebuilds its domain
# separator when chainid differs from the cached one, so copying its runtime code is sound.
for pair in "Permit2:$PERMIT2" "ERC8211Module:$ERC8211_MODULE" "ERC8211Storage:$ERC8211_STORAGE"; do
    name="${pair%%:*}"; addr="${pair##*:}"
    code="$(cast code "$addr" --rpc-url "$RPC_8453")"
    [ "${#code}" -gt 2 ] || { echo "ERROR: no code for $name at $addr on Base" >&2; exit 1; }
    cast rpc anvil_setCode "$addr" "$code" --rpc-url "$RPC" >/dev/null
    echo "  ✓ $name $addr ($(( (${#code} - 2) / 2 )) bytes)"
done

# Contracts go through the CREATE2 factory, so broadcast/ records the factory call and not each
# contract's address. The scripts print them; parse those lines.
LOGS="$(mktemp -d)"
label_addr() { grep -E "$2" "$1" | grep -oE '0x[0-9a-fA-F]{40}' | head -1; }

step "deploying core (settlement + executor)"
cd "$CONTRACTS"
PRIVATE_KEY=$DEPLOYER_KEY OWNER=$OWNER \
SETTLEMENT_SALT=$SETTLEMENT_SALT EXECUTOR_SALT=$EXECUTOR_SALT \
COMPOSABLE_MODULE=$ERC8211_MODULE FEE_QUOTE_SIGNER=$FEE_QUOTE_SIGNER \
forge script script/DeployCore.s.sol --rpc-url "$RPC" --broadcast > "$LOGS/core.log" 2>&1 \
    || { tail -30 "$LOGS/core.log"; exit 1; }
SETTLEMENT=$(label_addr "$LOGS/core.log" '^ *settlement')
EXECUTOR=$(label_addr "$LOGS/core.log" '^ *executor')

step "deploying hosted settlement + puller + relay"
PRIVATE_KEY=$DEPLOYER_KEY OWNER=$OWNER RELAY_OWNER=$OWNER \
HOSTED_SALT=$HOSTED_SALT RELAY_SALT=$RELAY_SALT \
COMPOSABLE_MODULE=$ERC8211_MODULE PERMIT2=$PERMIT2 \
forge script script/DeployHosted.s.sol --rpc-url "$RPC" --broadcast > "$LOGS/hosted.log" 2>&1 \
    || { tail -30 "$LOGS/hosted.log"; exit 1; }
HOSTED=$(label_addr "$LOGS/hosted.log" '^ *hosted settlement:')
RELAY=$(label_addr "$LOGS/hosted.log" '^ *relay:')
PULLER=$(label_addr "$LOGS/hosted.log" '^ *puller:')

FACTORY=0x8f25c3b327Ce7F29ACB0183285586234BC7086a4
[ "$(cast codesize "$FACTORY" --rpc-url "$RPC")" -gt 0 ] 2>/dev/null || FACTORY=""

step "deploying mock tokens + two MM providers"
PRIVATE_KEY=$DEPLOYER_KEY EXECUTOR=$EXECUTOR \
MM1_SIGNER=$MM1_SIGNER MM2_SIGNER=$MM2_SIGNER TAKER=$TAKER \
forge script script/DeployLocalEnv.s.sol --rpc-url "$RPC" --broadcast > "$LOGS/localenv.log" 2>&1 \
    || { tail -30 "$LOGS/localenv.log"; exit 1; }
WETH=$(label_addr "$LOGS/localenv.log" 'LOCALENV_WETH')
USDC=$(label_addr "$LOGS/localenv.log" 'LOCALENV_USDC')
MM1=$(label_addr "$LOGS/localenv.log" 'LOCALENV_MM1_PROVIDER')
MM2=$(label_addr "$LOGS/localenv.log" 'LOCALENV_MM2_PROVIDER')

for pair in "SETTLEMENT:$SETTLEMENT" "EXECUTOR:$EXECUTOR" "HOSTED:$HOSTED" "RELAY:$RELAY" \
            "PULLER:$PULLER" "WETH:$WETH" "USDC:$USDC" "MM1:$MM1" "MM2:$MM2"; do
    [ -n "${pair##*:}" ] || { echo "ERROR: could not parse ${pair%%:*} from deploy logs" >&2; exit 1; }
done

step "registering the local relay worker"
RELAY_OWNER_PRIVATE_KEY=$DEPLOYER_KEY RELAY=$RELAY RELAY_WORKERS=$RELAY_WORKER \
forge script script/RegisterRelayers.s.sol --rpc-url "$RPC" --broadcast --silent

step "writing $ADDRESSES"
cat > "$ADDRESSES" <<EOF
# PropAMM local environment (anvil, chain 31337). Generated by build-local-state.sh - do not edit.
# Every address below already has code in anvil-state.json. Nothing needs deploying.
CHAIN_ID=31337
RPC_URL=http://127.0.0.1:8545

CREATE2_FACTORY=$FACTORY
SETTLEMENT=$SETTLEMENT
EXECUTOR=$EXECUTOR
HOSTED_SETTLEMENT=$HOSTED
PULLER=$PULLER
RELAY=$RELAY

PERMIT2=$PERMIT2
ERC8211_MODULE=$ERC8211_MODULE
ERC8211_STORAGE=$ERC8211_STORAGE

MOCK_WETH=$WETH
MOCK_USDC=$USDC
MM_PROVIDER_MM1_31337=$MM1
MM_PROVIDER_MM2_31337=$MM2

# anvil's deterministic accounts (public keys, no secrets)
OWNER=$OWNER
FEE_QUOTE_SIGNER=$FEE_QUOTE_SIGNER
MM_SIGNER_MM1=$MM1_SIGNER
MM_SIGNER_MM2=$MM2_SIGNER
RELAY_WORKER=$RELAY_WORKER
TAKER=$TAKER
EOF

step "verifying every address has code"
fail=0
while IFS='=' read -r k v; do
    case "$v" in 0x*) ;; *) continue ;; esac
    case "$k" in OWNER|FEE_QUOTE_SIGNER|MM_SIGNER_*|RELAY_WORKER|TAKER) continue ;; esac
    n=$(cast codesize "$v" --rpc-url "$RPC" 2>/dev/null || echo 0)
    if [ "$n" -gt 0 ]; then printf "  ✓ %-22s %s (%s bytes)\n" "$k" "$v" "$n"
    else printf "  ✗ %-22s %s NO CODE\n" "$k" "$v"; fail=1; fi
done < "$ADDRESSES"
[ "$fail" -eq 0 ] || { echo "ERROR: some addresses have no code" >&2; exit 1; }

step "stopping anvil so it dumps state"
kill -INT $ANVIL_PID
trap - EXIT
wait $ANVIL_PID 2>/dev/null || true
[ -s "$STATE" ] || { echo "ERROR: state dump is empty" >&2; exit 1; }

echo ""
echo "✓ local state baked: $STATE ($(du -h "$STATE" | cut -f1))"
echo "  addresses:        $ADDRESSES"
echo "  developers run:   docker compose up anvil"
