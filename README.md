# DPP Passaport Cardano — TypeScript/Deno

**De Jequitinhonha a Europa: o Passaporte da Bateria**

Este repositorio implementa um **Passaporte Digital de Produto (DPP)** para baterias de veiculos eletricos, ancorado na **blockchain Cardano** (testnet preprod). O caso de uso rastreia toda a cadeia de suprimentos de uma bateria — desde a **extracao de litio** no Vale do Jequitinhonha (Minas Gerais), passando pela **fabricacao de celulas** em Camacari (Bahia), **montagem do pack** em Sao Bernardo do Campo (Sao Paulo), ate a **reciclagem** em Sorocaba (Sao Paulo). Cada etapa da cadeia e registrada como uma credencial on-chain que referencia a anterior, criando um rastro imutavel e verificavel da materia-prima ate o fim de vida.

Os quatro atores da cadeia de suprimentos sao:

| Ator | Empresa | Funcao |
|------|---------|--------|
| **Ator 1** | MineraLitio Jequitinhonha | Extracao de litio (materia-prima) |
| **Ator 2** | CellTech Brasil | Fabricacao de celulas NMC 811 |
| **Ator 3** | PackMontadora SP | Montagem do pack de bateria 75 kWh |
| **Ator 4** | RecicLar Sorocaba | Reciclagem (fim de vida) |

Cada ator **emite** uma credencial contendo dados do produto (GTIN, origem, pegada de carbono, composicao de materiais) e uma referencia (`ref_*_tx`) apontando para a transacao do ator anterior. O **verificador** percorre essa cadeia de tras para frente — da credencial do pack (ou reciclagem) ate a origem do litio — para reconstruir e validar o passaporte completo.

> **Nota sobre carteiras:** Nesta implementacao, **cada ator possui sua propria carteira** (chave privada independente, endereco Enterprise). O pipeline gera 4 novos mnemonicos BIP-39, deriva os enderecos via CIP-1852, e transfere ADA da carteira principal para financiar cada ator. Isso simula o cenario real onde somente a empresa responsavel pode assinar credenciais em seu nome.

> **Rede:** Tudo roda na **testnet preprod do Cardano** — Blockfrost preprod, faucet de tADA, Cexplorer preprod, API UVerify preprod. Nenhum ADA real e utilizado.

---

## Pre-requisitos

