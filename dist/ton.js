"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTonClient = getTonClient;
exports.getAdminWallet = getAdminWallet;
exports.getAdminAddress = getAdminAddress;
exports.getAdminBalance = getAdminBalance;
exports.sendTon = sendTon;
exports.buildPaymentLink = buildPaymentLink;
exports.calculatePayout = calculatePayout;
exports.computeOdds = computeOdds;
exports.isValidTonAddress = isValidTonAddress;
exports.fetchRecentTransactions = fetchRecentTransactions;
const ton_1 = require("@ton/ton");
const crypto_1 = require("@ton/crypto");
function getTonClient() {
    return new ton_1.TonClient({
        endpoint: process.env.TON_NETWORK === 'mainnet'
            ? 'https://toncenter.com/api/v2/jsonRPC'
            : 'https://testnet.toncenter.com/api/v2/jsonRPC',
    });
}
async function getAdminWallet() {
    const mnemonic = (process.env.ADMIN_MNEMONIC || '').split(' ');
    const keyPair = await (0, crypto_1.mnemonicToPrivateKey)(mnemonic);
    const wallet = ton_1.WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
    return { wallet, keyPair };
}
async function getAdminAddress() {
    const { wallet } = await getAdminWallet();
    return wallet.address.toString({ bounceable: false });
}
async function getAdminBalance() {
    const client = getTonClient();
    const { wallet } = await getAdminWallet();
    const balance = await client.open(wallet).getBalance();
    return (0, ton_1.fromNano)(balance);
}
async function sendTon(toAddress, amountTon, comment) {
    const client = getTonClient();
    const { wallet, keyPair } = await getAdminWallet();
    const contract = client.open(wallet);
    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
        secretKey: keyPair.secretKey,
        seqno,
        messages: [
            (0, ton_1.internal)({
                to: ton_1.Address.parse(toAddress),
                value: (0, ton_1.toNano)(amountTon.toFixed(9)),
                bounce: false,
                body: comment,
            }),
        ],
    });
    // Space out sends to avoid seqno conflicts
    await new Promise(r => setTimeout(r, 2500));
}
function buildPaymentLink(toAddress, amountTon, betId, side, positionId) {
    const comment = encodeURIComponent(`BET-${betId}-${side}-${positionId}`);
    const nanotons = Math.floor(amountTon * 1e9);
    return `ton://transfer/${toAddress}?amount=${nanotons}&text=${comment}`;
}
function calculatePayout(stake, winningPool, totalPool) {
    if (winningPool === 0)
        return stake;
    return +((stake / winningPool) * totalPool * 0.98).toFixed(6);
}
function computeOdds(yesPool, noPool) {
    const total = yesPool + noPool;
    if (total === 0)
        return { yesOdds: null, noOdds: null };
    return {
        yesOdds: yesPool > 0 ? +(total / yesPool).toFixed(3) : null,
        noOdds: noPool > 0 ? +(total / noPool).toFixed(3) : null,
    };
}
function isValidTonAddress(addr) {
    try {
        ton_1.Address.parse(addr);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Fetch recent incoming transactions for the admin wallet from toncenter.
 * Returns raw transaction objects from the toncenter v2 API.
 */
async function fetchRecentTransactions(limit = 50) {
    const address = await getAdminAddress();
    const base = process.env.TON_NETWORK === 'mainnet'
        ? 'https://toncenter.com/api/v2'
        : 'https://testnet.toncenter.com/api/v2';
    const url = `${base}/getTransactions?address=${address}&limit=${limit}&archival=false`;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Toncenter error: ${res.status}`);
    const json = await res.json();
    if (!json.ok)
        throw new Error('Toncenter returned ok=false');
    return json.result;
}
