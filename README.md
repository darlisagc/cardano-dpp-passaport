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

### Instalando o Deno

**macOS / Linux:**

```bash
curl -fsSL https://deno.land/install.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://deno.land/install.ps1 | iex
```

**Via Homebrew (macOS):**

```bash
brew install deno
```

Apos a instalacao, verifique com:

```bash
deno --version
```

Para mais detalhes, consulte a [documentacao oficial de instalacao](https://docs.deno.com/runtime/getting_started/installation/).

## Setup

```bash
cp .env.example .env     # preencha BLOCKFROST_PROJECT_ID e WALLET_MNEMONIC (SOMENTE TESTNET)
```

Deno resolve as dependencias automaticamente na primeira execucao — nao precisa de `npm install` ou equivalente. As versoes estao fixadas no `deno.lock` (commitado para builds reproduziveis).

## Modos de emissao

O projeto suporta **dois modos de emissao** de credenciais. Ambos registram os dados DPP on-chain na testnet preprod; a diferenca esta no mecanismo de ancoragem:

| | **UVerify** (padrao) | **Metadata** |
|---|---|---|
| Mecanismo | Smart contracts Plutus V3 via UVerify SDK | Metadados nativos do Cardano (label 1990) |
| Dependencias on-chain | Requer colateral para scripts Plutus | Transacao simples (somente taxa de rede) |
| Verificacao | API UVerify + Blockfrost | Blockfrost diretamente |
| Quando usar | Producao, integracao com ecossistema UVerify | Workshops, demos, ambientes sem smart contracts |

### Como escolher o modo

**Opcao 1 — Variavel de ambiente no `.env`:**

```bash
# No arquivo .env, adicione ou altere:
EMISSION_MODE=metadata    # para metadados nativos
EMISSION_MODE=uverify     # para smart contracts (padrao se omitido)
```

**Opcao 2 — Tasks dedicadas (sem alterar o `.env`):**

Os comandos com sufixo `-metadata` forcam o modo metadata via variavel de ambiente inline:

```bash
deno task issue-origem-metadata   # equivale a EMISSION_MODE=metadata deno task issue-origem
deno task run-metadata            # pipeline completo em modo metadata
```

> **Nota:** O setup (`deno task setup`) e identico para ambos os modos — gera carteiras e financia com tADA. Nao depende de `EMISSION_MODE`.

---

## Emissao

Antes de emitir, certifique-se de ter tADA na carteira preprod cujo mnemonico esta em `WALLET_MNEMONIC`.

### Passo a passo (recomendado para workshop)

Emita cada credencial individualmente, entendendo cada etapa:

**Modo Metadata:**

```bash
# 1. Setup (uma vez) — gera carteiras + financia
deno task setup

# 2. Emissao via metadados nativos (um por vez, nesta ordem)
# Aguarde a confirmacao on-chain de cada transacao antes de emitir a proxima
# (verifique no Cexplorer ou aguarde ~30-40 segundos entre cada comando)
deno task issue-origem-metadata       # Ator 1
deno task issue-celula-metadata       # Ator 2
deno task issue-pack-metadata         # Ator 3
deno task issue-reciclagem-metadata   # Ator 4

# 3. Verificacao — mesmo comando para ambos os modos
deno task verify
```

**Modo UVerify (padrao):**

```bash
# 1. Setup (uma vez) — gera carteiras + financia
deno task setup

# 2. Emissao de credenciais (um por vez, nesta ordem)
# Aguarde a confirmacao on-chain de cada transacao antes de emitir a proxima
# (verifique no Cexplorer ou aguarde ~30-40 segundos entre cada comando)
deno task issue-origem       # Ator 1 — sem dependencias
deno task issue-celula       # Ator 2 — requer ATOR1_TX no .env
deno task issue-pack         # Ator 3 — requer ATOR2_TX no .env
deno task issue-reciclagem   # Ator 4 — requer ATOR1/2/3_TX no .env

# 3. Verificacao
deno task verify
```

Cada comando salva seu resultado no `.env` (mnemonicos, enderecos, tx hashes, data hashes). O proximo comando le de la automaticamente. Voce pode pausar entre os comandos e retomar mais tarde.

### Pipeline completo (automatizado)

**Modo Metadata:**

```bash
deno task run-metadata
```

**Modo UVerify (padrao):**

```bash
deno task run
```

Ambos executam o fluxo completo automaticamente:

1. **STEP 0** — Carrega configuracao do `.env`
2. **STEP 1** — Gera 4 novas carteiras (mnemonicos + enderecos Enterprise)
3. **STEP 2** — Transfere ADA para cada carteira (transacao unica, 4 outputs)
4. **STEP 3** — Aguarda confirmacao do funding on-chain
5. **STEP 4** — Emite credenciais sequencialmente:
   - **UVerify:** via UVerify SDK + smart contracts Plutus V3 (colateral, retentativas, confirmacao)
   - **Metadata:** via transacao com payload no label 1990 (sem smart contracts, somente taxa de rede)
   - Sequencia para ambos os modos:
     - Ator 1 (origem) → emite → armazena `ATOR1_TX`
     - Ator 2 (celula) → emite com `ref_origem_tx` → armazena `ATOR2_TX`
     - Ator 3 (pack) → emite com `ref_celula_tx` → armazena `ATOR3_TX`
     - Ator 4 (reciclagem) → emite com `ref_pack_tx`, `ref_celula_tx`, `ref_origem_tx`
6. **STEP 5** — Imprime resumo com tx hashes, links Cexplorer e URLs de verificacao

**Detalhes tecnicos por modo:**

- **UVerify:** Usa o UVerify SDK (`@uverify/sdk`) com smart contracts Plutus V3. Inclui preparacao de colateral, retentativas automaticas com intervalos crescentes, espera por confirmacao on-chain e gerenciamento de UTxOs pendentes.
- **Metadata:** Usa o evolution-sdk (`@evolution-sdk/evolution`) para construir transacoes com o payload DPP inteiro como metadado nativo sob o label 1990. Paga somente a taxa de rede; o troco retorna para a carteira do ator. Valores maiores que 64 bytes sao automaticamente divididos em arrays (limite do Cardano). Inclui retentativas e confirmacao via Blockfrost.

### Verificacao via navegador

Para verificacao rapida de uma credencial individual emitida via **UVerify** (util para demos ou leitura de QR code):

```
https://app.preprod.uverify.io/verify/<DATA_HASH>
```

Para credenciais emitidas via **Metadata**, use o Cexplorer para inspecionar os metadados da transacao:

```
https://preprod.cexplorer.io/tx/<TX_HASH>
```

## Verificacao

```bash
deno task verify
```

O verificador le `DATA_HASH_PACK` e `TX_HASH_PACK` do `.env` e percorre a cadeia de credenciais de tras para frente — pack → celula → origem — reconstruindo e validando o passaporte completo. Funciona tambem a partir de uma credencial de reciclagem (detecta automaticamente pela presenca de `ref_pack_tx`).

**Funciona independentemente do modo de emissao** — o verificador usa verificacao dual-path:
1. **Blockfrost metadata** (tentado primeiro quando `TX_HASH_PACK` esta disponivel) — busca metadados nativos da transacao (label 1990). Funciona para credenciais emitidas em modo metadata.
2. **UVerify API** (fallback) — consulta `GET /api/v1/verify/{dataHash}`. Funciona para credenciais emitidas em modo UVerify.

Nao e necessario informar qual modo foi usado na emissao; o verificador detecta automaticamente.

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
    ├── issuer-direto.ts   # Logica de emissao via metadados nativos (label 1990)
    ├── verify.ts          # Verificacao da cadeia de credenciais (ambos os modos)
    ├── main.ts            # Orquestrador do pipeline completo (ambos os modos)
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
| `wallet.ts` | Core | Gera mnemonicos BIP-39 (24 palavras, 256 bits), deriva enderecos Enterprise via CIP-1852, e cria callbacks de assinatura compativeis com o UVerify SDK. Usa abordagem hibrida: construcao manual de witness (blake2b-256 + Ed25519 + VKeyWitness) para transacoes e `COSE.SignData.signData()` para mensagens CIP-8. |
| `payloads.ts` | Dados | Define os dados DPP dos 4 atores. Cada payload e um `Record<string, string>` com nome do produto, GTIN, origem, pegada de carbono, composicao de materiais e referencias aos atores anteriores (`ref_*_tx`, `ref_*_data_hash`). Sufixo unico derivado do mnemonico garante `data_hash` distintos por execucao. |
| `transfer.ts` | Emissao | Constroi uma **transacao unica com 4 outputs** para financiar as carteiras dos atores. Usa o `Client` do `@evolution-sdk/evolution` com `newTx().payToAddress()`. Inclui polling de confirmacao via API Blockfrost. |
| `issuer.ts` | Emissao | Emite credenciais via UVerify SDK (`core.buildTransaction()` + `core.submitTransaction()`). Inclui preparacao de colateral para Plutus V3, retentativas automaticas com intervalos crescentes (ate 5 tentativas), tratamento de UTxOs pendentes e espera por confirmacao on-chain. Usado quando `EMISSION_MODE=uverify` (padrao). |
| `issuer-direto.ts` | Emissao | Emite credenciais via metadados nativos do Cardano (label 1990), sem smart contracts. Constroi transacoes com o payload DPP inteiro como metadado (somente taxa de rede; troco retorna para a carteira). Divide valores maiores que 64 bytes em arrays (limite do Cardano). Usado quando `EMISSION_MODE=metadata`. |
| `verify.ts` | Verificacao | Verificador unificado com dual-path: tenta Blockfrost metadata primeiro (label 1990), com fallback para API UVerify (`GET /api/v1/verify/{dataHash}`). Classifica campos por prefixo (`ref_*`, `mat_*`) e percorre a cadeia de referencias ate a origem. Funciona para credenciais emitidas em **ambos os modos** (UVerify e metadata). |
| `main.ts` | Orquestrador | Executa o pipeline completo: carrega config → gera carteiras → transfere ADA → aguarda confirmacao → emite credenciais sequencialmente → imprime resumo. Seleciona automaticamente o modulo de emissao (`issuer.ts` ou `issuer-direto.ts`) com base em `EMISSION_MODE`. |
| `state.ts` | Core | Helpers para persistir estado no `.env`: `appendToEnv(key, value)` escreve/atualiza variaveis, `readEnvVar(key)` le variaveis. Usado pelos comandos CLI passo a passo. |
| `cli/setup.ts` | CLI | Gera 4 carteiras de atores, salva mnemonicos e enderecos no `.env`, financia com tADA e aguarda confirmacao. Equivale aos Steps 0-3 do pipeline completo. |
| `cli/issue.ts` | CLI | Emite a credencial de um unico ator. Aceita o nome do ator como argumento, le prerequisitos do `.env`, emite via UVerify SDK ou metadados nativos (conforme `EMISSION_MODE`) e salva tx hash e data hash no `.env`. |

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
| `No unlocked UTxOs available` | UTxO da transacao anterior ainda pendente. O codigo faz retentativas automaticas com intervalos crescentes. |
| `COLLATERAL_REQUIRED` | O modulo de emissao prepara colateral automaticamente (5 ADA). Se falhar, aguarde a confirmacao da tx anterior. |
| `no utxos found` | Carteira vazia — verifique se o funding tx foi confirmado e se ha ADA suficiente. |
| Timeout na confirmacao | A testnet preprod pode ter blocos mais lentos. O timeout padrao e 90s para emissao e 120s para funding. |
| `Cannot read properties of null` | Status message nulo do UVerify — tratado internamente com null safety. Ocorre apenas no modo UVerify. |
| Credential not found no `verify` | Se emitiu via metadata, o fallback para UVerify API retornara 404 — isso e esperado. O verificador tenta Blockfrost metadata primeiro, que e o caminho correto para modo metadata. Verifique se `TX_HASH_PACK` esta no `.env`. |
| `EMISSION_MODE must be "uverify" or "metadata"` | Valor invalido para `EMISSION_MODE` no `.env`. Use `uverify` ou `metadata` (minusculas). |
