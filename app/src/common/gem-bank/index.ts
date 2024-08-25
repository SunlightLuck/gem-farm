import * as anchor from '@project-serum/anchor';
import { BN, Idl } from '@project-serum/anchor';
import { GemBankClient } from '../../../../tests/gem-bank/gem-bank.client';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { SignerWalletAdapter } from '@solana/wallet-adapter-base';
import { DEFAULTS } from '@/globals';
import { NodeWallet } from '@metaplex/js';

//when we only want to view vaults, no need to connect a real wallet.
function createFakeWallet() {
  const leakedKp = Keypair.fromSecretKey(
    Uint8Array.from([
      208, 175, 150, 242, 88, 34, 108, 88, 177, 16, 168, 75, 115, 181, 199, 242,
      120, 4, 78, 75, 19, 227, 13, 215, 184, 108, 226, 53, 111, 149, 179, 84,
      137, 121, 79, 1, 160, 223, 124, 241, 202, 203, 220, 237, 50, 242, 57, 158,
      226, 207, 203, 188, 43, 28, 70, 110, 214, 234, 251, 15, 249, 157, 62, 80,
    ])
  );
  return new NodeWallet(leakedKp);
}

//need a separate func coz fetching IDL is async and can't be done in constructor
export async function initGemBank(
  conn: Connection,
  wallet?: SignerWalletAdapter
) {
  const walletToUse = wallet ?? createFakeWallet();
  const idl = await (await fetch('gem_bank.json')).json();
  return new GemBank(conn, walletToUse as anchor.Wallet, idl);
}

export class GemBank extends GemBankClient {
  constructor(conn: Connection, wallet: anchor.Wallet, idl: Idl) {
    const programId = DEFAULTS.GEM_BANK_PROG_ID;
    super(conn, wallet, idl, programId);
  }

  async startBankWallet() {
    const bank = Keypair.generate();
    const txSig = await this.startBank(bank, this.wallet.publicKey);
    return { bank, txSig };
  }

  async createVaultWallet(bank: PublicKey) {
    return this.createVault(bank, this.wallet.publicKey, this.wallet.publicKey);
  }

  async setVaultLockWallet(
    bank: PublicKey,
    vault: PublicKey,
    vaultLocked: boolean
  ) {
    return this.setVaultLock(bank, vault, this.wallet.publicKey, vaultLocked);
  }

  async depositGemWallet(
    bank: PublicKey,
    vault: PublicKey,
    gemAmount: BN,
    gemMint: PublicKey,
    gemSource: PublicKey
  ) {
    return this.depositGem(
      bank,
      vault,
      this.wallet.publicKey,
      gemAmount,
      gemMint,
      gemSource,
      this.wallet.publicKey
    );
  }

  async withdrawGemWallet(
    bank: PublicKey,
    vault: PublicKey,
    gemAmount: BN,
    gemMint: PublicKey,
    gemDestination: PublicKey
  ) {
    return this.withdrawGem(
      bank,
      vault,
      this.wallet.publicKey,
      gemAmount,
      gemMint,
      gemDestination,
      this.wallet.publicKey
    );
  }
}