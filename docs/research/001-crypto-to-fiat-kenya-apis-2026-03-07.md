# Crypto-to-Fiat Payment Platform (Kenya) - API & Infrastructure Research

**Date**: 2026-03-07
**Purpose**: Technical research for a crypto-to-KES payment/off-ramp platform

---

## 1. Exchange APIs for Liquidity (Crypto to KES Conversion)

### Tier 1: Direct KES Liquidity

#### Binance P2P
- **KES Support**: Yes - USDT/KES and BTC/KES via P2P marketplace
- **Payment Methods**: M-Pesa (Safaricom), Co-Operative Bank, other Kenyan banks
- **P2P API**: Limited - no official public P2P API. SAPI endpoints exist but undocumented
- **Spot API**: Full REST + WebSocket at developers.binance.com. No direct KES spot pairs
- **Liquidity**: Deepest KES P2P liquidity of any global exchange
- **Fees**: Zero P2P transaction fees
- **Strategy**: Use P2P for KES settlement, spot API for crypto-to-USDT conversion
- **Limitation**: P2P is manual/semi-automated; not suitable for instant programmatic off-ramp

#### Luno
- **KES Support**: Direct KES trading pairs - BTC/KES, ETH/KES, USDT/KES, USDC/KES
- **Payment Methods**: M-Pesa, bank transfer
- **API**: REST API for trading, deposits, withdrawals
- **Fees**: 0% maker, ~0.10% taker
- **Liquidity**: Moderate - tailored for East African market
- **Best for**: Direct KES order book liquidity (not P2P)
- **Note**: Re-launched in Kenya with local trading features

#### VALR
- **KES Support**: Via MoonPay integration (34 fiat currencies including KES)
- **Base**: South Africa (ZAR primary currency)
- **API**: REST + WebSocket at docs.valr.com
- **Requires**: 2FA enabled for API key generation
- **Best for**: ZAR liquidity; KES is indirect

### Tier 2: P2P KES Access (No Direct KES Order Books)

#### OKX
- **KES Access**: P2P marketplace with M-Pesa support
- **API**: Institutional-grade REST API, bot marketplace
- **Spot Liquidity**: Excellent for major pairs (no KES spot)
- **Best for**: Crypto-to-USDT conversion, then P2P for KES

#### Bybit
- **KES Access**: P2P marketplace
- **API**: REST + WebSocket, strong derivatives API
- **Best for**: Active trading, derivatives hedging

#### KuCoin
- **KES Access**: P2P marketplace
- **API**: REST API with real-time market data, trade execution
- **Known for**: Early altcoin listings, margin lending marketplace

#### Kraken
- **KES Support**: No direct KES pairs
- **API**: Well-documented REST + WebSocket
- **Fiat Pairs**: 7 fiat currencies (USD, EUR, GBP, CAD, AUD, JPY, CHF) - no KES
- **Best for**: Fiat off-ramp to USD/EUR, not suitable for direct KES

### Unified Exchange Library: CCXT

- **URL**: github.com/ccxt/ccxt
- **Languages**: JavaScript/TypeScript, Python, C#, PHP, Go
- **Exchanges**: 107+ supported (Binance, OKX, Bybit, KuCoin, Kraken, etc.)
- **Features**: Unified API across all exchanges, camelCase + underscore notation
- **License**: MIT (free, open source)
- **Recommendation**: Use CCXT as the abstraction layer for multi-exchange liquidity aggregation

---

## 2. On-Ramp / Off-Ramp Providers

### Africa-Focused (PRIMARY RECOMMENDATIONS)

#### Yellow Card API (TOP PICK for Kenya)
- **Coverage**: 34 countries including 20 in Africa (Kenya included)
- **API Docs**: docs.yellowcard.engineering
- **Currencies**: 50+ including KES, NGN, ZAR, GHS, UGX
- **Stablecoins**: USDT, USDC
- **Integration**: REST API or embeddable Widget (iframe)
- **Clients**: Coinbase, Block (Square) use Yellow Card rails
- **Funding**: $33M Series C (Blockchain Capital, 2024)
- **B2B Focus**: 30,000+ businesses across Africa
- **Sandbox**: Available for testing
- **Best for**: Programmatic off-ramp from stablecoin to KES via M-Pesa/bank

