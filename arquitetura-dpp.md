# Arquitetura do DPP — Passaporte Digital de Produto na Cardano

**Documento tecnico de arquitetura do sistema de rastreabilidade de baterias de veiculos eletricos usando blockchain Cardano, UVerify SDK e TypeScript/Deno.**

---

## Indice

- [1. Cadeia de suprimentos](#1-cadeia-de-suprimentos)
- [2. Emissao via UVerify SDK](#2-emissao-via-uverify-sdk)
- [3. Fluxo do verificador](#3-fluxo-do-verificador)
- [4. Estrutura on-chain](#4-estrutura-on-chain)
- [5. Mapa de arquivos](#5-mapa-de-arquivos)
- [6. Analogia — o cartorio digital](#6-analogia--o-cartorio-digital)
- [7. Glossario](#7-glossario)

---

## 1. Cadeia de suprimentos

### Os 4 atores

O DPP modela a cadeia de suprimentos de uma bateria de veiculo eletrico atraves de 4 atores, cada um com **sua propria carteira Cardano**:

```mermaid
graph TB
    subgraph "Carteira Principal"
        MW["Main Wallet<br/>(financia os 4 atores)"]
    end

    subgraph "Ator 1 — MineraLitio"
        W1["Carteira Enterprise<br/>addr_test1..."]
        C1["Credencial: Extracao de litio<br/>GTIN: 7891234560099"]
    end

    subgraph "Ator 2 — CellTech"
        W2["Carteira Enterprise<br/>addr_test1..."]
        C2["Credencial: Celulas NMC 811<br/>GTIN: 7891234560105"]
    end

    subgraph "Ator 3 — PackMontadora"
        W3["Carteira Enterprise<br/>addr_test1..."]
        C3["Credencial: Pack 75 kWh<br/>GTIN: 7891234560112"]
    end

    subgraph "Ator 4 — RecicLar"
        W4["Carteira Enterprise<br/>addr_test1..."]
        C4["Credencial: Reciclagem<br/>GTIN: 7891234560129"]
    end

    MW -->|"50 ADA"| W1
    MW -->|"50 ADA"| W2
    MW -->|"50 ADA"| W3
    MW -->|"50 ADA"| W4

    W1 --> C1
    W2 --> C2
    W3 --> C3
    W4 --> C4

    C1 -->|"ref_origem_tx"| C2
    C2 -->|"ref_celula_tx"| C3
    C1 -->|"ref_origem_tx"| C4
    C2 -->|"ref_celula_tx"| C4
    C3 -->|"ref_pack_tx"| C4
```

### Carteiras independentes por ator

> **Decisao arquitetural:** Cada ator possui uma carteira Enterprise independente (chave privada propria, endereco proprio). Isso reflete a realidade de uma cadeia de suprimentos onde **cada empresa controla suas proprias chaves** e so ela pode assinar credenciais em seu nome.

| Aspecto | Impacto |
|---------|---------|
| **Autenticidade** | Cada credencial e assinada pela chave privada do ator que a emitiu. Um verificador pode confirmar que a empresa X realmente emitiu a credencial Y. |
| **Separacao de responsabilidades** | Nenhum ator pode assinar em nome de outro. |
| **Realismo** | Simula o cenario real onde MineraLitio, CellTech, PackMontadora e RecicLar sao empresas independentes. |
| **Financiamento** | A carteira principal transfere ADA para cada ator via uma unica transacao com 4 outputs. |

O tipo `ActorWallet` define a interface de cada carteira:

```typescript
// src/types.ts
export interface ActorWallet {
  name: ActorName;
  mnemonic: string;
  address: string;
  /** Assina uma tx nao-assinada, retorna witness set CBOR-hex. */
  signTx: (unsignedCborHex: string) => Promise<string>;
  /** Assinatura CIP-8 para operacoes de estado UVerify. */
  signMessage: (message: string) => Promise<{ key: string; signature: string }>;
}
```

### Encadeamento de referencias

As credenciais formam uma **cadeia de referencias** atraves dos campos `ref_*_tx` e `ref_*_data_hash`:

```
Ator 1 (origem)     → Sem referencias (inicio da cadeia)
    |
    | ref_origem_tx + ref_origem_data_hash
    v
Ator 2 (celula)     → Referencia Ator 1
    |
    | ref_celula_tx + ref_celula_data_hash
    v
Ator 3 (pack)       → Referencia Ator 2
    |
    | ref_pack_tx + ref_celula_tx + ref_origem_tx (+ data_hashes)
    v
Ator 4 (reciclagem) → Referencia Atores 1, 2 e 3
```

A reciclagem referencia **todos os 3 atores anteriores** para rastreabilidade reversa completa. Isso permite que qualquer ponto da cadeia possa ser verificado ate a origem da materia-prima.

### Identificacao unica

Cada credencial e identificada por um **`data_hash`** unico:

```
data_hash = sha256(GTIN + serial)
```

O serial inclui um **sufixo determinisico** derivado do mnemonico da carteira principal, garantindo que cada execucao do pipeline gere data_hashes distintos:

```typescript
// src/hash.ts
export async function mnemonicSuffix(mnemonic: string): Promise<string> {
  const full = await sha256hex(mnemonic);
  return full.slice(0, 6);  // 6 primeiros caracteres hex
}

// Serial final: "ML-JQT-2026-05-a1b2c3" (sufixo unico)
```

---

## 2. Emissao via UVerify SDK

### Arquitetura de emissao

A emissao usa o **UVerify SDK** (`@uverify/sdk`) com o fluxo `core.buildTransaction()` + `core.submitTransaction()`. Este fluxo de baixo nivel da controle total sobre os campos de metadados, permitindo incluir os campos customizados `ref_*_tx`.

```mermaid
sequenceDiagram
    participant P as Pipeline (main.ts)
    participant W as ActorWallet
    participant U as UVerify API
    participant C as Cardano (preprod)

    P->>W: createActorWallet(name, mnemonic)
    P->>U: POST /prepare-collateral
    U-->>P: unsignedTx (ou "already available")
    P->>W: signTx(unsignedTx)
    W-->>P: witnessSet
    P->>U: POST /submit (colateral)
    U->>C: Submit colateral tx
    C-->>U: Confirmacao

    Note over P: Aguarda UTxOs assentarem

    P->>U: core.buildTransaction({hash, metadata})
    U-->>P: unsignedTransaction
    P->>W: signTx(unsignedTransaction)
    W-->>P: witnessSet (CBOR-hex)
    P->>U: core.submitTransaction(unsignedTx, witnessSet)
    U->>C: Submit credential tx
    C-->>U: txHash
    U-->>P: txHash

    Note over P: Aguarda confirmacao on-chain
```

### Componentes do fluxo de emissao

#### 1. UVerifyClient

O SDK e instanciado com os callbacks de assinatura do ator:

```typescript
// src/issuer.ts
const client = new UVerifyClient({
  baseUrl: config.uverifyApiUrl,     // https://api.preprod.uverify.io
  signTx: wallet.signTx,             // Client.signTx() do evolution-sdk
  signMessage: wallet.signMessage,   // COSE.SignData.signData()
});
```

#### 2. Preparacao de colateral

Scripts Plutus V3 exigem um UTxO de colateral (>= 5 ADA). O pipeline prepara automaticamente:

```
POST /api/v1/transaction/prepare-collateral
Body: { "senderAddress": "addr_test1..." }

Respostas possiveis:
  - COLLATERAL_ALREADY_AVAILABLE → prossegue
  - unsignedTransaction → assina + submete → aguarda confirmacao
```

#### 3. Construcao da transacao

```typescript
const buildResult = await client.core.buildTransaction({
  type: "default",
  address: wallet.address,
  certificates: [{
    hash: dataHash,              // sha256(gtin + serial)
    algorithm: "SHA-256",
    metadata: payload,           // Record<string, string>
  }],
});
```

O UVerify constroi uma transacao Cardano que:
- Usa o script Plutus V3 do UVerify para registrar a credencial
- Inclui o `data_hash` como identificador
- Armazena os metadados como dados off-chain referenciados pelo hash on-chain

#### 4. Assinatura hibrida

O sistema usa **dois mecanismos de assinatura** distintos:

```mermaid
graph TD
    subgraph "Assinatura de transacao (signTx)"
        TX1["unsignedCborHex"] --> TX2["Client.signTx()"]
        TX2 --> TX3["TransactionWitnessSet.toCBORHex()"]
        TX3 --> TX4["witnessSet CBOR-hex"]
    end

    subgraph "Assinatura CIP-8 (signMessage)"
        MSG1["message (string)"] --> MSG2["COSE.Utils.fromText()"]
        MSG2 --> MSG3["COSE.SignData.signData()"]
        MSG3 --> MSG4["{key: hex, signature: hex}"]
    end
```

| Tipo | Biblioteca | Entrada | Saida | Uso |
|------|-----------|---------|-------|-----|
| **Transaction signing** | `Client.signTx()` (evolution-sdk) | CBOR-hex unsigned tx | CBOR-hex witness set | Emissao de credenciais, colateral |
| **Message signing (CIP-8)** | `COSE.SignData.signData()` (evolution-sdk) | String de mensagem | `{key, signature}` hex | Operacoes de estado UVerify |

A separacao e necessaria porque o `Client.signMessage()` do evolution-sdk retorna o formato wallet-level `SignedMessage`, enquanto o UVerify espera o formato CIP-30 `DataSignature` com `{key, signature}` hex.

#### 5. Resiliencia: retry com backoff exponencial

```typescript
// src/issuer.ts
const MAX_ATTEMPTS = 8;
const INITIAL_DELAY_MS = 10_000;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    // buildTransaction → signTx → submitTransaction
  } catch (e) {
    // "no utxos found" → fatal (carteira vazia)
    // Qualquer outro erro → retry com delay exponencial
    const delay = Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt - 1), 60_000);
    await new Promise((r) => setTimeout(r, delay));
  }
}
```

Tratamento de status especiais:
- `COLLATERAL_REQUIRED` → re-prepara colateral e tenta novamente
- `PENDING_TRANSACTION` → aguarda 30s e tenta novamente
- `no utxos found` → erro fatal (carteira vazia, nao retenta)

---

## 3. Fluxo do verificador

### Arquitetura de verificacao

O verificador usa exclusivamente a **API publica do UVerify** para buscar e validar credenciais:

```mermaid
sequenceDiagram
    participant V as Verificador (verify.ts)
    participant U as UVerify API

    V->>U: GET /api/v1/verify/{dataHash_pack}
    U-->>V: [{metadata, transactionHash, ...}]

    Note over V: Extrai ref_celula_tx e ref_celula_data_hash

    V->>U: GET /api/v1/verify/{dataHash_celula}
    U-->>V: [{metadata, transactionHash, ...}]

    Note over V: Extrai ref_origem_tx e ref_origem_data_hash

    V->>U: GET /api/v1/verify/{dataHash_origem}
    U-->>V: [{metadata, transactionHash, ...}]

    Note over V: Imprime resumo da cadeia
```

### Algoritmo de caminhada na cadeia

```
ENTRADA: data_hash (do pack ou reciclagem) + tx_hash (opcional)

1. Busca credencial por data_hash na API UVerify
   - Se tx_hash fornecido, filtra para match exato
   - Senao, usa primeiro resultado

2. Classifica campos do payload:
   - ref_*_tx → referencias a transacoes anteriores
   - ref_*_data_hash → data_hashes das credenciais anteriores
   - mat_* → composicao de materiais

3. Auto-detecta tipo:
   - Se tem ref_pack_tx → e reciclagem (5 passos)
   - Senao → e pack (4 passos)

4. Segue referencias recursivamente:
   - pack → celula (via ref_celula_data_hash)
   - celula → origem (via ref_origem_data_hash)

5. Imprime resumo: VERIFIED / MISSING para cada etapa
```

### Deteccao automatica de reciclagem

```typescript
// src/verify.ts
if (entry.references["pack_tx"]) {
  // Entrada e reciclagem — segue para pack primeiro
  credReciclagem = entry;
  credPack = await verifyByDataHash(baseUrl, packDh, packTx);
} else {
  // Entrada e pack — inicia a cadeia aqui
  credPack = entry;
}
```

### Ponto de entrada via CLI

```bash
# Adicione ao .env apos a emissao:
DATA_HASH_PACK=789abc...
TX_HASH_PACK=def456...

# Execute:
deno task verify
```

---

## 4. Estrutura on-chain

### Padrao UVerify: anchor on-chain + dados off-chain

O UVerify usa o padrao de **ancora on-chain** com dados armazenados off-chain:

```mermaid
graph LR
    subgraph "On-chain (Cardano)"
        TX["Transacao Cardano<br/>tx_hash: abc123..."]
        SC["Script Plutus V3<br/>(UVerify contract)"]
        AN["Ancora<br/>data_hash → metadata_ref"]
    end

    subgraph "Off-chain (UVerify API)"
        META["Metadados completos<br/>{name, issuer, gtin,<br/>origin, ref_*_tx, mat_*, ...}"]
    end

    TX --> SC
    SC --> AN
    AN -.->|"referencia"| META
```

**O que fica on-chain:**
- Hash da transacao (`tx_hash`)
- Referencia ao script Plutus V3 do UVerify
- Ancora: `data_hash` (sha256 do GTIN + serial)

**O que fica off-chain (UVerify API):**
- Payload completo da credencial (todos os campos `Record<string, string>`)
- Indexado por `data_hash` para busca via `GET /api/v1/verify/{dataHash}`

### Por que este padrao?

| Vantagem | Descricao |
|----------|-----------|
| **Custo** | Armazenar dados completos on-chain seria caro (taxas proporcionais ao tamanho). O hash e minimo. |
| **Privacidade** | Dados sensiveis (serial, composicao detalhada) ficam off-chain, controlados pela API. |
| **Imutabilidade** | O hash on-chain garante que os dados off-chain nao foram alterados — qualquer mudanca invalida o hash. |
| **Verificabilidade** | O verificador busca os dados off-chain e pode recalcular o hash para confirmar integridade. |

### Transacao de emissao — anatomia

Cada credencial gera uma transacao Cardano com esta estrutura:

```
Transacao Cardano
├── Inputs
│   └── UTxO(s) da carteira do ator (inclui ADA para taxa + colateral)
├── Outputs
│   ├── Pagamento ao script UVerify (min UTxO)
│   └── Troco de volta para o ator
├── Scripts
│   └── Plutus V3 reference script (UVerify)
├── Redeemer
│   └── Dados de emissao (hash, algoritmo)
├── Collateral
│   └── UTxO >= 5 ADA (garantia para Plutus)
└── Witnesses
    └── Assinatura da chave de pagamento do ator
```

### Transacao de funding — anatomia

A transacao de financiamento e mais simples (sem scripts):

```
Transacao Cardano (funding)
├── Inputs
│   └── UTxO(s) da carteira principal
├── Outputs
│   ├── 50 ADA → Ator 1 (origem)
│   ├── 50 ADA → Ator 2 (celula)
│   ├── 50 ADA → Ator 3 (pack)
│   ├── 50 ADA → Ator 4 (reciclagem)
│   └── Troco → carteira principal
└── Witnesses
    └── Assinatura da chave de pagamento da carteira principal
```

---

## 5. Mapa de arquivos

### Estrutura do projeto

```
cardano-dpp-passaport/
├── deno.json                    # Configuracao Deno: tasks, import maps, compiler options
├── deno.lock                    # Lock file (builds reproduziveis)
├── .env.example                 # Template de variaveis de ambiente
├── .env                         # Variaveis de ambiente (gitignored)
├── .gitignore
├── README.md                    # Documentacao principal
├── mao-na-massa.md              # Guia pratico (este documento)
├── arquitetura-dpp.md           # Arquitetura (este documento)
└── src/
    ├── types.ts                 # Interfaces e tipos centrais
    ├── config.ts                # Carregamento e validacao do .env
    ├── hash.ts                  # Helpers SHA-256 (Web Crypto API)
    ├── wallet.ts                # Geracao de carteiras e callbacks de assinatura
    ├── payloads.ts              # Payloads DPP dos 4 atores
    ├── transfer.ts              # Transferencia de ADA (funding)
    ├── issuer.ts                # Emissao via UVerify SDK
    ├── verify.ts                # Verificacao da cadeia
    ├── main.ts                  # Orquestrador do pipeline
    ├── simulate-students.ts     # Simulacao de 10 estudantes
    └── verify-all-students.ts   # Verificacao em lote
```

### Diagrama de dependencias entre modulos

```mermaid
graph TD
    MAIN["main.ts<br/>(orquestrador)"] --> CONFIG["config.ts<br/>(carrega .env)"]
    MAIN --> WALLET["wallet.ts<br/>(carteiras)"]
    MAIN --> TRANSFER["transfer.ts<br/>(funding)"]
    MAIN --> ISSUER["issuer.ts<br/>(emissao)"]
    MAIN --> PAYLOADS["payloads.ts<br/>(dados DPP)"]
    MAIN --> TYPES["types.ts<br/>(interfaces)"]

    ISSUER --> PAYLOADS
    ISSUER --> HASH["hash.ts<br/>(SHA-256)"]
    ISSUER --> TYPES

    PAYLOADS --> HASH
    PAYLOADS --> TYPES

    TRANSFER --> WALLET
    TRANSFER --> TYPES

    WALLET --> TYPES

    VERIFY["verify.ts<br/>(verificacao)"] --> CONFIG
    VERIFY --> TYPES

    EVOSDK["@evolution-sdk/evolution"]
    UVSDK["@uverify/sdk"]
    DOTENV["@std/dotenv"]

    WALLET --> EVOSDK
    TRANSFER --> EVOSDK
    ISSUER --> UVSDK
    CONFIG --> DOTENV
```

### Responsabilidade de cada arquivo

| Arquivo | Camada | Dependencias externas | Responsabilidade |
|---------|--------|----------------------|------------------|
| **`types.ts`** | Dados | Nenhuma | Define `ActorName`, `ActorWallet`, `IssuanceResult`, `PipelineConfig`, `DppPayload`, `PayloadResult`. Sem logica, apenas tipos e constantes (`ACTOR_ORDER`, `ACTOR_ENV_KEY`). |
| **`config.ts`** | Infraestrutura | `@std/dotenv` | Carrega `.env`, valida `BLOCKFROST_PROJECT_ID` (nao pode ser placeholder) e `WALLET_MNEMONIC` (deve ter 24 palavras). Retorna `PipelineConfig` tipado. |
| **`hash.ts`** | Core | Nenhuma (Web Crypto API nativa) | Tres funcoes puras: `dataHash(gtin, serial)` para fingerprint do produto, `hashSerial(serial)` para serial com privacidade, `mnemonicSuffix(mnemonic)` para sufixo unico de 6 hex chars. |
| **`wallet.ts`** | Core | `@evolution-sdk/evolution` | `generateMnemonic()` gera BIP-39 256-bit. `createActorWallet()` cria Client com Enterprise address, deriva payment key CIP-1852, monta callbacks `signTx` (via Client) e `signMessage` (via COSE direto). `createMainWalletClient()` cria Client para a carteira principal. |
| **`payloads.ts`** | Dados | `./hash.ts` | Define payloads DPP para os 4 atores com GTINs fixos e seriais dinamicos (sufixo do mnemonico). Cada builder recebe `PayloadEnv` com sufixo e tx hashes anteriores. Retorna `{payload, serial, gtin}`. |
| **`transfer.ts`** | Emissao | `@evolution-sdk/evolution` | `fundActorWallets()` constroi tx unica com 4 outputs (50 ADA cada). `waitForConfirmation()` faz polling na API Blockfrost ate tx aparecer on-chain. |
| **`issuer.ts`** | Emissao | `@uverify/sdk` | `issueAllCredentials()` emite credenciais sequencialmente. Internamente: prepara colateral, faz `core.buildTransaction()` + `signTx()` + `core.submitTransaction()`. Retry com backoff exponencial (8 tentativas, delay inicial 10s, max 60s). |
| **`verify.ts`** | Verificacao | Nenhuma (fetch nativo) | `verifyChain()` busca credenciais por data_hash na API UVerify, classifica campos por prefixo, caminha a cadeia de referencias. Auto-detecta reciclagem. CLI: le `DATA_HASH_PACK` do .env. |
| **`main.ts`** | Orquestrador | Todos os acima | Executa o pipeline de 6 steps: config → carteiras → funding → confirmacao → emissao → resumo. Entry point para `deno task run`. |
| **`simulate-students.ts`** | Utilitario | Todos exceto verify | Simula 10 estudantes executando pipelines independentes. 10 ADA/wallet, 40 wallets total. |
| **`verify-all-students.ts`** | Utilitario | `verify.ts`, `config.ts` | Verifica em lote as credenciais de 10 estudantes com data_hashes pre-definidos. |

### Dependencias npm/jsr

| Pacote | Registro | Versao | Uso |
|--------|----------|--------|-----|
| `@evolution-sdk/evolution` | npm | `^0` (>= 0.5.9) | Carteiras, chaves CIP-1852, assinatura de transacoes, assinatura CIP-8 (COSE), construcao/submissao de transacoes |
| `@uverify/sdk` | npm | `^0` (>= 0.1.8) | Emissao e verificacao de certificados via smart contracts Plutus V3 |
| `@std/dotenv` | jsr | `^0.225` | Carregamento de variaveis de ambiente do `.env` |

> Todas as versoes exatas estao fixadas no `deno.lock` (commitado para builds reproduziveis).

---

## 6. Analogia — o cartorio digital

Para entender o sistema, pense em um **cartorio digital descentralizado**:

### O cartorio tradicional

No mundo fisico, quando voce registra um documento em um cartorio:
1. Voce leva o documento ao cartorio
2. O tabeliao verifica sua identidade
3. O cartorio registra o documento, carimba com selo e assinatura
4. O registro fica nos livros do cartorio (imutavel, publico)
5. Qualquer pessoa pode solicitar uma certidao para verificar a autenticidade

### O cartorio Cardano (UVerify)

No nosso sistema:

| Cartorio tradicional | Cardano + UVerify |
|---------------------|-------------------|
| Documento | Payload DPP (dados do produto) |
| Tabeliao | Smart contract Plutus V3 (UVerify) |
| Assinatura do tabeliao | Hash on-chain (transacao Cardano) |
| Identidade do signatario | Chave privada do ator (Enterprise address) |
| Livro de registro | Blockchain Cardano (imutavel, publico) |
| Certidao de inteiro teor | `GET /api/v1/verify/{dataHash}` |
| Selo do cartorio | `data_hash = sha256(gtin + serial)` |
| Numero do livro/folha | `tx_hash` da transacao Cardano |

### A cadeia de registros

Imagine que cada etapa da fabricacao da bateria precisa ser "autenticada em cartorio":

1. **MineraLitio** vai ao cartorio e registra: "Extraimos litio de alta pureza em Aracuai, MG"
   - Recebe o numero do registro: `tx_hash_origem`

2. **CellTech** vai ao cartorio e registra: "Fabricamos celulas NMC 811 usando litio registrado em `tx_hash_origem`"
   - O cartorio verifica que `tx_hash_origem` existe
   - Recebe o numero do registro: `tx_hash_celula`

3. **PackMontadora** vai ao cartorio e registra: "Montamos o pack 75 kWh com celulas registradas em `tx_hash_celula`"
   - O cartorio verifica que `tx_hash_celula` existe
   - Recebe o numero do registro: `tx_hash_pack`

4. **RecicLar** vai ao cartorio e registra: "Reciclamos o pack registrado em `tx_hash_pack`, com celulas de `tx_hash_celula` e litio de `tx_hash_origem`"
   - Referencia **todos os registros anteriores**

O **verificador** e como alguem que vai ao cartorio e pede: "Me mostre o registro `tx_hash_pack`, e todos os registros que ele referencia." O cartorio (UVerify API) retorna a cadeia completa, verificavel e imutavel.

### A diferenca fundamental

No cartorio tradicional, voce confia no tabeliao (autoridade central). No Cardano:
- **Nao existe autoridade central** — o consenso da rede garante a imutabilidade
- **Qualquer pessoa pode verificar** — a blockchain e publica
- **Ninguem pode alterar** — uma vez registrado, o hash on-chain e imutavel
- **Cada empresa assina com sua propria chave** — como se cada empresa tivesse seu proprio carimbo digital inforjavel

---

## 7. Glossario

| Termo | Descricao |
|-------|-----------|
| **ActorName** | Tipo TypeScript que define os 4 atores: `"origem" \| "celula" \| "pack" \| "reciclagem"`. |
| **ActorWallet** | Interface TypeScript que encapsula uma carteira de ator com endereco, mnemonico e callbacks de assinatura (`signTx`, `signMessage`). |
| **ADA / tADA** | Criptomoeda nativa do Cardano. tADA e ADA de teste (sem valor real). |
| **Backoff exponencial** | Estrategia de retentativa onde o delay dobra a cada tentativa (10s → 20s → 40s → 60s max). |
| **BIP-39** | Padrao para gerar mnemonicos de 24 palavras (256 bits de entropia) que derivam chaves criptograficas deterministas. |
| **Blockfrost** | API-as-a-service para Cardano. Evita a necessidade de rodar um no completo. |
| **CIP-8** | Cardano Improvement Proposal para assinatura de mensagens arbitrarias usando COSE (CBOR Object Signing and Encryption). |
| **CIP-30** | Padrao de interface de carteiras Web para dApps Cardano. Define o formato `DataSignature` (`{key, signature}`). |
| **CIP-1852** | Padrao de derivacao de chaves para Cardano: caminho `m/1852'/1815'/account'/role/index`. |
| **Client** | Classe do `@evolution-sdk/evolution` que encapsula um cliente Cardano com carteira, assinatura e construcao de transacoes. |
| **Colateral** | UTxO (>= 5 ADA) exigido para execucao de scripts Plutus. Se o script falhar, o colateral e consumido para compensar validadores. |
| **COSE** | CBOR Object Signing and Encryption — padrao RFC 8152 para assinatura/criptografia. Usado pelo CIP-8 no formato `COSE_Sign1`. |
| **data_hash** | `sha256(GTIN + serial)` — fingerprint unica do produto. Chave de busca na API UVerify. |
| **Deno** | Runtime TypeScript/JavaScript seguro com sistema de permissoes explicitas. Resolve dependencias por URL/import maps. |
| **DPP** | Digital Product Passport — registro digital rastreavel de um produto ao longo do ciclo de vida. |
| **Enterprise address** | Endereco Cardano sem componente de staking (`addr_test1vz...`). Mais simples, usado para carteiras de servico/aplicacao. |
| **evolution-sdk** | Biblioteca TypeScript (`@evolution-sdk/evolution`) para operacoes Cardano: carteiras, assinatura, construcao de transacoes. |
| **GTIN** | Global Trade Item Number — codigo unico por tipo de produto (equivalente ao EAN/UPC). |
| **Import map** | Mecanismo do Deno (definido no `deno.json`) para mapear identificadores de pacote para URLs reais. |
| **IssuanceResult** | Interface TypeScript com `{actor, txHash, dataHash}` — resultado da emissao de uma credencial. |
| **Lovelace** | Menor unidade de ADA (1 ADA = 1.000.000 lovelace). |
| **Mnemonico** | Sequencia de 24 palavras (BIP-39) que codifica a semente de uma carteira. |
| **PayloadEnv** | Interface TypeScript com o sufixo do mnemonico e tx hashes dos atores anteriores. Passada para os builders de payload. |
| **PipelineConfig** | Interface TypeScript com as configuracoes validadas do `.env` (Blockfrost key, mnemonico, URLs). |
| **Plutus V3** | Versao mais recente da linguagem de smart contracts do Cardano. Os contratos UVerify usam Plutus V3. |
| **Preprod** | Testnet de pre-producao do Cardano. Mesmos parametros da mainnet, usa tADA. |
| **ref_*_tx** | Campo no payload DPP que armazena o tx hash da credencial do ator anterior na cadeia. |
| **ref_*_data_hash** | Campo complementar que armazena o data_hash da credencial anterior (para busca na API UVerify). |
| **SHA-256** | Algoritmo de hash criptografico (256 bits). Usado via Web Crypto API nativa do Deno (`crypto.subtle.digest`). |
| **TransactionWitnessSet** | Conjunto de assinaturas (witnesses) de uma transacao Cardano em formato CBOR. |
| **UVerify** | Plataforma de certificacao on-chain para Cardano. Registra credenciais via smart contracts Plutus V3. |
| **UVerifyClient** | Classe do `@uverify/sdk` que encapsula a interacao com a API UVerify para emissao e verificacao. |
| **UTxO** | Unspent Transaction Output — modelo contabil do Cardano onde cada output pode ser gasto exatamente uma vez. |
| **Web Crypto API** | API nativa de criptografia disponivel em Deno e navegadores. Usada para SHA-256 sem dependencias externas. |