| Componente | Descricao |
|------------|-----------|
| [Deno](https://deno.land/) | >= 2.0 — runtime TypeScript sem configuracao |
| Carteira Cardano | [Eternl](https://eternl.io) ou [Lace](https://lace.io) configurada em **preprod** |
| tADA | Obtenha ADA de teste no [faucet preprod](https://docs.cardano.org/cardano-testnets/tools/faucet/) (minimo ~210 ADA) |
| Blockfrost | Conta gratuita em [blockfrost.io](https://blockfrost.io) — crie um projeto **preprod** |

## Setup

```bash
cp .env.example .env     # preencha BLOCKFROST_PROJECT_ID e WALLET_MNEMONIC (SOMENTE TESTNET)
```

Deno resolve as dependencias automaticamente na primeira execucao — nao precisa de `npm install` ou equivalente. As versoes estao fixadas no `deno.lock` (commitado para builds reproduziveis).

## Emissao

Antes de emitir, certifique-se de ter tADA na carteira preprod cujo mnemonico esta em `WALLET_MNEMONIC`.

### Passo a passo (recomendado para workshop)

Emita cada credencial individualmente, entendendo cada etapa:

```bash
# 1. Setup (uma vez) — gera carteiras + financia
deno task setup

# 2. Emissao de credenciais (um por vez, nesta ordem)
deno task issue-origem       # Ator 1 — sem dependencias
deno task issue-celula       # Ator 2 — requer ATOR1_TX no .env
deno task issue-pack         # Ator 3 — requer ATOR2_TX no .env
deno task issue-reciclagem   # Ator 4 — requer ATOR1/2/3_TX no .env

# 3. Verificacao
deno task verify
```

Cada comando salva seu resultado no `.env` (mnemonicos, enderecos, tx hashes, data hashes). O proximo comando le de la automaticamente. Voce pode pausar entre os comandos e retomar mais tarde.

### Pipeline completo (automatizado)

```bash
deno task run
```

Executa o fluxo completo automaticamente:

1. **STEP 0** — Carrega configuracao do `.env`
2. **STEP 1** — Gera 4 novas carteiras (mnemonicos + enderecos Enterprise)
3. **STEP 2** — Transfere ADA para cada carteira (transacao unica, 4 outputs)
4. **STEP 3** — Aguarda confirmacao do funding on-chain
5. **STEP 4** — Emite credenciais sequencialmente via UVerify SDK:
   - Ator 1 (origem) → emite → armazena `ATOR1_TX`
   - Ator 2 (celula) → emite com `ref_origem_tx` → armazena `ATOR2_TX`
   - Ator 3 (pack) → emite com `ref_celula_tx` → armazena `ATOR3_TX`
   - Ator 4 (reciclagem) → emite com `ref_pack_tx`, `ref_celula_tx`, `ref_origem_tx`
6. **STEP 5** — Imprime resumo com tx hashes, links Cexplorer e URLs de verificacao UVerify

A emissao usa o **UVerify SDK** (`@uverify/sdk`), que interage com **smart contracts Plutus V3** na preprod. O modulo de emissao inclui tratamento robusto de erros: preparacao de colateral, retentativas com backoff exponencial, espera por confirmacao on-chain e gerenciamento de UTxOs pendentes.

### Verificacao via navegador

Para verificacao rapida de uma credencial individual (util para demos ou leitura de QR code):

```
https://app.preprod.uverify.io/verify/<DATA_HASH>
```

## Verificacao

```bash
deno task verify
```

O verificador le `DATA_HASH_PACK` e `TX_HASH_PACK` do `.env` e percorre a cadeia de credenciais de tras para frente — pack → celula → origem — reconstruindo e validando o passaporte completo. Funciona tambem a partir de uma credencial de reciclagem (detecta automaticamente pela presenca de `ref_pack_tx`).

## Estrutura do projeto

```
cardano-dpp-passaport/
├── deno.json              # Configuracao do Deno, import maps, tasks
├── deno.lock              # Versoes fixas das dependencias (builds reproduziveis)
├── .env.example           # Template — copie para .env e preencha suas chaves
├── .gitignore
├── README.md
└── src/
    ├── types.ts           # Interfaces TypeScript (ActorWallet, IssuanceResult, PipelineConfig)
    ├── config.ts          # Carrega e valida variaveis do .env
    ├── hash.ts            # Helpers SHA-256 via Web Crypto API (dataHash, hashSerial)
    ├── wallet.ts          # Geracao de carteiras, derivacao de chaves, callbacks de assinatura
    ├── payloads.ts        # Payloads DPP dos 4 atores (dados do produto)
    ├── transfer.ts        # Transferencia de ADA da carteira principal para os 4 atores
    ├── issuer.ts          # Logica de emissao via UVerify SDK (Plutus V3)
    ├── verify.ts          # Verificacao da cadeia de credenciais
    ├── main.ts            # Orquestrador do pipeline completo
    ├── state.ts           # Helpers para persistir estado no .env (appendToEnv, readEnvVar)
    └── cli/
        ├── setup.ts       # CLI: deno task setup (gera carteiras + financia)
        └── issue.ts       # CLI: deno task issue-<ator> (emite credencial individual)
```

### O que cada arquivo faz

| Arquivo | Tipo | Descricao |
|---------|------|-----------|
| `types.ts` | Dados | Define as interfaces centrais: `ActorWallet` (carteira com callbacks de assinatura), `ActorName` (4 atores), `IssuanceResult` (resultado de emissao), `PipelineConfig` (configuracao carregada do `.env`), `DppPayload` e `PayloadResult`. |
| `config.ts` | Core | Carrega variaveis de ambiente do `.env` via `@std/dotenv`, valida `BLOCKFROST_PROJECT_ID` e `WALLET_MNEMONIC` (24 palavras), e retorna um `PipelineConfig` tipado. |
| `hash.ts` | Core | Helpers de hashing SHA-256 usando a Web Crypto API nativa do Deno: `dataHash(gtin, serial)` (fingerprint do produto), `hashSerial(serial)` (serial com privacidade), `mnemonicSuffix(mnemonic)` (sufixo unico por carteira). |
| `wallet.ts` | Core | Gera mnemonicos BIP-39 (24 palavras, 256 bits), deriva enderecos Enterprise via CIP-1852, e cria callbacks de assinatura compativeis com o UVerify SDK. Usa abordagem hibrida: `Client.signTx()` para transacoes e `COSE.SignData.signData()` para mensagens CIP-8. |
| `payloads.ts` | Dados | Define os dados DPP dos 4 atores. Cada payload e um `Record<string, string>` com nome do produto, GTIN, origem, pegada de carbono, composicao de materiais e referencias aos atores anteriores (`ref_*_tx`, `ref_*_data_hash`). Sufixo unico derivado do mnemonico garante `data_hash` distintos por execucao. |
| `transfer.ts` | Emissao | Constroi uma **transacao unica com 4 outputs** para financiar as carteiras dos atores. Usa o `Client` do `@evolution-sdk/evolution` com `newTx().payToAddress()`. Inclui polling de confirmacao via API Blockfrost. |
| `issuer.ts` | Emissao | Emite credenciais via UVerify SDK (`core.buildTransaction()` + `core.submitTransaction()`). Inclui preparacao de colateral para Plutus V3, retentativas com backoff exponencial (ate 8 tentativas), tratamento de UTxOs pendentes e espera por confirmacao on-chain. |
| `verify.ts` | Verificacao | Verificador unificado. Busca credenciais pela API publica UVerify (`GET /api/v1/verify/{dataHash}`), classifica campos por prefixo (`ref_*`, `mat_*`), e percorre a cadeia de referencias ate a origem. Detecta automaticamente se a entrada e pack ou reciclagem. |
| `main.ts` | Orquestrador | Executa o pipeline completo: carrega config → gera carteiras → transfere ADA → aguarda confirmacao → emite credenciais sequencialmente → imprime resumo com links Cexplorer e URLs de verificacao UVerify. |
| `state.ts` | Core | Helpers para persistir estado no `.env`: `appendToEnv(key, value)` escreve/atualiza variaveis, `readEnvVar(key)` le variaveis. Usado pelos comandos CLI passo a passo. |
| `cli/setup.ts` | CLI | Gera 4 carteiras de atores, salva mnemonicos e enderecos no `.env`, financia com tADA e aguarda confirmacao. Equivale aos Steps 0-3 do pipeline completo. |
| `cli/issue.ts` | CLI | Emite a credencial de um unico ator. Aceita o nome do ator como argumento, le prerequisitos do `.env`, emite via UVerify SDK e salva tx hash e data hash no `.env`. |

## Dependencias

| Pacote | Finalidade |
|--------|------------|
| `@uverify/sdk` (npm, >= 0.1.8) | SDK oficial do UVerify para emissao e verificacao de certificados via smart contracts Plutus V3 |
| `@evolution-sdk/evolution` (npm, >= 0.5.9) | SDK Cardano — criacao de carteiras, derivacao de chaves CIP-1852, assinatura de transacoes, assinatura CIP-8 (COSE), construcao e submissao de transacoes |
| `@std/dotenv` (jsr, >= 0.225) | Carrega variaveis de ambiente do arquivo `.env` |

Versoes exatas estao fixadas no `deno.lock` (commitado para builds reproduziveis).

## Troubleshooting

| Problema | Solucao |
|----------|---------|
| `No unlocked UTxOs available` | UTxO da transacao anterior ainda pendente. O codigo faz retentativas automaticas com backoff exponencial. |
| `COLLATERAL_REQUIRED` | O modulo de emissao prepara colateral automaticamente (5 ADA). Se falhar, aguarde a confirmacao da tx anterior. |
| `no utxos found` | Carteira vazia — verifique se o funding tx foi confirmado e se ha ADA suficiente. |
| Timeout na confirmacao | A testnet preprod pode ter blocos mais lentos. O timeout padrao e 90s para emissao e 120s para funding. |
| `Cannot read properties of null` | Status message nulo do UVerify — tratado internamente com null safety. |