#### Kotani Pay API (TOP PICK for Kenya)
- **Coverage**: Kenya, Ghana, Zambia, South Africa
- **API Docs**: docs.kotanipay.com
- **Key Feature**: USSD off-ramp (works WITHOUT internet)
- **M-Pesa**: Native integration
- **Backed by**: Tether (strategic investment, Oct 2025)
- **Integration**: API, Widget, USSD
- **Web3 Focus**: Designed for dApps, blockchain protocols
- **Best for**: Reaching unbanked users via USSD/M-Pesa, Web3-native off-ramp

#### AZA Finance (formerly BitPesa)
- **Coverage**: 30+ currencies across Africa and G20
- **Founded**: 2013 (first company to trade crypto with mobile money)
- **Services**: Cross-border payments, FX, treasury management
- **API**: REST API + web platform
- **Status**: Acquired by dLocal (total $57M raised before acquisition)
- **Best for**: B2B cross-border payments, FX corridors

### Global Providers

#### MoonPay
- **Coverage**: 160+ countries
- **Integration**: Combined on-ramp + off-ramp in single widget
- **Payment Methods**: Cards, bank transfers, Apple Pay, Google Pay
- **Fees**: ~1% bank transfer, up to ~4.5% card
- **Africa**: Partners with VALR for African crypto access
- **KES**: Supported via VALR partnership

#### Transak
- **Coverage**: 64+ countries, 136+ cryptocurrencies
- **Integration**: Customizable widget/SDK for wallets, dApps, NFT marketplaces
- **Fees**: ~1% per transaction + configurable partner fees
- **Africa/KES**: Limited direct KES support

#### Ramp Network
- **Coverage**: 150+ countries
- **Integration**: Widget, SDK, or API
- **Fees**: 0.49% - 2.9% depending on method/region
- **Payment Methods**: Visa/MC, Apple Pay, Google Pay, SEPA, Open Banking
- **Africa/KES**: Limited

#### Onramper (Aggregator)
- **What**: Aggregates multiple on-ramp providers (MoonPay, Transak, etc.)
- **Partners**: Yellow Card (for African coverage)
- **Best for**: Single integration point for multiple providers

#### Flutterwave (Crypto via Polygon)
- **Major Development**: Selected Polygon as default blockchain for cross-border payments
- **Stablecoin**: USDC pilot for cross-border merchant transactions
- **Rollout**: Enterprise first (2025), consumer via Send App (2026)
- **API**: Existing Flutterwave API - no changes needed for blockchain features
- **Mono Acquisition**: Open banking APIs for bank account verification + settlement
- **Coverage**: 30+ African countries
- **Best for**: Merchant crypto acceptance; not a pure off-ramp API yet

---

## 3. Blockchain Infrastructure

### Chains to Support (Priority Order for Kenya)

| Chain | Why | Block Time | Confirmations | Settlement |
|-------|-----|-----------|---------------|------------|
| **USDT on Tron (TRC-20)** | Cheapest fees, most used in Africa P2P | ~3s | 19 blocks | ~1 min |
| **USDC on Polygon** | Flutterwave integration, low fees | ~2s | 128 blocks | ~4 min |
| **USDT/USDC on Ethereum (ERC-20)** | Highest liquidity globally | ~12s | 12-30 blocks | 2-6 min |
| **Bitcoin (BTC)** | Store of value, remittances | ~10 min | 3-6 blocks | 30-60 min |
| **USDT on BSC (BEP-20)** | Low fees, popular in emerging markets | ~3s | 15 blocks | ~45s |
| **Solana (SOL/USDC)** | Fast, cheap, growing DeFi | ~0.4s | 32 blocks | ~13s |
| **Ethereum (ETH)** | DeFi ecosystem | ~12s | 12 blocks | ~2.5 min |

