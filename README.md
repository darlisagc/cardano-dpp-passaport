# Cardano DPP Passaport

Digital Product Passport (DPP) supply chain on Cardano preprod testnet using TypeScript/Deno.

Implements 4 actors in a battery supply chain:

1. **MineraLitio** (Origem) - Lithium extraction
2. **CellTech** (Celula) - Cell manufacturing
3. **PackMontadora** (Pack) - Battery pack assembly
4. **RecicLar** (Reciclagem) - Recycling

Each actor gets their own wallet, funded with 50 ADA from the main wallet. Credentials are issued via the [UVerify SDK](https://docs.uverify.io) and recorded on-chain.

## Prerequisites

- [Deno](https://deno.land/) >= 2.0
- A Blockfrost API key for preprod ([blockfrost.io](https://blockfrost.io/))
- A funded Cardano preprod wallet (24-word mnemonic with >= 210 ADA)

## Setup

```bash
cp .env.example .env
# Edit .env with your Blockfrost key and wallet mnemonic
```

## Run the full pipeline

```bash
deno task run
```

This will:
1. Generate 4 new actor wallets
2. Fund each with 50 ADA from the main wallet
3. Issue DPP credentials sequentially (origem -> celula -> pack -> reciclagem)
4. Print a summary with tx hashes and verification links

## Verify the chain

```bash
deno task verify
```

Walks the credential chain backward from pack to origin, verifying each credential.

## Architecture

- Each actor has its own wallet (enterprise address, payment-only)
- Funding uses a single transaction with 4 outputs
- Credentials are issued sequentially (each references the previous)
- Uses `@uverify/sdk` for issuance and `@evolution-sdk/evolution` for wallet operations
