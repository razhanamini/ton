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
  const balance = await client.open(wallet).getBalance();
  return fromNano(balance);
}

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
  // Space out sends to avoid seqno conflicts
  await new Promise(r => setTimeout(r, 2500));
}

export function buildPaymentLink(
  toAddress: string, amountTon: number,
  betId: number, side: 'yes' | 'no', positionId: number
): string {
  const comment = encodeURIComponent(`BET-${betId}-${side}-${positionId}`);
  const nanotons = Math.floor(amountTon * 1e9);
  return `ton://transfer/${toAddress}?amount=${nanotons}&text=${comment}`;
}

export function calculatePayout(stake: number, winningPool: number, totalPool: number): number {
  if (winningPool === 0) return stake;
  return +((stake / winningPool) * totalPool * 0.98).toFixed(6);
}

export function computeOdds(yesPool: number, noPool: number) {
  const total = yesPool + noPool;
  if (total === 0) return { yesOdds: null, noOdds: null };
  return {
    yesOdds: yesPool > 0 ? +(total / yesPool).toFixed(3) : null,
    noOdds: noPool > 0 ? +(total / noPool).toFixed(3) : null,
  };
}

export function isValidTonAddress(addr: string): boolean {
  try { Address.parse(addr); return true; } catch { return false; }
}

/**
 * Fetch recent incoming transactions for the admin wallet from toncenter.
 * Returns raw transaction objects from the toncenter v2 API.
 */
export async function fetchRecentTransactions(limit = 50): Promise<ToncenterTx[]> {
  const address = await getAdminAddress();
  const base = process.env.TON_NETWORK === 'mainnet'
    ? 'https://toncenter.com/api/v2'
    : 'https://testnet.toncenter.com/api/v2';

  const url = `${base}/getTransactions?address=${address}&limit=${limit}&archival=false`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Toncenter error: ${res.status}`);
  const json = await res.json() as { ok: boolean; result: ToncenterTx[] };
  if (!json.ok) throw new Error('Toncenter returned ok=false');
  return json.result;
}

export interface ToncenterTx {
  transaction_id: { hash: string; lt: string };
  in_msg?: {
    source: string;
    value: string;       // nanotons as string
    message?: string;    // comment
  };
}