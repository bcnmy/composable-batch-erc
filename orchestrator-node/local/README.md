# Local PropAMM environment

A local chain where every PropAMM contract is **already deployed**. Nothing to deploy, no keys to
find, no testnet faucet. The chain state is committed as `anvil-state.json`, so it comes up in about
a second.

```bash
docker compose up anvil        # from orchestrator-node/
```

RPC is `http://localhost:8545`, chain id `31337`. Every address is listed in
[`addresses.env`](addresses.env) and can be sourced directly:

```bash
set -a; source local/addresses.env; set +a
cast code $SETTLEMENT --rpc-url $RPC_URL     # non-empty: it is already there
```

## What is in it

The core contracts land on the **same addresses as mainnet** — they come from the same
`Create2InitFactory` and the same salts, so an address is a function of (factory, salt, initcode)
and not of who deployed it:

| Contract | Address |
|---|---|
| PropAMMSettlement | `0x0000006192062A976eD45E6A33955504C221AB56` |
| PropAMMExecutor | `0x000000D4F7Baa7d6432D63BA98b052B0FdF11DEa` |
| PropAMMHostedSettlement | `0x000000b1f3a8698EE468df1997F76e0ce31fa0C8` |
| OrchestratorRelay | `0x00000066A4De9CF236EEA34798e65e1Edc42A260` |

`PropAMMPuller` is a plain `CREATE`, so its address is local-only — read it from `addresses.env` or
from `hostedSettlement.puller()`.

Permit2 and the two ERC-8211 contracts are copied from Base mainnet at their canonical addresses, so
routes that use runtime values or fee splits behave as they do in production.

Alongside those: two `BasicMMProvider` makers funded with mock WETH/USDC inventory, bound to anvil
accounts 2 and 3 as their ladder signers, and one relay worker (account 4) already registered on the
relay. Account 5 is a funded taker, so the first swap you try works without minting anything.

All keys are anvil's deterministic mnemonic. They are public by design and hold nothing anywhere
else — never reuse them against a real chain.

## Publishing ladders

The makers honour ladders signed by the signer they were constructed with:

`MM_SIGNER_MM1` and `MM_SIGNER_MM2` in `addresses.env` are anvil accounts **2 and 3**. Take the
matching keys from anvil's own startup banner (`docker compose logs anvil`) rather than from a file
here — they are the standard deterministic set, identical on every machine.

Point the node at `RPC_URL` and it will route against both makers.

## Rebuilding

Only needed when the contracts change — the committed dump is otherwise the source of truth:

```bash
set -a; source ~/Projects/stx-contracts/.env; set +a   # for RPC_8453, used to copy Permit2/ERC-8211
./local/build-local-state.sh
```

The script asserts every address has code before it writes the dump, so a partial build fails loudly
rather than producing a state file that looks fine and reverts later.
