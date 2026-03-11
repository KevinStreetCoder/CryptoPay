# DeFi Wallet Integration Plan — CryptoPay

**Date:** 2026-03-11
**Status:** Research & Planning
**Author:** CryptoPay Engineering

---

## Table of Contents

1. [WalletConnect v2 / Reown AppKit Integration](#1-walletconnect-v2--reown-appkit-integration)
2. [Non-Custodial Payment Flow](#2-non-custodial-payment-flow)
3. [Multi-Chain Support](#3-multi-chain-support)
4. [Production HD Wallet Implementation (BIP-32/44)](#4-production-hd-wallet-implementation-bip-3244)
5. [Public Crypto APIs Worth Integrating](#5-public-crypto-apis-worth-integrating)
6. [Implementation Timeline](#6-implementation-timeline)
7. [Security Considerations](#7-security-considerations)
8. [Risk Assessment](#8-risk-assessment)

---

## 1. WalletConnect v2 / Reown AppKit Integration

WalletConnect rebranded to **Reown** in late 2024. Their **AppKit** SDK (formerly Web3Modal) provides a turnkey wallet connection experience for React Native, including Expo support. Over 600 wallets are compatible via the WalletConnect protocol.

### 1.1 Required Packages

Install the core AppKit dependencies plus chain-specific adapters:

```bash
# Core dependencies (Expo)
npx expo install \
  @reown/appkit-react-native \
  @react-native-async-storage/async-storage \
  react-native-get-random-values \
  react-native-svg \
  @react-native-community/netinfo \
  @walletconnect/react-native-compat \
  react-native-safe-area-context \
  expo-application

# EVM adapter (Ethers.js — recommended for CryptoPay since we already use ethers patterns)
npx expo install @reown/appkit-ethers-react-native

# Solana adapter
npx expo install @reown/appkit-solana-react-native text-encoding

# Bitcoin adapter
npx expo install @reown/appkit-bitcoin-react-native
```

> **Note:** Expo SDK 55 requires `expo prebuild` to generate native code before building. This is a managed-to-bare transition step that affects EAS builds.

### 1.2 Polyfills & Babel Config

**Critical:** For Expo SDK 53+ (including our SDK 55), create or update `babel.config.js` to support the `valtio` state library used internally by AppKit:

```javascript
// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { unstable_transformImportMeta: true }],
    ],
  };
};
```

If dependency conflicts arise, add overrides to `package.json`:

```json
{
  "overrides": {
    "@walletconnect/universal-provider": "2.21.10",
    "valtio": "2.1.8"
  }
}
```

### 1.3 Configuration

1. **Get a Project ID** from [cloud.reown.com](https://cloud.reown.com) (free tier available).
2. Configure metadata and relay:

```typescript
// src/config/walletConnect.ts
import '@walletconnect/react-native-compat'; // MUST be first import

import { createAppKit } from '@reown/appkit-react-native';
import { EthersAdapter } from '@reown/appkit-ethers-react-native';
import { SolanaAdapter } from '@reown/appkit-solana-react-native';
import { BitcoinAdapter } from '@reown/appkit-bitcoin-react-native';
import {
  mainnet,
  polygon,
  arbitrum,
} from '@reown/appkit-react-native/networks';

const PROJECT_ID = process.env.EXPO_PUBLIC_WC_PROJECT_ID || 'YOUR_PROJECT_ID';

export const appKit = createAppKit({
  projectId: PROJECT_ID,

  // Chains we support for payments
  networks: [mainnet, polygon],

  // Adapters for each chain family
  adapters: [
    new EthersAdapter(),
    new SolanaAdapter(),
    new BitcoinAdapter(),
  ],

  metadata: {
    name: 'CryptoPay',
    description: 'Crypto to M-Pesa payments',
    url: 'https://cryptopay.africa',
    icons: ['https://cryptopay.africa/icon.png'],
    redirect: {
      native: 'cryptopay://',           // Deep link scheme
      universal: 'https://cryptopay.africa/wc',  // Universal link fallback
    },
  },

  // Relay server (default: wss://relay.walletconnect.com)
  // No need to override unless using a custom relay
});
```

### 1.4 Provider Setup in App Layout

Wrap the Expo Router layout with AppKit providers:

```tsx
// app/_layout.tsx
import '@walletconnect/react-native-compat';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppKitProvider, AppKit } from '@reown/appkit-react-native';
import { appKit } from '../src/config/walletConnect';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppKitProvider instance={appKit}>
        <Stack />
        {/* Modal must be rendered at root level */}
        <AppKit />
      </AppKitProvider>
    </SafeAreaProvider>
  );
}
```

> **Android Expo Router workaround:** If the modal fails to open on Android, wrap `<AppKit />` in an absolute-positioned `<View>`:
> ```tsx
> <View style={{ position: 'absolute', height: '100%', width: '100%' }}>
>   <AppKit />
> </View>
> ```

### 1.5 Session Management & Persistence

AppKit handles session persistence automatically via `@react-native-async-storage/async-storage`. Sessions survive app restarts.

```typescript
// src/hooks/useWalletConnection.ts
import { useAppKit, useAccount } from '@reown/appkit-react-native';

export function useWalletConnection() {
  const { open, disconnect } = useAppKit();
  const { address, isConnected, chainId, caipAddress } = useAccount();

  const connectWallet = async () => {
    try {
      await open();
      // AppKit shows modal with wallet options
      // Session is auto-persisted on successful connection
    } catch (error) {
      console.error('Wallet connection failed:', error);
    }
  };

  const disconnectWallet = async () => {
    try {
      await disconnect();
    } catch (error) {
      console.error('Disconnect failed:', error);
    }
  };

  return {
    address,
    isConnected,
    chainId,
    caipAddress, // e.g., "eip155:1:0xabc..."
    connectWallet,
    disconnectWallet,
  };
}
```

### 1.6 Supported Wallets

| Wallet | EVM | Solana | BTC | Connection Method |
|--------|-----|--------|-----|-------------------|
| MetaMask | Yes | No | No | Deep link (mobile), QR (desktop) |
| Trust Wallet | Yes | Yes | Yes | Deep link (mobile), QR (desktop) |
| Phantom | Yes | Yes | No | Deep link (mobile), QR (desktop) |
| Coinbase Wallet | Yes | Yes | No | Deep link, Coinbase SDK |
| Rainbow | Yes | No | No | Deep link (mobile) |
| 600+ others | Via WalletConnect protocol | Varies | Varies | QR + Deep link |

### 1.7 QR Code Flow (Desktop / Cross-device)

When a user opens CryptoPay on a device without a wallet app:

1. AppKit displays a QR code containing a `wc:` URI
2. User scans QR with their wallet app on another device
3. WalletConnect relay server brokers an encrypted session
4. All subsequent signing requests are relayed through the encrypted channel
5. Session persists until explicitly disconnected

### 1.8 Deep Link Flow (Mobile)

When both CryptoPay and the wallet app are on the same device:

1. User taps "Connect Wallet" in CryptoPay
2. AppKit detects installed wallets and shows them in the modal
3. User selects e.g. MetaMask, CryptoPay deep-links to MetaMask
4. MetaMask shows approval prompt, user approves
5. MetaMask deep-links back to CryptoPay via `cryptopay://` scheme
6. Session established, address available

**Required:** Register the deep link scheme in `app.json`:

```json
{
  "expo": {
    "scheme": "cryptopay",
    "ios": {
      "associatedDomains": ["applinks:cryptopay.africa"]
    },
    "android": {
      "intentFilters": [
        {
          "action": "VIEW",
          "data": [{ "scheme": "cryptopay" }],
          "category": ["DEFAULT", "BROWSABLE"]
        }
      ]
    }
  }
}
```

---

## 2. Non-Custodial Payment Flow

This flow allows users who already hold crypto in their own wallets (MetaMask, Trust Wallet, etc.) to pay Kenyan merchants via M-Pesa without depositing into CryptoPay's custodial system.

### 2.1 End-to-End Flow

```
User                  CryptoPay App           Backend               Blockchain
 |                        |                      |                      |
 |-- Connect Wallet ----->|                      |                      |
 |                        |-- POST /quotes/ ---->|                      |
 |                        |<-- quote + address --|                      |
 |<-- Sign TX prompt -----|                      |                      |
 |-- Approve in wallet -->|                      |                      |
 |                        |-- POST /pay-bill/ -->|                      |
 |                        |                      |-- Monitor TX ------->|
 |                        |                      |<-- TX confirmed -----|
 |                        |                      |-- M-Pesa B2B ------>|
 |                        |<-- payment_complete --|                      |
```

### 2.2 Step-by-Step Implementation

#### Step 1: Wallet Connection
User connects their external wallet via AppKit (see Section 1). The app receives the user's address and connected chain ID.

#### Step 2: Quote Generation

```typescript
// POST /api/v1/payments/external-quote/
const requestQuote = async (params: {
  source_currency: 'USDT' | 'ETH' | 'BTC' | 'SOL';
  source_chain: 'ethereum' | 'polygon' | 'tron' | 'bitcoin' | 'solana';
  dest_amount: number;  // KES amount
  sender_address: string;  // Connected wallet address
}) => {
  const { data } = await api.post('/payments/external-quote/', params);
  return data;
  // Returns: {
  //   quote_id: "uuid",
  //   receiving_address: "0x...",  // CryptoPay's hot wallet for this chain
  //   crypto_amount: "0.0234",    // Amount user needs to send
  //   exchange_rate: 425000,
  //   fee_kes: 45,
  //   expires_at: "2026-03-11T12:05:00Z",  // 5-min expiry
  //   chain_id: 1,
  // }
};
```

#### Step 3: Transaction Signing

```typescript
// src/services/externalPayment.ts
import { useAppKit } from '@reown/appkit-react-native';
import { ethers } from 'ethers';

// ERC-20 USDT transfer
async function sendUSDTPayment(
  provider: ethers.BrowserProvider,
  quote: Quote,
) {
  const USDT_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
  ];

  const signer = await provider.getSigner();
  const usdt = new ethers.Contract(
    quote.token_contract,  // Backend provides correct contract per chain
    USDT_ABI,
    signer,
  );

  // Amount in smallest unit (6 decimals for USDT)
  const amount = ethers.parseUnits(quote.crypto_amount, 6);

  const tx = await usdt.transfer(quote.receiving_address, amount);
  return tx.hash;
}

// Native ETH transfer
async function sendETHPayment(
  provider: ethers.BrowserProvider,
  quote: Quote,
) {
  const signer = await provider.getSigner();
  const tx = await signer.sendTransaction({
    to: quote.receiving_address,
    value: ethers.parseEther(quote.crypto_amount),
    // EIP-1559 fields auto-populated by provider
  });
  return tx.hash;
}
```

#### Step 4: Backend Verification

```python
# backend/apps/payments/services.py
def verify_external_payment(quote_id: str, tx_hash: str) -> bool:
    """
    Server-side verification of on-chain transaction.
    NEVER trust client-reported tx status.
    """
    quote = PaymentQuote.objects.get(id=quote_id, status='pending')

    if quote.is_expired():
        raise QuoteExpiredError()

    chain = quote.source_chain
    if chain in ('ethereum', 'polygon'):
        verified = verify_evm_transaction(
            tx_hash=tx_hash,
            expected_to=quote.receiving_address,
            expected_amount=quote.crypto_amount,
            expected_token=quote.token_contract,
            chain=chain,
        )
    elif chain == 'bitcoin':
        verified = verify_btc_transaction(
            tx_hash=tx_hash,
            expected_to=quote.receiving_address,
            expected_amount=quote.crypto_amount,
            min_confirmations=1,  # 1 for small amounts, 3+ for large
        )
    elif chain == 'solana':
        verified = verify_solana_transaction(
            tx_hash=tx_hash,
            expected_to=quote.receiving_address,
            expected_amount=quote.crypto_amount,
        )

    if verified:
        quote.status = 'confirmed'
        quote.tx_hash = tx_hash
        quote.save()
        # Trigger M-Pesa disbursement via existing saga
        trigger_mpesa_disbursement.delay(quote_id)

    return verified
```

#### Step 5: M-Pesa Disbursement
Once the on-chain transaction is confirmed, the existing payment saga handles conversion and M-Pesa B2B/B2C disbursement. This reuses the current infrastructure.

### 2.3 Error Handling & Reversals

| Scenario | Handling |
|----------|----------|
| User rejects TX in wallet | No action needed; quote expires naturally |
| TX sent but under-amount | Backend detects mismatch, holds funds, notifies user for top-up or refund |
| TX sent to wrong chain | Chain ID validation prevents this; if bypassed, manual resolution required |
| TX confirmed but M-Pesa fails | Compensation: refund crypto to sender address (stored from wallet connection) |
| Quote expires after TX sent | Backend still monitors; if TX arrives within grace period (15 min), process it |
| Network congestion (TX pending) | Poll TX status with exponential backoff; extend quote TTL if TX is in mempool |

**Refund mechanism:**

```python
def refund_external_payment(quote_id: str):
    """Refund crypto to sender if M-Pesa disbursement fails."""
    quote = PaymentQuote.objects.get(id=quote_id)
    sender = quote.sender_address  # From wallet connection

    if quote.source_chain in ('ethereum', 'polygon'):
        send_evm_refund(sender, quote.crypto_amount, quote.token_contract)
    elif quote.source_chain == 'bitcoin':
        send_btc_refund(sender, quote.crypto_amount)
    elif quote.source_chain == 'solana':
        send_solana_refund(sender, quote.crypto_amount)

    quote.status = 'refunded'
    quote.save()
```

---

## 3. Multi-Chain Support

### 3.1 USDT — TRC-20, ERC-20, Polygon

| Property | TRC-20 | ERC-20 | Polygon |
|----------|--------|--------|---------|
| **Contract** | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |
| **Decimals** | 6 | 6 | 6 |
| **Avg Fee** | ~1 TRX ($0.10) | $2-15 (gas dependent) | $0.01-0.10 |
| **Confirmation** | 19 blocks (~1 min) | 12 blocks (~3 min) | 128 blocks (~5 min) |
| **Recommended for** | Low-value payments | Whale/DeFi users | Cost-sensitive users |

**ERC-20 Transfer ABI:**

```json
[
  {
    "name": "transfer",
    "type": "function",
    "inputs": [
      { "name": "_to", "type": "address" },
      { "name": "_value", "type": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "bool" }]
  },
  {
    "name": "Transfer",
    "type": "event",
    "inputs": [
      { "name": "from", "type": "address", "indexed": true },
      { "name": "to", "type": "address", "indexed": true },
      { "name": "value", "type": "uint256", "indexed": false }
    ]
  }
]
```

**Backend verification (EVM chains):**

```python
from web3 import Web3

def verify_evm_transaction(tx_hash, expected_to, expected_amount, expected_token, chain):
    """Verify an ERC-20 transfer on any EVM chain."""
    rpc_urls = {
        'ethereum': settings.ETH_RPC_URL,    # Alchemy/Infura
        'polygon': settings.POLYGON_RPC_URL,
    }
    w3 = Web3(Web3.HTTPProvider(rpc_urls[chain]))

    receipt = w3.eth.get_transaction_receipt(tx_hash)
    if receipt is None or receipt['status'] != 1:
        return False

    # Decode ERC-20 Transfer event logs
    transfer_topic = w3.keccak(text='Transfer(address,address,uint256)')

    for log in receipt['logs']:
        if (log['address'].lower() == expected_token.lower()
                and log['topics'][0] == transfer_topic):
            to_addr = '0x' + log['topics'][2].hex()[-40:]
            amount = int(log['data'].hex(), 16)

            if (to_addr.lower() == expected_to.lower()
                    and amount >= int(float(expected_amount) * 1e6)):
                return True

    return False
```

### 3.2 BTC — Bitcoin

**PSBT (Partially Signed Bitcoin Transaction) Flow:**

WalletConnect's Bitcoin adapter supports PSBT signing, which is the modern standard for hardware wallets and multi-sig setups.

```typescript
// BTC payment via WalletConnect Bitcoin adapter
import { BitcoinAdapter } from '@reown/appkit-bitcoin-react-native';

async function sendBTCPayment(quote: Quote) {
  // The Bitcoin adapter handles PSBT construction internally
  // User's wallet (e.g., Xverse, Unisat) signs the PSBT
  const result = await bitcoinAdapter.sendTransfer({
    recipient: quote.receiving_address,
    amount: quote.crypto_amount, // In satoshis
  });
  return result.txid;
}
```

**Confirmation requirements by amount:**

| Amount (USD equiv.) | Required Confirmations | Wait Time |
|---------------------|----------------------|-----------|
| < $50 | 1 confirmation | ~10 min |
| $50 - $500 | 3 confirmations | ~30 min |
| $500 - $5,000 | 6 confirmations | ~60 min |
| > $5,000 | 6+ confirmations | ~60+ min |

**Supported BTC wallets:** Xverse, Unisat, Leather (Hiro), Trust Wallet (limited). MetaMask does NOT support native BTC.

**Backend BTC verification:**

```python
import requests

def verify_btc_transaction(tx_hash, expected_to, expected_amount, min_confirmations=1):
    """Verify BTC transaction via Mempool.space API."""
    url = f"https://mempool.space/api/tx/{tx_hash}"
    resp = requests.get(url, timeout=10)
    tx = resp.json()

    if not tx.get('status', {}).get('confirmed', False):
        return False

    block_height = tx['status']['block_height']
    current_height = requests.get(
        'https://mempool.space/api/blocks/tip/height', timeout=10
    ).json()
    confirmations = current_height - block_height + 1

    if confirmations < min_confirmations:
        return False

    # Check outputs for expected address and amount
    expected_sats = int(float(expected_amount) * 1e8)
    for vout in tx['vout']:
        if (vout.get('scriptpubkey_address') == expected_to
                and vout['value'] >= expected_sats):
            return True

    return False
```

### 3.3 ETH — Ethereum

**EIP-1559 Transaction Construction:**

```typescript
async function sendETHPayment(provider: ethers.BrowserProvider, quote: Quote) {
  const signer = await provider.getSigner();

  // Gas estimation with EIP-1559
  const feeData = await provider.getFeeData();

  const tx = await signer.sendTransaction({
    to: quote.receiving_address,
    value: ethers.parseEther(quote.crypto_amount),
    // EIP-1559 pricing (auto-populated, but can override)
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    // Chain ID for replay protection
    chainId: quote.chain_id,
  });

  // Wait for 1 confirmation before notifying backend
  const receipt = await tx.wait(1);
  return receipt.hash;
}
```

**Gas estimation display for users:**

```typescript
async function estimatePaymentGas(
  provider: ethers.BrowserProvider,
  quote: Quote,
): Promise<{ gasEstimateETH: string; gasEstimateUSD: string }> {
  const feeData = await provider.getFeeData();
  const gasLimit = quote.token_contract
    ? 65000n  // ERC-20 transfer
    : 21000n; // Native ETH transfer

  const maxCost = gasLimit * (feeData.maxFeePerGas || 0n);
  const gasEstimateETH = ethers.formatEther(maxCost);

  // Convert to USD using our rate service
  const ethPrice = await getETHPrice();
  const gasEstimateUSD = (parseFloat(gasEstimateETH) * ethPrice).toFixed(2);

  return { gasEstimateETH, gasEstimateUSD };
}
```

### 3.4 SOL — Solana

**Solana wallet integration via Reown AppKit:**

```typescript
// Solana SPL Token transfer (e.g., USDC on Solana)
import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

async function sendSPLTokenPayment(
  connection: Connection,
  senderPublicKey: PublicKey,
  quote: Quote,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
) {
  const mintAddress = new PublicKey(quote.token_contract);
  const recipientPubkey = new PublicKey(quote.receiving_address);

  // Get associated token accounts
  const senderATA = await getAssociatedTokenAddress(mintAddress, senderPublicKey);
  const recipientATA = await getAssociatedTokenAddress(mintAddress, recipientPubkey);

  const amount = Math.round(parseFloat(quote.crypto_amount) * 1e6); // 6 decimals

  const transaction = new Transaction().add(
    createTransferInstruction(
      senderATA,
      recipientATA,
      senderPublicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;
  transaction.feePayer = senderPublicKey;

  // Sign via connected wallet (Phantom, Solflare, etc.)
  const signed = await signTransaction(transaction);
  const txid = await connection.sendRawTransaction(signed.serialize());

  // Confirm
  await connection.confirmTransaction(txid, 'confirmed');
  return txid;
}
```

**Native SOL transfer:**

```typescript
import { SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

async function sendSOLPayment(
  connection: Connection,
  senderPublicKey: PublicKey,
  quote: Quote,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
) {
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: senderPublicKey,
      toPubkey: new PublicKey(quote.receiving_address),
      lamports: Math.round(parseFloat(quote.crypto_amount) * LAMPORTS_PER_SOL),
    }),
  );

  transaction.recentBlockhash = (
    await connection.getLatestBlockhash()
  ).blockhash;
  transaction.feePayer = senderPublicKey;

  const signed = await signTransaction(transaction);
  const txid = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(txid, 'confirmed');
  return txid;
}
```

**Backend SOL verification:**

```python
from solders.rpc.responses import GetTransactionResp
from solana.rpc.api import Client as SolanaClient

def verify_solana_transaction(tx_hash, expected_to, expected_amount):
    """Verify SOL/SPL token transaction."""
    client = SolanaClient(settings.SOLANA_RPC_URL)
    resp = client.get_transaction(tx_hash, max_supported_transaction_version=0)

    if resp.value is None:
        return False

    tx = resp.value
    if tx.transaction.meta.err is not None:
        return False

    # Check post-token balances for SPL transfers
    # or account balance changes for native SOL
    # (Implementation depends on whether native SOL or SPL token)
    return True  # Simplified; full implementation checks balances
```

---

## 4. Production HD Wallet Implementation (BIP-32/44)

CryptoPay currently has a working BIP-32/44 implementation in `backend/apps/blockchain/services.py` using raw Python cryptography. This section covers the production hardening roadmap.

### 4.1 Current State

The existing implementation in `services.py`:
- Derives keys via `HMAC-SHA512` chain following BIP-32
- Supports BIP-44 paths: `m/44'/<coin_type>'/<account>'/0/<index>`
- Generates addresses for Tron, Ethereum, Polygon, Bitcoin (P2PKH), and Solana (Ed25519)
- Uses `WALLET_MASTER_SEED` env var or falls back to `SECRET_KEY` derivation

### 4.2 Derivation Paths by Chain

| Chain | BIP-44 Path | Coin Type | Standard |
|-------|------------|-----------|----------|
| Bitcoin | `m/44'/0'/<account>'/0/<index>` | 0 | BIP-44, P2PKH |
| Bitcoin (SegWit) | `m/84'/0'/<account>'/0/<index>` | 0 | BIP-84, P2WPKH |
| Ethereum | `m/44'/60'/<account>'/0/<index>` | 60 | BIP-44 |
| Polygon | `m/44'/60'/<account>'/0/<index>` | 60 | Same as ETH |
| Tron | `m/44'/195'/<account>'/0/<index>` | 195 | BIP-44 |
| Solana | `m/44'/501'/<account>'/0'` | 501 | BIP-44 (hardened leaf) |

### 4.3 Recommended Python Libraries

Replace raw crypto operations with battle-tested libraries for production:

```python
# requirements/production.txt additions
bitcoinlib==0.7.7         # BTC: HD wallet, address generation, tx building
eth-account==0.13.4       # ETH: Account management, signing, HD derivation
solders==0.21.0           # SOL: Keypair, transaction signing (Rust-backed)
tronpy==0.5.0             # Tron: TRC-20 interactions, address utilities
bip-utils==2.9.3          # Universal BIP-32/39/44 implementation
mnemonic==0.21            # BIP-39 mnemonic generation
```

**Example: Production-grade address generation with `bip-utils`:**

```python
from bip_utils import (
    Bip39SeedGenerator,
    Bip44,
    Bip44Coins,
    Bip44Changes,
    Bip84,
    Bip84Coins,
)

COIN_MAP = {
    'bitcoin': Bip44Coins.BITCOIN,
    'ethereum': Bip44Coins.ETHEREUM,
    'tron': Bip44Coins.TRON,
    'solana': Bip44Coins.SOLANA,
}

def generate_address_production(mnemonic: str, chain: str, account: int, index: int) -> dict:
    """Generate address using bip-utils library (production-grade)."""
    seed = Bip39SeedGenerator(mnemonic).Generate()

    if chain == 'bitcoin':
        # Use BIP-84 for native SegWit (bc1... addresses)
        ctx = Bip84.FromSeed(seed, Bip84Coins.BITCOIN)
        acc = ctx.Purpose().Coin().Account(account)
        addr_ctx = acc.Change(Bip44Changes.CHAIN_EXT).AddressIndex(index)
    else:
        coin = COIN_MAP[chain]
        ctx = Bip44.FromSeed(seed, coin)
        acc = ctx.Purpose().Coin().Account(account)
        addr_ctx = acc.Change(Bip44Changes.CHAIN_EXT).AddressIndex(index)

    return {
        'address': addr_ctx.PublicKey().ToAddress(),
        'public_key': addr_ctx.PublicKey().RawCompressed().ToHex(),
        # NEVER return private key in API responses
        # Private key stays in KMS for signing operations only
    }
```

### 4.4 AWS KMS Key Management

**Architecture: Hot / Warm / Cold wallet strategy:**

```
                    ┌──────────────────────────────┐
                    │         Cold Storage          │
                    │   (Air-gapped, offline HSM)   │
                    │   95% of total holdings       │
                    │   Manual multi-sig to move    │
                    └──────────────┬───────────────┘
                                   │ Manual sweep (weekly)
                    ┌──────────────▼───────────────┐
                    │         Warm Wallet           │
                    │   (AWS KMS encrypted key)     │
                    │   4% of holdings              │
                    │   Auto-refill from cold       │
                    │   Requires 2-of-3 approval    │
                    └──────────────┬───────────────┘
                                   │ Auto-refill (daily)
                    ┌──────────────▼───────────────┐
                    │         Hot Wallet            │
                    │   (In-memory, KMS decrypted)  │
                    │   1% of holdings              │
                    │   Automated disbursements     │
                    │   Rate-limited per hour       │
                    └──────────────────────────────┘
```

**KMS Integration:**

```python
import boto3
import json
from django.conf import settings

class KMSKeyManager:
    """Manage wallet master seed encryption via AWS KMS."""

    def __init__(self):
        self.kms = boto3.client('kms', region_name=settings.AWS_REGION)
        self.key_id = settings.KMS_WALLET_KEY_ID

    def encrypt_seed(self, seed_bytes: bytes) -> bytes:
        """Encrypt master seed for storage."""
        response = self.kms.encrypt(
            KeyId=self.key_id,
            Plaintext=seed_bytes,
            EncryptionContext={'purpose': 'wallet-master-seed'},
        )
        return response['CiphertextBlob']

    def decrypt_seed(self) -> bytes:
        """Decrypt master seed from encrypted storage."""
        encrypted = self._load_encrypted_seed()
        response = self.kms.decrypt(
            CiphertextBlob=encrypted,
            EncryptionContext={'purpose': 'wallet-master-seed'},
        )
        return response['Plaintext']

    def _load_encrypted_seed(self) -> bytes:
        """Load encrypted seed from secure storage (SSM Parameter Store)."""
        ssm = boto3.client('ssm', region_name=settings.AWS_REGION)
        param = ssm.get_parameter(
            Name='/cryptopay/wallet/encrypted-master-seed',
            WithDecryption=False,  # KMS decryption is separate
        )
        return bytes.fromhex(param['Parameter']['Value'])
```

### 4.5 Security Best Practices

1. **BIP-39 mnemonic generation:** Use cryptographically secure entropy (256 bits) via `os.urandom(32)`
2. **Never log or expose private keys:** All signing happens server-side in memory; keys are zeroed after use
3. **Seed rotation plan:** Keep a versioned seed registry; old seeds remain for address derivation but new deposits go to new seed addresses
4. **Rate limiting:** Hot wallet disbursements capped at KES 500,000/hour; anything above requires warm wallet approval
5. **Audit trail:** Every key derivation, signing operation, and fund movement logged to immutable audit table
6. **Key ceremony:** Initial master seed generation requires 3-of-5 team members present, each contributing entropy

---

## 5. Public Crypto APIs Worth Integrating

### 5.1 CoinGecko (Already Integrated)

| Property | Value |
|----------|-------|
| **Status** | Already integrated as primary rate source |
| **Auth** | API key (free demo plan available) |
| **Free Tier** | 30 calls/min, 10,000 calls/month (demo) |
| **Paid** | From $129/month (Analyst) for 500 calls/min |
| **Use in CryptoPay** | Primary exchange rates, historical charts |
| **Integration Value** | HIGH - keep as primary |

### 5.2 CoinPaprika

| Property | Value |
|----------|-------|
| **Auth** | No auth needed for free tier |
| **Free Tier** | 25,000 calls/month |
| **Paid** | Pro from ~$100/month (5,000 req/hour) |
| **Rate Limits** | Free: ~20 req/min; Pro: ~83 req/min |
| **Key Endpoints** | `/v1/tickers/{coin_id}`, `/v1/coins/{coin_id}/ohlcv/historical` |
| **Integration Value** | HIGH - excellent free fallback for rates |

**Fallback integration:**

```python
# backend/apps/rates/services.py
import requests

def get_coinpaprika_rate(crypto: str) -> dict | None:
    """Fallback rate source - no auth required."""
    coin_map = {
        'BTC': 'btc-bitcoin',
        'ETH': 'eth-ethereum',
        'USDT': 'usdt-tether',
        'SOL': 'sol-solana',
    }
    coin_id = coin_map.get(crypto)
    if not coin_id:
        return None

    try:
        resp = requests.get(
            f'https://api.coinpaprika.com/v1/tickers/{coin_id}',
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            'price_usd': data['quotes']['USD']['price'],
            'volume_24h': data['quotes']['USD']['volume_24h'],
            'percent_change_24h': data['quotes']['USD']['percent_change_24h'],
            'source': 'coinpaprika',
        }
    except Exception:
        return None
```

### 5.3 Coinlore

| Property | Value |
|----------|-------|
| **Auth** | None required |
| **Free Tier** | Completely free, no registration |
| **Rate Limits** | No strict limit; recommend 1 req/sec |
| **Base URL** | `https://api.coinlore.net/api` |
| **Key Endpoints** | `/ticker/?id=90` (BTC=90, ETH=80), `/global/` |
| **Data** | 14,000+ coins, 300+ exchanges |
| **Integration Value** | MEDIUM - good for market overview data, tertiary fallback |

```python
def get_coinlore_rate(crypto: str) -> dict | None:
    """Tertiary fallback - completely free, no auth."""
    coin_ids = {'BTC': '90', 'ETH': '80', 'USDT': '518', 'SOL': '48543'}
    coin_id = coin_ids.get(crypto)
    if not coin_id:
        return None

    try:
        resp = requests.get(
            f'https://api.coinlore.net/api/ticker/?id={coin_id}',
            timeout=5,
        )
        data = resp.json()[0]
        return {
            'price_usd': float(data['price_usd']),
            'volume_24h': float(data['volume24']),
            'percent_change_24h': float(data['percent_change_24h']),
            'source': 'coinlore',
        }
    except Exception:
        return None
```

### 5.4 CryptoCompare

| Property | Value |
|----------|-------|
| **Auth** | API key required (free registration) |
| **Free Tier** | ~100,000 calls/month |
| **Paid** | From $80/month (100K+ calls, minute-level history) |
| **WebSocket** | Real-time streaming via `wss://streamer.cryptocompare.com` |
| **Coverage** | 5,700+ coins, 260,000+ trading pairs |
| **Integration Value** | HIGH - WebSocket for real-time rate streaming |

**WebSocket integration for live rates:**

```python
# backend/apps/rates/consumers.py (Django Channels)
import json
import websocket

CRYPTOCOMPARE_WS = 'wss://streamer.cryptocompare.com/v2'
API_KEY = settings.CRYPTOCOMPARE_API_KEY

def stream_rates():
    """Stream real-time rates from CryptoCompare WebSocket."""
    ws = websocket.WebSocketApp(
        f'{CRYPTOCOMPARE_WS}?api_key={API_KEY}',
        on_message=on_message,
        on_error=on_error,
    )

    # Subscribe to trade updates
    def on_open(ws):
        ws.send(json.dumps({
            'action': 'SubAdd',
            'subs': [
                '2~Coinbase~BTC~USD',
                '2~Coinbase~ETH~USD',
                '2~Binance~SOL~USDT',
            ],
        }))

    ws.on_open = on_open
    ws.run_forever()

def on_message(ws, message):
    data = json.loads(message)
    if data.get('TYPE') == '2':  # Trade type
        # Update Redis cache with latest price
        cache_key = f"rate:{data['FSYM']}:USD"
        redis_client.set(cache_key, data['PRICE'], ex=30)
```

### 5.5 Mempool.space

| Property | Value |
|----------|-------|
| **Auth** | None required |
| **Free Tier** | Completely free, open source |
| **Rate Limits** | Lenient; self-hosted option available |
| **Base URL** | `https://mempool.space/api` |
| **Key Endpoints** | `/v1/fees/recommended`, `/tx/{txid}`, `/address/{addr}/utxo` |
| **Integration Value** | ESSENTIAL - BTC fee estimation and tx verification |

**Fee estimation endpoints:**

```python
def get_btc_fee_estimates() -> dict:
    """Get current BTC fee estimates from Mempool.space."""
    resp = requests.get('https://mempool.space/api/v1/fees/recommended', timeout=5)
    data = resp.json()
    return {
        'fastest': data['fastestFee'],      # sat/vB, next block
        'half_hour': data['halfHourFee'],    # sat/vB, ~30 min
        'hour': data['hourFee'],             # sat/vB, ~60 min
        'economy': data['economyFee'],       # sat/vB, low priority
        'minimum': data['minimumFee'],       # sat/vB, minimum relay
    }

def estimate_btc_tx_fee(fee_rate_satvb: int, input_count: int = 1, output_count: int = 2) -> int:
    """Estimate BTC transaction fee in satoshis."""
    # P2WPKH (SegWit): ~68 vbytes per input, ~31 per output, 10.5 overhead
    vsize = 10.5 + (68 * input_count) + (31 * output_count)
    return int(vsize * fee_rate_satvb)
```

### 5.6 VALR

| Property | Value |
|----------|-------|
| **Auth** | API key + HMAC signature |
| **Free Tier** | Free with account, rate limits apply |
| **Rate Limits** | Per-second and per-minute tiers (exact values in docs) |
| **Base URL** | `https://api.valr.com` |
| **Markets** | ZAR pairs (BTC/ZAR, ETH/ZAR, USDT/ZAR, SOL/ZAR) |
| **Integration Value** | HIGH - closest African exchange for KES corridor pricing |

**Why VALR matters for CryptoPay:** VALR is the largest South African exchange and provides ZAR-crypto pairs. Since ZAR and KES are both African currencies with established forex corridors, VALR prices can serve as a reference benchmark and potential liquidity source for the East African market.

```python
import hashlib
import hmac
import time

class VALRClient:
    """VALR API client for South African market rates."""
    BASE_URL = 'https://api.valr.com'

    def __init__(self, api_key: str, api_secret: str):
        self.api_key = api_key
        self.api_secret = api_secret

    def _sign(self, timestamp: str, method: str, path: str, body: str = '') -> str:
        payload = f'{timestamp}{method.upper()}{path}{body}'
        return hmac.new(
            self.api_secret.encode(),
            payload.encode(),
            hashlib.sha512,
        ).hexdigest()

    def get_ticker(self, pair: str = 'BTCZAR') -> dict:
        """Get current ticker for a pair."""
        path = f'/v1/public/{pair}/marketsummary'
        resp = requests.get(f'{self.BASE_URL}{path}', timeout=5)
        return resp.json()

    def get_orderbook(self, pair: str = 'BTCZAR') -> dict:
        """Get live order book for spread analysis."""
        path = f'/v1/public/{pair}/orderbook'
        resp = requests.get(f'{self.BASE_URL}{path}', timeout=5)
        return resp.json()
```

### 5.7 Alchemy / Infura

| Property | Alchemy | Infura |
|----------|---------|--------|
| **Auth** | API key | API key |
| **Free Tier** | 30M compute units/month (~3.8M requests) | 100K requests/day (~3M/month) |
| **Paid** | Pay-as-you-go from $0 + usage | Growth from $50/month |
| **Chains** | ETH, Polygon, Arbitrum, Optimism, +30 more | ETH, Polygon, Arbitrum, +15 more |
| **Integration Value** | ESSENTIAL - reliable ETH/Polygon node for tx verification |

**Recommendation:** Use Alchemy as primary EVM RPC provider (more generous free tier) with Infura as failover.

```python
# backend/config/settings/production.py
ETH_RPC_URL = f"https://eth-mainnet.g.alchemy.com/v2/{ALCHEMY_API_KEY}"
ETH_RPC_FALLBACK = f"https://mainnet.infura.io/v3/{INFURA_API_KEY}"
POLYGON_RPC_URL = f"https://polygon-mainnet.g.alchemy.com/v2/{ALCHEMY_API_KEY}"
POLYGON_RPC_FALLBACK = f"https://polygon-mainnet.infura.io/v3/{INFURA_API_KEY}"
```

### 5.8 Helius (Solana RPC)

| Property | Value |
|----------|-------|
| **Auth** | API key |
| **Free Tier** | 50,000 credits/day (shared RPC) |
| **Paid** | Developer $49/month (2M credits/day), Business $499/month |
| **Features** | Enhanced RPC, Webhooks, Priority Fee API, DAS API |
| **Key Endpoint** | `getPriorityFeeEstimate` - 6 priority levels |
| **Integration Value** | HIGH - Solana tx monitoring + priority fee estimation |

```python
SOLANA_RPC_URL = f"https://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}"
```

**Priority fee estimation:**

```python
def get_solana_priority_fee(account_keys: list[str]) -> dict:
    """Get Solana priority fee estimate from Helius."""
    resp = requests.post(
        settings.SOLANA_RPC_URL,
        json={
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'getPriorityFeeEstimate',
            'params': [{
                'accountKeys': account_keys,
                'options': {'recommended': True},
            }],
        },
        timeout=5,
    )
    data = resp.json()['result']
    return {
        'recommended': data['priorityFeeEstimate'],
        'levels': data.get('priorityFeeLevels', {}),
    }
```

### 5.9 API Priority Matrix

| Priority | API | Purpose | Cost |
|----------|-----|---------|------|
| P0 (Critical) | CoinGecko | Primary exchange rates | Free / $129/mo |
| P0 (Critical) | Alchemy | EVM tx verification | Free / Pay-as-you-go |
| P0 (Critical) | Mempool.space | BTC tx verification + fees | Free |
| P0 (Critical) | Helius | SOL tx verification | Free / $49/mo |
| P1 (Important) | CoinPaprika | Fallback rates | Free |
| P1 (Important) | CryptoCompare | Real-time WebSocket rates | Free / $80/mo |
| P2 (Nice-to-have) | VALR | African market reference | Free |
| P2 (Nice-to-have) | Coinlore | Tertiary rate fallback | Free |

---

## 6. Implementation Timeline

### Week 1: WalletConnect Setup + Basic Connection Flow

| Day | Task | Details |
|-----|------|---------|
| Mon | Project setup | Register at cloud.reown.com, get project ID, install packages |
| Tue | Babel & polyfill config | Update babel.config.js, add overrides, test build |
| Wed | AppKit provider integration | Add to `_layout.tsx`, configure metadata and deep links |
| Thu | Connection UI | "Connect Wallet" button on wallet tab, handle connected state |
| Fri | Session persistence | Test reconnection on app restart, handle disconnect gracefully |

**Deliverable:** User can connect MetaMask/Trust Wallet and see their address in CryptoPay.

### Week 2: Transaction Signing + Backend Verification (ETH/USDT)

| Day | Task | Details |
|-----|------|---------|
| Mon | Quote endpoint | `POST /payments/external-quote/` — generates receiving address + pricing |
| Tue | ERC-20 signing flow | Build USDT transfer via ethers.js + AppKit provider |
| Wed | Native ETH signing | ETH transfer with EIP-1559, gas estimation display |
| Thu | Backend verification | EVM tx verification via Alchemy, event log parsing |
| Fri | E2E testing on testnet | Sepolia testnet: connect → quote → sign → verify → confirm |

**Deliverable:** Complete ETH/USDT payment flow working on testnet.

### Week 3: Multi-Chain Support (BTC, SOL, Polygon)

| Day | Task | Details |
|-----|------|---------|
| Mon | Polygon USDT | Add Polygon chain config, same ERC-20 flow, lower gas |
| Tue | Bitcoin adapter | BTC payment via AppKit Bitcoin adapter, PSBT signing |
| Wed | BTC verification | Mempool.space API integration, confirmation tracking |
| Thu | Solana adapter | SOL + SPL token transfers via AppKit Solana adapter |
| Fri | SOL verification | Helius RPC integration, transaction status polling |

**Deliverable:** All four chains functional for external wallet payments.

### Week 4: HD Wallet Production Upgrade + API Integrations

| Day | Task | Details |
|-----|------|---------|
| Mon | bip-utils migration | Replace raw crypto with bip-utils library, maintain address compatibility |
| Tue | AWS KMS integration | Encrypt master seed with KMS, store in Parameter Store |
| Wed | Hot/warm wallet setup | Implement rate limits, auto-refill logic, multi-sig config |
| Thu | CoinPaprika + CryptoCompare | Fallback rate service, WebSocket streaming |
| Fri | VALR + Mempool.space | African market rates, BTC fee estimation |

**Deliverable:** Production-grade key management and multi-source rate feeds.

### Week 5: Testing, Security Audit, Documentation

| Day | Task | Details |
|-----|------|---------|
| Mon | Unit tests | 100% coverage on verification logic, address generation |
| Tue | Integration tests | End-to-end testnet flows for all chains |
| Wed | Security review | Key handling audit, rate limiting, input validation |
| Thu | Penetration testing | Test chain ID spoofing, replay attacks, amount manipulation |
| Fri | Documentation | API docs, runbooks, incident response procedures |

**Deliverable:** Production-ready external wallet payment system.

---

## 7. Security Considerations

### 7.1 Non-Custodial Liability Reduction

Under Kenya's VASP Act 2025, non-custodial wallet software (where users hold their own keys) is generally **outside** the licensing requirement, provided CryptoPay does not perform other regulated activities like exchange or brokerage through the non-custodial channel. The Act was assented on October 15, 2025 and commenced November 4, 2025.

Key implications:
- CryptoPay must still be licensed as a **Virtual Asset Payment Processor** (regulated by CBK) for its custodial and payment processing services
- The non-custodial flow reduces CryptoPay's liability for user funds since CryptoPay never takes custody
- Peer-to-peer wallet-to-wallet transfers remain outside scope
- **Transition deadline:** All existing VASPs must comply by **November 4, 2026**

### 7.2 Server-Side Transaction Verification

**Critical rule:** NEVER trust client-reported transaction status. All verification must happen server-side.

```python
# WRONG - trusting client data
@api_view(['POST'])
def confirm_payment(request):
    tx_hash = request.data['tx_hash']
    # DON'T just mark as paid because the client says so!
    payment.status = 'confirmed'  # INSECURE

# RIGHT - server verifies on-chain
@api_view(['POST'])
def confirm_payment(request):
    tx_hash = request.data['tx_hash']
    quote = get_object_or_404(PaymentQuote, id=request.data['quote_id'])

    # Server independently verifies the transaction on-chain
    verified = verify_on_chain(
        tx_hash=tx_hash,
        chain=quote.source_chain,
        expected_to=quote.receiving_address,
        expected_amount=quote.crypto_amount,
        expected_token=quote.token_contract,
    )

    if not verified:
        return Response({'error': 'Transaction verification failed'}, status=400)

    payment.status = 'confirmed'
```

### 7.3 Multi-Sig for Hot Wallets

For the custodial hot wallet that receives external payments, implement multi-sig:

- **EVM (ETH/Polygon):** Use Gnosis Safe (now Safe{Wallet}) — 2-of-3 signer threshold
- **Bitcoin:** Native P2SH multi-sig — 2-of-3 keys
- **Solana:** Squads Protocol — multi-sig program on Solana

### 7.4 Rate Limiting and Gas Price Validation

```python
# Prevent gas price manipulation attacks
def validate_gas_price(chain: str, reported_gas: int) -> bool:
    """Ensure gas price is within reasonable bounds."""
    if chain in ('ethereum', 'polygon'):
        current_gas = get_current_gas_price(chain)
        # Allow 2x tolerance for fast inclusion
        return reported_gas <= current_gas * 2

    return True  # Other chains have fixed/low fees

# Rate limit payment requests per user
PAYMENT_RATE_LIMITS = {
    'per_minute': 3,
    'per_hour': 20,
    'per_day': 50,
    'max_single_kes': 500_000,   # KES 500K per transaction
    'max_daily_kes': 2_000_000,  # KES 2M per day
}
```

### 7.5 Chain ID Validation

Prevent wrong-chain transactions by validating the connected wallet's chain ID:

```typescript
function validateChainForPayment(
  connectedChainId: number,
  requiredChain: string,
): boolean {
  const CHAIN_IDS: Record<string, number> = {
    'ethereum': 1,
    'polygon': 137,
    'arbitrum': 42161,
    'optimism': 10,
  };

  const requiredChainId = CHAIN_IDS[requiredChain];
  if (!requiredChainId) return false;

  if (connectedChainId !== requiredChainId) {
    // Prompt user to switch chains via AppKit
    // appKit.switchNetwork(requiredChainId);
    return false;
  }

  return true;
}
```

### 7.6 Additional Security Measures

- **Nonce tracking:** Track nonces for EVM transactions to prevent replay attacks
- **Address allowlisting:** Backend only generates and accepts payments to known hot wallet addresses
- **Amount bounds:** Reject transactions outside configured min/max bounds
- **Time-locked quotes:** 5-minute expiry with HMAC-signed quote tokens
- **IP rate limiting:** WAF rules limiting API calls per IP
- **Webhook verification:** For Alchemy/Helius webhooks, verify HMAC signatures

---

## 8. Risk Assessment

### 8.1 UX Complexity for Non-Crypto-Native Users

| Risk | Impact | Mitigation |
|------|--------|------------|
| Users confused by wallet connection flow | High | Provide step-by-step tutorial overlay; default to custodial flow |
| Gas fees surprise users | Medium | Show gas estimate before confirmation; recommend Polygon for low fees |
| Transaction stuck in mempool | Medium | Show pending status with estimated time; allow speed-up (RBF for BTC) |
| Wrong chain selected | High | Auto-detect chain from wallet; prevent submission if chain mismatch |

**Recommendation:** Keep custodial wallets as the default experience. External wallet connection should be an "Advanced" option for crypto-savvy users.

### 8.2 Gas Fee Variability on ETH

| Scenario | Typical Gas (USD) | Mitigation |
|----------|-------------------|------------|
| Low congestion | $2-5 | Normal flow |
| Medium congestion | $5-15 | Warn user, suggest Polygon |
| High congestion (NFT mints, etc.) | $15-100+ | Block ETH mainnet payments, force Polygon |
| Gas spike during signing | User pays more than quoted | Display real-time gas, refresh estimate before signing |

```typescript
// Gas price circuit breaker
const MAX_ACCEPTABLE_GAS_GWEI = 100; // ~$15 for ERC-20 transfer

async function checkGasAcceptable(provider: ethers.Provider): Promise<boolean> {
  const feeData = await provider.getFeeData();
  const gasGwei = Number(feeData.gasPrice) / 1e9;

  if (gasGwei > MAX_ACCEPTABLE_GAS_GWEI) {
    // Suggest Polygon instead
    return false;
  }
  return true;
}
```

### 8.3 Regulatory Considerations — Kenya VASP Act 2025

| Requirement | CryptoPay Status | Action Needed |
|-------------|-----------------|---------------|
| VASP License (payment processor) | Required | Apply to CBK; deadline Nov 4, 2026 |
| Non-custodial wallet software | Likely exempt | Keep non-custodial flow as pure software, no custody |
| KYC/AML requirements | Required for custodial | Already implemented for custodial; external wallet payments may need enhanced KYC |
| Natural persons cannot be VASPs | Acknowledged | CryptoPay Ltd. is a registered company |
| Stablecoin issuance | Not applicable | CryptoPay does not issue stablecoins |
| Record keeping (7 years) | Required | Ensure all transaction logs retained |

**Key regulatory guidance from the Act:**
- Running a non-custodial wallet app where users hold their own keys is generally **outside** the licensing requirement, provided no other regulated activities (brokerage, custody, exchange) are bundled
- Peer-to-peer wallet-to-wallet transfers remain outside scope
- CryptoPay's payment processing function (crypto-to-M-Pesa) is regulated regardless of custodial model
- The CMA oversees exchanges, brokers, and investment advisors; the CBK oversees wallets and payment processors

### 8.4 Wallet Compatibility Issues

| Issue | Affected Wallets | Mitigation |
|-------|-----------------|------------|
| BTC not supported via WalletConnect | MetaMask, most EVM wallets | Show BTC option only for compatible wallets (Xverse, Trust Wallet) |
| Solana session disconnects | Early Phantom versions | Implement reconnection logic, session recovery |
| Deep link not returning to app | Some Android OEMs | Use universal links as fallback; test on popular Kenyan devices (Samsung, Tecno, Infinix) |
| Old wallet app versions | Various | Enforce minimum WalletConnect v2 support; show upgrade prompt |
| Ledger via mobile | All (limited support) | Document as "desktop only" for hardware wallet users |

### 8.5 Risk Priority Matrix

| Risk | Probability | Impact | Priority | Owner |
|------|-------------|--------|----------|-------|
| Regulatory non-compliance | Medium | Critical | P0 | Legal |
| Gas fee UX confusion | High | Medium | P1 | Frontend |
| Wrong chain transaction | Low | High | P1 | Frontend + Backend |
| Hot wallet compromise | Low | Critical | P0 | Security |
| Wallet compatibility gaps | Medium | Medium | P2 | Frontend |
| API rate limit exhaustion | Medium | Low | P3 | Backend |

---

## References

- [Reown AppKit React Native Installation](https://docs.reown.com/appkit/react-native/core/installation)
- [Reown AppKit React Native Examples](https://github.com/reown-com/react-native-examples)
- [Reown Cloud Dashboard](https://cloud.reown.com)
- [Kenya VASP Act 2025 — Afriwise](https://www.afriwise.com/blog/kenya-now-has-a-crypto-law-virtual-asset-service-providers-vasp-bill-2025)
- [Kenya VASP Act — Bitcoin Magazine Legal Guide](https://bitcoinmagazine.com/legal/kenyas-new-vasp-law-a-no-bs-legal-guide-for-bitcoin-and-crypto-builders)
- [Kenya VASP Act — AMG Advocates](https://www.amgadvocates.com/post/virtual-asset-service-providers-act)
- [CoinPaprika API](https://docs.coinpaprika.com/api-reference/rest-api/introduction)
- [CoinLore API](https://www.coinlore.com/cryptocurrency-data-api)
- [CryptoCompare WebSocket API](https://min-api-v2.cryptocompare.com/documentation/websockets)
- [Mempool.space REST API](https://mempool.space/docs/api/rest)
- [VALR API Documentation](https://docs.valr.com/)
- [Alchemy Pricing](https://www.alchemy.com/pricing)
- [Infura Pricing](https://www.infura.io/pricing)
- [Helius Solana RPC](https://www.helius.dev)
- [bip-utils PyPI](https://pypi.org/project/bip-utils/)
- [Solana Mobile Wallet Adapter](https://docs.solanamobile.com/react-native/using_mobile_wallet_adapter)
- [USDT ERC-20 Contract (Etherscan)](https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7)
- [USDT Polygon Contract (PolygonScan)](https://polygonscan.com/token/0xc2132d05d31c914a87c6611c10748aeb04b58e8f)
