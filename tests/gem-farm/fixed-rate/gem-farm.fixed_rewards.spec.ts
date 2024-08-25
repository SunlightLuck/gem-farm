// import * as anchor from '@project-serum/anchor';
// import { BN } from '@project-serum/anchor';
// import {
//   FarmConfig,
//   FixedRateConfig,
//   GemFarmClient,
//   PeriodConfig,
//   RewardType,
// } from './gem-farm.client';
// import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
// import chai, { assert, expect } from 'chai';
// import chaiAsPromised from 'chai-as-promised';
// import { Token } from '@solana/spl-token';
// import { pause } from '../utils/types';
// import { prepGem } from '../utils/gem-common';
// import { ITokenData } from '../utils/account';
// import { printStructsGeneric } from './gem-farm.common';
//
// chai.use(chaiAsPromised);
//
// const _provider = anchor.Provider.env();
// const gf = new GemFarmClient(
//   _provider.connection,
//   _provider.wallet as anchor.Wallet
// );
//
// const config = <FixedRateConfig>{
//   period1: <PeriodConfig>{
//     //per gem per second
//     rate: new BN(5),
//     //seconds it lasts
//     durationSec: new BN(3),
//   },
//   period2: <PeriodConfig>{
//     rate: new BN(10),
//     durationSec: new BN(3),
//   },
//   period3: <PeriodConfig>{
//     //setting this to 0 let's us get deterministic test results
//     //since the last leg is empty, as long as staking is delayed <6s we don't care
//     rate: new BN(0),
//     durationSec: new BN(6),
//   },
//   gemsFunded: new BN(1000),
// };
//
// function totalRewardsPerGem() {
//   const p1 = config.period1.rate.mul(config.period1.durationSec);
//   const p2 = config.period2!.rate.mul(config.period2!.durationSec);
//   const p3 = config.period3!.rate.mul(config.period3!.durationSec);
//
//   return p1.add(p2).add(p3);
// }
//
// function totalDuration() {
//   const p1 = config.period1.durationSec;
//   const p2 = config.period2!.durationSec;
//   const p3 = config.period3!.durationSec;
//
//   return p1.add(p2).add(p3);
// }
//
// function totalRewardsAmount() {
//   return config.gemsFunded.mul(totalRewardsPerGem());
// }
//
// describe('gem farm (fixed rewards)', () => {
//   //farm + bank
//   let bank: Keypair;
//   let farm: Keypair;
//   let farmManager: Keypair;
//
//   //farmers + vaults
//   let farmer1Identity: Keypair;
//   let farmer1Vault: PublicKey;
//   let farmer2Identity: Keypair;
//   let farmer2Vault: PublicKey;
//
//   //rewards + funder
//   const reward = 'rewardA'; //todo switch
//   let rewardMint: Token;
//   let rewardSource: PublicKey;
//   let rewardSecondMint: Token;
//   const funder = gf.wallet.payer;
//
//   //gem 1 used by farmer 1
//   let gem1Amount: anchor.BN;
//   let gem1: ITokenData;
//
//   //gem 2 used by farmer 2
//   let gem2Amount: anchor.BN;
//   let gem2: ITokenData;
//
//   async function printStructs(state: string) {
//     await printStructsGeneric(
//       gf,
//       state,
//       farm,
//       farmer1Identity,
//       farmer2Identity
//     );
//   }
//
//   async function prepFarmer(identity: Keypair) {
//     return gf.initFarmer(farm.publicKey, identity, identity);
//   }
//
//   async function prepAuthorization() {
//     return gf.authorizeFunder(farm.publicKey, farmManager, funder.publicKey);
//   }
//
//   async function prepFundReward() {
//     return gf.fundReward(
//       farm.publicKey,
//       rewardMint.publicKey,
//       funder,
//       rewardSource,
//       null,
//       config
//     );
//   }
//
//   beforeEach('configures accounts', async () => {
//     farm = Keypair.generate();
//     bank = Keypair.generate();
//     farmManager = await gf.createWallet(100 * LAMPORTS_PER_SOL);
//
//     farmer1Identity = await gf.createWallet(100 * LAMPORTS_PER_SOL);
//     farmer2Identity = await gf.createWallet(100 * LAMPORTS_PER_SOL);
//
//     rewardMint = await gf.createToken(0, funder.publicKey);
//     rewardSource = await gf.createAndFundATA(
//       rewardMint,
//       funder,
//       totalRewardsAmount()
//     );
//     rewardSecondMint = await gf.createToken(0, funder.publicKey);
//
//     //init the farm
//     const farmConfig = <FarmConfig>{
//       minStakingPeriodSec: new BN(0),
//       cooldownPeriodSec: new BN(0),
//       unstakingFeeLamp: new BN(LAMPORTS_PER_SOL),
//     };
//
//     await gf.initFarm(
//       farm,
//       farmManager,
//       farmManager,
//       bank,
//       rewardMint.publicKey,
//       RewardType.Fixed,
//       rewardSecondMint.publicKey,
//       RewardType.Fixed,
//       farmConfig
//     );
//
//     //init farmers
//     ({ vault: farmer1Vault } = await prepFarmer(farmer1Identity));
//     ({ vault: farmer2Vault } = await prepFarmer(farmer2Identity));
//
//     //fund the farm
//     await prepAuthorization();
//     await prepFundReward();
//
//     //create gems
//     ({ gemAmount: gem1Amount, gem: gem1 } = await prepGem(gf, farmer1Identity));
//     ({ gemAmount: gem2Amount, gem: gem2 } = await prepGem(gf, farmer2Identity));
//   });
//
//   async function prepDeposit(gems: BN, identity: Keypair) {
//     const isFarmer1 =
//       identity.publicKey.toBase58() === farmer1Identity.publicKey.toBase58();
//
//     return gf.depositGem(
//       bank.publicKey,
//       isFarmer1 ? farmer1Vault : farmer2Vault,
//       identity,
//       gems,
//       isFarmer1 ? gem1.tokenMint : gem2.tokenMint,
//       isFarmer1 ? gem1.tokenAcc : gem2.tokenAcc
//     );
//   }
//
//   async function prepRefreshFarmer(identity: Keypair) {
//     return gf.refreshFarmer(farm.publicKey, identity);
//   }
//
//   async function depositAndStake(gems: BN, identity: Keypair) {
//     //deposit some gems into the vault
//     await prepDeposit(gems, identity);
//
//     const { farmer, vault } = await gf.stake(farm.publicKey, identity);
//
//     let vaultAcc = await gf.fetchVaultAcc(vault);
//     assert.isTrue(vaultAcc.locked);
//
//     let farmerAcc = await gf.fetchFarmerAcc(farmer);
//     assert(farmerAcc.gemsStaked.eq(gems));
//   }
//
//   async function unstakeOnce(gems: BN, identity: Keypair) {
//     const { vault } = await gf.unstake(farm.publicKey, identity);
//
//     const vaultAcc = await gf.fetchVaultAcc(vault);
//     assert.isTrue(vaultAcc.locked);
//   }
//
//   async function unstakeTwice(gems: BN, identity: Keypair) {
//     const { farmer, vault } = await gf.unstake(farm.publicKey, identity);
//
//     const vaultAcc = await gf.fetchVaultAcc(vault);
//     assert.isFalse(vaultAcc.locked);
//
//     const farmerAcc = await gf.fetchFarmerAcc(farmer);
//     assert(farmerAcc.gemsStaked.eq(new BN(0)));
//   }
//
//   it('stakes / unstakes gems (multi farmer)', async () => {
//     // ----------------- deposit + stake both farmers
//     await depositAndStake(gem1Amount, farmer1Identity);
//     await depositAndStake(gem2Amount, farmer2Identity);
//     // await printStructs('STAKED');
//
//     let farmAcc = await gf.fetchFarmAcc(farm.publicKey);
//     assert(farmAcc.stakedFarmerCount.eq(new BN(2)));
//     assert(farmAcc.gemsStaked.eq(gem1Amount.add(gem2Amount)));
//
//     // ----------------- wait till the end of reward schedule (to accrue full rewards)
//     await pause(13000); //1s longer than the schedule
//
//     const { farmer: farmer1 } = await prepRefreshFarmer(farmer1Identity);
//     const { farmer: farmer2 } = await prepRefreshFarmer(farmer2Identity);
//     // await printStructs('WAITED');
//
//     farmAcc = await gf.fetchFarmAcc(farm.publicKey);
//
//     //verify farmer count adds up
//     assert(farmAcc.stakedFarmerCount.eq(new BN(2)));
//
//     //verify gem count adds up
//     assert(farmAcc.gemsStaked.eq(gem1Amount.add(gem2Amount)));
//     assert(
//       farmAcc.gemsStaked.eq(farmAcc[reward].fixedRateTracker.gemsParticipating)
//     );
//
//     //verify accrued rewards add up
//     const totalAccruedToStakers =
//       farmAcc[reward].fixedRateTracker.totalAccruedToStakers;
//
//     const farmer1Acc = await gf.fetchFarmerAcc(farmer1);
//     const accruedFarmer1 = farmer1Acc[reward].accruedReward;
//
//     const farmer2Acc = await gf.fetchFarmerAcc(farmer2);
//     const accruedFarmer2 = farmer2Acc[reward].accruedReward;
//
//     assert(totalAccruedToStakers.eq(accruedFarmer1.add(accruedFarmer2)));
//
//     //verify reward rate * gems staked = total accrued
//     assert(
//       totalAccruedToStakers.eq(farmAcc.gemsStaked.mul(totalRewardsPerGem()))
//     );
//
//     //verify gems made whole
//     assert(
//       farmAcc[reward].fixedRateTracker.gemsParticipating.eq(
//         farmAcc[reward].fixedRateTracker.gemsMadeWhole
//       )
//     );
//
//     // ----------------- unstake once to move into cooldown
//     await unstakeOnce(gem1Amount, farmer1Identity);
//     await unstakeOnce(gem1Amount, farmer2Identity);
//
//     // ----------------- unstake second time to actually open up the vault for withdrawing
//     await unstakeTwice(gem1Amount, farmer1Identity);
//     await unstakeTwice(gem1Amount, farmer2Identity);
//     // await printStructs('UNSTAKED');
//
//     farmAcc = await gf.fetchFarmAcc(farm.publicKey);
//     assert(farmAcc.stakedFarmerCount.eq(new BN(0)));
//     assert(farmAcc.gemsStaked.eq(new BN(0)));
//   });
//
//   async function verifyFunding(amount: BN) {
//     const farmAcc = await gf.fetchFarmAcc(farm.publicKey);
//     assert(
//       farmAcc[reward].fixedRateTracker.netRewardFunding.eq(amount)
//     );
//     assert(farmAcc[reward].rewardDurationSec.eq(totalDuration()));
//     assert(farmAcc[reward].rewardEndTs.gt(totalDuration()));
//   }
//
//   async function prepCancelReward() {
//     return gf.cancelReward(
//       farm.publicKey,
//       farmManager,
//       rewardMint.publicKey,
//       funder.publicKey
//     );
//   }
//
//   async function prepLockFunding() {
//     return gf.lockReward(farm.publicKey, farmManager, rewardMint.publicKey);
//   }
//
//   it('cancels / refunds / locks the farm', async () => {
//     //verify funding done in "before" block
//     await verifyFunding(totalRewardsAmount());
//
//     //cancel + verify
//     await prepCancelReward();
//     await printStructs('CANCELLED');
//
//     await verifyFunding(new BN(0));
//
//     //expect lock to fail because insufficient funding is provided after withdrawal
//     await expect(prepLockFunding()).to.be.rejectedWith('0x159');
//
//     //fund again + verify
//     await prepFundReward();
//     await verifyFunding(totalRewardsAmount());
//
//     //this time works
//     await prepLockFunding();
//
//     const farmAcc = await gf.fetchFarmAcc(farm.publicKey);
//     farmAcc[reward].lockEndTs.gt(new BN(0));
//   });
//
//   it('overfunds the farm, then locks', async () => {
//     //verify funding done in "before" block
//     await verifyFunding(totalRewardsAmount());
//
//     //we'll need some more tokens
//     await rewardMint.mintTo(
//       rewardSource,
//       gf.wallet.payer,
//       [],
//       totalRewardsAmount().toNumber()
//     );
//
//     //fund a 2nd time
//     await prepFundReward();
//     await verifyFunding(totalRewardsAmount().mul(new BN(2)));
//
//     //should work ok
//     await prepLockFunding();
//
//     const farmAcc = await gf.fetchFarmAcc(farm.publicKey);
//     farmAcc[reward].lockEndTs.gt(new BN(0));
//   });
// });