**Recommendation**: Start with USDT (TRC-20 + ERC-20) and USDC (Polygon + Ethereum). These cover 80%+ of African crypto volume. Add BTC and SOL in phase 2.

### Wallet Infrastructure

#### Fireblocks (ENTERPRISE - recommended for scale)
- **Technology**: MPC-CMP protocol (no single point of failure for private keys)
- **Wallets**: Hot, warm, cold configurations
- **Chains**: 40+ native blockchain support
- **API**: Full REST API for wallet creation, transfers, whitelisting
- **Vault Structures**: Segregated (per-user) or omnibus
- **Security**: Key shares split across multiple parties via MPC
- **Pricing**: Enterprise pricing (typically $1000+/month minimum)
- **Best for**: Production-grade custody at scale

#### BitGo (ENTERPRISE - publicly traded)
- **Technology**: Multi-sig HD wallets (2-of-3 key scheme)
- **Key Management**: BitGo holds 1 key, wallet owner holds 2
- **API**: RESTful APIs for wallet creation, management, reporting
- **Insurance**: Up to $250M on custodial wallets
- **Status**: Federally chartered crypto bank (Dec 2025), IPO Jan 2026 ($212M raised)
- **Chains**: 50+ countries supported
- **Policy Engine**: Granular controls for transaction limits, velocity, permissions
- **Best for**: Institutional-grade multi-sig custody

#### Self-Hosted HD Wallet Generation (BUDGET option)
- **Libraries**: ethers.js / web3.js (Ethereum), bitcoinjs-lib (Bitcoin), @solana/web3.js
- **BIP-32/44**: Standard HD wallet derivation paths
- **Pattern**: Master seed -> derivation path per user -> unique deposit address
- **Security**: Store master seed in HSM or encrypted vault (AWS KMS, HashiCorp Vault)
- **Multi-sig**: Use smart contracts (Safe/Gnosis) for Ethereum, native multi-sig for Bitcoin
- **Risk**: Full responsibility for key management, no insurance
- **Best for**: MVP/early stage, migrate to Fireblocks/BitGo at scale

### Recommended Architecture

```
Phase 1 (MVP):
  - Self-hosted HD wallets (ethers.js + bitcoinjs-lib)
  - Master seed in AWS KMS or HashiCorp Vault
  - Yellow Card API for KES off-ramp
  - Kotani Pay as backup off-ramp

Phase 2 (Scale):
  - Migrate to Fireblocks MPC wallets
  - Multi-exchange liquidity via CCXT
  - Add Flutterwave for merchant settlements
```

---

## 4. Price Feeds / Oracle APIs

### Off-Chain Price APIs

#### CoinGecko API (RECOMMENDED for backend)
- **Free Tier**: 30 calls/min, 10,000 calls/month
- **Coverage**: 13M+ tokens, 1,500+ exchanges, 200+ networks
- **Endpoints**: 70+ (prices, OHLC, on-chain data, DEX trades)
- **Historical**: 1 year on free tier
- **Pricing**: Free (Demo) -> Analyst ($49/mo) -> Lite ($129/mo) -> Pro ($499/mo)
- **Best for**: General price data, market overview, portfolio tracking

#### CoinMarketCap API
- **Free Tier**: 10,000 credits/month (~333 calls/day), 11 endpoints
- **Coverage**: 2.4M+ tokens, 790+ exchanges
- **Endpoints**: 40+ (prices, market caps, OHLCV)
- **Full Access**: Professional plan $699/mo (35 endpoints)
- **Owner**: Binance
- **Best for**: Institutional data needs, higher-tier plans

### On-Chain Oracles (for smart contract integration)

