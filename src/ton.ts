import { TonClient, WalletContractV4, internal, toNano, fromNano, Address } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';

export function getTonClient(): TonClient {
  return new TonClient({
    endpoint: process.env.TON_NETWORK === 'mainnet'
      ? 'https://toncenter.com/api/v2/jsonRPC'
      : 'https://testnet.toncenter.com/api/v2/jsonRPC',
  });
}

export async function getAdminWallet() {
  const mnemonic = (process.env.ADMIN_MNEMONIC || '').split(' ');
  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
  return { wallet, keyPair };
}

export async function getAdminAddress(): Promise<string> {
  const { wallet } = await getAdminWallet();
  return wallet.address.toString({ bounceable: false });
}

export async function getAdminBalance(): Promise<string> {
  const client = getTonClient();
  const { wallet } = await getAdminWallet();
  const contract = client.open(wallet);
  const balance = await contract.getBalance();
  return fromNano(balance);
}

/**
 * Send TON from the admin wallet to a recipient address.
 * This is how winners receive their payouts.
 */
export async function sendTon(toAddress: string, amountTon: number, comment: string): Promise<void> {
  const client = getTonClient();
  const { wallet, keyPair } = await getAdminWallet();
  const contract = client.open(wallet);
  const seqno = await contract.getSeqno();

  await contract.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno,
    messages: [
      internal({
        to: Address.parse(toAddress),
        value: toNano(amountTon.toFixed(9)),
        bounce: false,
        body: comment,
      }),
    ],
  });

  // Wait a couple seconds between sends to avoid seqno collision
  await new Promise(r => setTimeout(r, 2000));
}

/**
 * Build a ton:// deep link so user can pay from their TON wallet app.
 * Comment encodes: BET-<betId>-<side>-<userId>
 */
export function buildPaymentLink(
  toAddress: string,
  amountTon: number,
  betId: number,
  side: 'yes' | 'no',
  userId: number
): string {
  const comment = encodeURIComponent(`BET-${betId}-${side}-${userId}`);
  const nanotons = Math.floor(amountTon * 1e9);
  return `ton://transfer/${toAddress}?amount=${nanotons}&text=${comment}`;
}

/**
 * Calculate winner payout.
 * Formula: (their_stake / winning_pool) * total_pool * (1 - fee)
 */
export function calculatePayout(stake: number, winningPool: number, totalPool: number): number {
  if (winningPool === 0) return stake; // full refund if nobody on winning side
  const gross = (stake / winningPool) * totalPool;
  const afterFee = gross * 0.98; // 2% house fee
  return +afterFee.toFixed(6);
}

/**
 * Validate a TON address string (basic check).
 */
export function isValidTonAddress(addr: string): boolean {
  try {
    Address.parse(addr);
    return true;
  } catch {
    return false;
  }
}