#### Chainlink Data Feeds
- **Architecture**: Decentralized oracle network (DON) with aggregated median prices
- **Interface**: AggregatorV3Interface (latestRoundData function)
- **Components**: Consumer -> Proxy -> Aggregator contracts
- **Chains**: Ethereum, Polygon, BSC, Arbitrum, Optimism, Solana, etc.
- **Pairs**: Major crypto/USD pairs (no direct KES feeds)
- **Cost**: Free to read on-chain (gas only)
- **Best for**: Smart contract price validation, DeFi integrations
- **Limitation**: No KES price feeds; need off-chain API for KES rates

### KES Rate Strategy

Since no oracle provides direct crypto/KES feeds:
1. Use CoinGecko for crypto/USD prices
2. Use Yellow Card API for real-time USD/KES or USDT/KES rates
3. Cross-reference with Luno's KES order book for market rates
4. Calculate composite rate: crypto -> USD (CoinGecko) -> KES (Yellow Card/Luno)

---

## 5. Key Considerations

### Slippage Management for KES Pairs

- **Problem**: KES pairs have thin order books compared to USD/EUR
- **Binance P2P spread**: Varies 1-3% depending on volume and market conditions
- **Luno KES spread**: Tighter than P2P but lower volume
- **Mitigation strategies**:
  - Quote locks: Lock price for 30-60 seconds during user confirmation
  - Split large orders across multiple liquidity sources
  - Maintain USDT/KES reserves for instant settlement
  - Use limit orders on Luno for better execution
  - Monitor Yellow Card rates vs Luno rates for best execution

### Liquidity Depth for KES Trading Pairs

- **Best KES liquidity**: USDT/KES (Binance P2P) > BTC/KES (Luno) > USDC/KES (Luno)
- **Daily P2P volume**: Binance KES P2P handles millions in daily volume
- **Recommendation**: Route through USDT as intermediate (any crypto -> USDT -> KES)
- **USDT is king in Africa**: Most P2P volume is USDT, not BTC or ETH

### Settlement Time Requirements

| Method | Settlement Time |
|--------|----------------|
| Yellow Card off-ramp to M-Pesa | Near-instant to minutes |
| Kotani Pay off-ramp to M-Pesa | Near-instant (USSD) |
| Luno KES withdrawal to M-Pesa | Minutes to hours |
| Binance P2P to M-Pesa | Manual, 5-30 min per trade |
| Bank transfer | 1-3 business days |

### Best Cryptos for KES Liquidity (Ranked)

1. **USDT** - Dominant stablecoin in African P2P markets
2. **BTC** - Strong P2P and exchange liquidity
3. **USDC** - Growing via Flutterwave/Polygon, Yellow Card
4. **ETH** - Good exchange liquidity, less P2P
5. **BNB** - Some Binance P2P activity
6. **SOL** - Growing but limited KES pairs

---

## 6. Double-Payment Prevention

### Transaction Idempotency Patterns

```
Architecture:
1. Client generates unique idempotency_key (UUID v4) per payment intent
2. Server stores: {idempotency_key, status, created_at, result}
3. On duplicate request with same key:
   - If previous completed -> return cached result
   - If previous in-progress -> return 409 Conflict
   - If previous failed -> allow retry
4. TTL: 24-48 hours for idempotency records
5. Database: UNIQUE constraint on idempotency_key column
```

**Implementation**:
- Redis for fast idempotency lookups (SET NX with TTL)
- PostgreSQL for durable record (unique constraint on payment_id + idempotency_key)
- Nonce per user: auto-incrementing, reject if nonce <= last_processed_nonce

### Blockchain Confirmation Requirements

| Chain | Min Confirmations (Small) | Min Confirmations (Large) | Finality Time |
|-------|--------------------------|--------------------------|---------------|
| Bitcoin | 1 (~10 min) | 6 (~60 min) | Probabilistic |
| Ethereum | 12 (~2.5 min) | 32 (~6.5 min) | Finalized at epoch |
| Tron (TRC-20) | 19 (~1 min) | 19 (~1 min) | Fast finality |
| Polygon | 128 (~4 min) | 256 (~8 min) | Checkpointed to ETH |
| BSC | 15 (~45s) | 50 (~2.5 min) | Fast finality |
| Solana | 32 (~13s) | 32 (~13s) | Fast finality |

**Threshold Strategy**:
- Under $100: Accept at minimum confirmations
- $100-$1000: Wait for standard confirmations
- Over $1000: Wait for full finality

### Nonce Management

- **Ethereum nonce**: Sequential per-address transaction counter. Track locally + query chain
- **Gap handling**: If nonce 5 is pending and nonce 6 is submitted, nonce 6 waits for 5
- **Stuck transactions**: Monitor pending pool, resubmit with higher gas if stuck > threshold
- **Database pattern**: `SELECT FOR UPDATE` on user's nonce counter to prevent races

### Double-Spend Prevention Architecture

```
1. DEPOSIT DETECTION:
   - Monitor blockchain via webhook (Alchemy, Moralis) or polling
   - Record tx_hash + chain + block_number + confirmations
   - Status: pending -> confirming -> confirmed -> credited

2. CONFIRMATION TRACKING:
   - Background job polls for new blocks
   - Increment confirmation count per pending deposit
   - Only credit user balance after min confirmations reached

3. REORG PROTECTION:
   - Store block_hash with each confirmation update
   - If block_hash changes for same block_number = reorg detected
   - Reverse credit, re-track from new chain tip

4. WITHDRAWAL IDEMPOTENCY:
   - Unique withdrawal_id per request
   - State machine: created -> approved -> broadcasting -> broadcast -> confirmed
   - Only ONE broadcast attempt per withdrawal_id
   - If broadcast fails, manual review required
```

---

## 7. Regulatory Context (Kenya)

- **VASP Bill 2025**: Kenya's National Treasury drafted the Virtual Assets Service Providers Bill
- **Status**: Regulatory framework under development (not yet enacted as of Mar 2026)
- **Sub-Saharan Africa crypto volume**: $205B+ (Jul 2024 - Jun 2025), 52% YoY growth
- **Key markets**: Nigeria, Kenya, South Africa, Ethiopia
- **Implication**: Operating in a grey area; partner with licensed providers (Yellow Card, Kotani Pay) for compliance

---

## 8. Recommended Technology Stack

### MVP Architecture

```
[User App]
    |
[API Gateway / Django or FastAPI]
    |
    +-- [Wallet Service]
    |       - HD wallet generation (ethers.js/bitcoinjs-lib)
    |       - Deposit address per user
    |       - Monitor incoming transactions (Alchemy webhooks)
    |
    +-- [Price Service]
    |       - CoinGecko API (crypto/USD)
    |       - Yellow Card API (USDT/KES rate)
    |       - Rate caching (Redis, 30s TTL)
    |       - Spread calculation + margin
    |
    +-- [Off-Ramp Service]
    |       - Primary: Yellow Card API (USDT -> KES -> M-Pesa)
    |       - Backup: Kotani Pay API
    |       - Fallback: Luno exchange (USDT/KES sell -> withdraw KES)
    |
    +-- [Liquidity Service]
    |       - CCXT library for multi-exchange trading
    |       - Convert altcoins -> USDT on best-rate exchange
    |       - Maintain USDT float for instant KES settlements
    |
    +-- [Idempotency / Anti-Fraud]
            - Redis idempotency keys
            - PostgreSQL transaction log
            - Confirmation tracking per chain
            - Rate limiting per user
```

### Key API Integrations Summary

| Provider | Purpose | Priority |
|----------|---------|----------|
| Yellow Card | KES off-ramp (M-Pesa/bank) | P0 - Critical |
| Kotani Pay | Backup off-ramp + USSD | P0 - Critical |
| CCXT (Binance/OKX) | Exchange liquidity | P0 - Critical |
| CoinGecko | Price feeds | P0 - Critical |
| Luno | Direct KES trading | P1 - Important |
| Fireblocks | Wallet custody (at scale) | P2 - Growth |
| Flutterwave | Merchant settlements | P2 - Growth |
| Chainlink | On-chain oracle (if DeFi) | P3 - Future |
