use anchor_lang::prelude::*;

use gem_common::{errors::ErrorCode, *};

use crate::number128::Number128;
use crate::state::FixedRateSchedule;

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize, PartialEq)]
pub enum FarmerState {
    Unstaked,
    Staked,
    PendingCooldown,
}

#[repr(C)]
#[account]
#[derive(Debug)]
pub struct Farmer {
    pub farm: Pubkey,

    // the identity of the farmer = their public key
    pub identity: Pubkey,

    // vault storing all of the farmer's gems
    pub vault: Pubkey,

    pub state: FarmerState,

    // total number of gems at the time when the vault is locked
    pub gems_staked: u64,

    pub min_staking_ends_ts: u64,

    pub cooldown_ends_ts: u64,

    // --------------------------------------- rewards
    pub reward_a: FarmerReward,

    pub reward_b: FarmerReward,
}

impl Farmer {
    pub fn begin_staking(
        &mut self,
        min_staking_period_sec: u64,
        now_ts: u64,
        gems_in_vault: u64,
    ) -> Result<u64, ProgramError> {
        self.state = FarmerState::Staked;
        let previous_gems_staked = self.gems_staked;
        self.gems_staked = gems_in_vault;
        self.min_staking_ends_ts = now_ts.try_add(min_staking_period_sec)?;
        self.cooldown_ends_ts = 0; //zero it out in case it was set before

        Ok(previous_gems_staked)
    }

    pub fn end_staking_begin_cooldown(
        &mut self,
        now_ts: u64,
        cooldown_period_sec: u64,
    ) -> Result<u64, ProgramError> {
        if !self.can_end_staking(now_ts) {
            return Err(ErrorCode::MinStakingNotPassed.into());
        }

        self.state = FarmerState::PendingCooldown;
        let gems_unstaked = self.gems_staked;
        self.gems_staked = 0; //no rewards will accrue during cooldown period
        self.cooldown_ends_ts = now_ts.try_add(cooldown_period_sec)?;

        // msg!(
        //     "{} gems now cooling down for {}",
        //     gems_unstaked,
        //     self.identity
        // );
        Ok(gems_unstaked)
    }

    pub fn end_cooldown(&mut self, now_ts: u64) -> ProgramResult {
        if !self.can_end_cooldown(now_ts) {
            return Err(ErrorCode::CooldownNotPassed.into());
        }

        self.state = FarmerState::Unstaked;
        // zero everything out
        self.gems_staked = 0;
        self.min_staking_ends_ts = 0;
        self.cooldown_ends_ts = 0;

        // msg!(
        //     "gems now unstaked and available for withdrawal for {}",
        //     self.identity
        // );
        Ok(())
    }

    fn can_end_staking(&self, now_ts: u64) -> bool {
        now_ts >= self.min_staking_ends_ts
    }

    fn can_end_cooldown(&self, now_ts: u64) -> bool {
        now_ts >= self.cooldown_ends_ts
    }
}

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct FarmerReward {
    // total, not per gem
    pub paid_out_reward: u64,

    // total, not per gem
    pub accrued_reward: u64,

    pub variable_rate: FarmerVariableRateReward,

    pub fixed_rate: FarmerFixedRateReward,
}

impl FarmerReward {
    pub fn outstanding_reward(&self) -> Result<u64, ProgramError> {
        self.accrued_reward.try_sub(self.paid_out_reward)
    }

    pub fn claim_reward(&mut self, pot_balance: u64) -> Result<u64, ProgramError> {
        let outstanding = self.outstanding_reward()?;
        let to_claim = std::cmp::min(outstanding, pot_balance);

        self.paid_out_reward.try_add_assign(to_claim)?;

        Ok(to_claim)
    }

    pub fn update_variable_reward(
        &mut self,
        newly_accrued_reward: u64,
        accrued_reward_per_gem: Number128,
    ) -> ProgramResult {
        self.accrued_reward.try_add_assign(newly_accrued_reward)?;

        self.variable_rate.last_recorded_accrued_reward_per_gem = accrued_reward_per_gem;

        Ok(())
    }

    pub fn update_fixed_reward(&mut self, now_ts: u64, newly_accrued_reward: u64) -> ProgramResult {
        self.accrued_reward.try_add_assign(newly_accrued_reward)?;

        self.fixed_rate.last_updated_ts = self.fixed_rate.reward_upper_bound(now_ts)?;

        Ok(())
    }
}

#[repr(C)]
#[derive(Debug, Copy, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct FarmerVariableRateReward {
    // used to keep track of how much of the variable reward has been updated for this farmer
    // (read more in variable rate config)
    pub last_recorded_accrued_reward_per_gem: Number128,
}

#[repr(C)]
#[derive(Debug, Copy, Clone, Default, AnchorSerialize, AnchorDeserialize)]
pub struct FarmerFixedRateReward {
    // this is the time the farmer staked
    // can be WAY BACK in the past, if we've rolled them multiple times
    pub begin_staking_ts: u64,

    // this is the time the current reward begins (this + promised duration = end)
    pub begin_schedule_ts: u64,

    // should always be set to upper bound, not just now_ts (except funding)
    pub last_updated_ts: u64,

    pub promised_schedule: FixedRateSchedule,

    pub promised_duration: u64,
}

// todo need a time diagram in README or this might be hard to comprehend
impl FarmerFixedRateReward {
    /// accrued to rolled stakers, whose begin_staking_ts < begin_schedule_ts
    pub fn loyal_staker_bonus_time(&self) -> Result<u64, ProgramError> {
        self.begin_schedule_ts.try_sub(self.begin_staking_ts)
    }

    pub fn end_schedule_ts(&self) -> Result<u64, ProgramError> {
        self.begin_schedule_ts.try_add(self.promised_duration)
    }

    pub fn is_staked(&self) -> bool {
        // these get zeroed out when farmer graduates
        self.begin_staking_ts > 0 && self.begin_schedule_ts > 0
    }

    pub fn is_time_to_graduate(&self, now_ts: u64) -> Result<bool, ProgramError> {
        Ok(now_ts >= self.end_schedule_ts()?)
    }

    pub fn reward_upper_bound(&self, now_ts: u64) -> Result<u64, ProgramError> {
        Ok(std::cmp::min(now_ts, self.end_schedule_ts()?))
    }

    pub fn time_from_staking_to_update(&self) -> Result<u64, ProgramError> {
        self.last_updated_ts.try_sub(self.begin_staking_ts)
    }

    /// (!) intentionally uses begin_staking_ts for both start_from and end_at
    /// in doing so we increase both start_from and end_at by exactly loyal_staker_bonus_time
    pub fn voided_reward(&self, gems: u64) -> Result<u64, ProgramError> {
        let start_from = self.time_from_staking_to_update()?;
        let end_at = self.end_schedule_ts()?.try_sub(self.begin_staking_ts)?;

        self.promised_schedule
            .reward_amount(start_from, end_at, gems)
    }

    /// (!) intentionally uses begin_staking_ts for both start_from and end_at
    /// in doing so we increase both start_from and end_at by exactly loyal_staker_bonus_time
    pub fn newly_accrued_reward(&self, now_ts: u64, gems: u64) -> Result<u64, ProgramError> {
        let start_from = self.time_from_staking_to_update()?;
        let end_at = self
            .reward_upper_bound(now_ts)?
            .try_sub(self.begin_staking_ts)?;

        self.promised_schedule
            .reward_amount(start_from, end_at, gems)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::TierConfig;

    impl FarmerFixedRateReward {
        pub fn new() -> Self {
            Self {
                begin_staking_ts: 100,
                begin_schedule_ts: 150,
                last_updated_ts: 155,
                promised_schedule: FixedRateSchedule {
                    base_rate: 3,
                    tier1: Some(TierConfig {
                        reward_rate: 5,
                        required_tenure: 55,
                    }),
                    tier2: Some(TierConfig {
                        reward_rate: 7,
                        required_tenure: 65,
                    }),
                    tier3: Some(TierConfig {
                        reward_rate: 11,
                        required_tenure: 75,
                    }),
                    denominator: 1,
                },
                promised_duration: 60,
            }
        }
    }

    impl FarmerReward {
        pub fn new() -> Self {
            Self {
                paid_out_reward: 0,
                accrued_reward: 123,
                variable_rate: FarmerVariableRateReward {
                    last_recorded_accrued_reward_per_gem: Number128::from(10u64),
                },
                fixed_rate: FarmerFixedRateReward::new(),
            }
        }
    }

    #[test]
    fn test_farmer_fixed_rate_reward() {
        let r = FarmerFixedRateReward::new();

        assert_eq!(50, r.loyal_staker_bonus_time().unwrap());
        assert_eq!(210, r.end_schedule_ts().unwrap());
        assert_eq!(true, r.is_time_to_graduate(210).unwrap());
        assert_eq!(210, r.reward_upper_bound(250).unwrap());
        assert_eq!(55, r.time_from_staking_to_update().unwrap());

        // last update - staking = 55
        // ub - staking = 110
        // reward accrues for a total of 55s, with 50s bonus and 5s coming from current staking period
        assert_eq!((50 + 70 + 11 * 35) * 10, r.voided_reward(10).unwrap());

        // last update - staking = 55
        // now - staking = 85
        // reward accrues for a total of 30s, with 50s bonus and 5s coming from current staking period
        assert_eq!(
            (50 + 70 + 110) * 10,
            r.newly_accrued_reward(185, 10).unwrap()
        );
    }

    #[test]
    fn test_farmer_reward_update_variable() {
        let mut r = FarmerReward::new();
        assert_eq!(123, r.outstanding_reward().unwrap());

        r.update_variable_reward(10, Number128::from(50u64))
            .unwrap();
        assert_eq!(133, r.outstanding_reward().unwrap());
        assert_eq!(
            Number128::from(50u64),
            r.variable_rate.last_recorded_accrued_reward_per_gem
        );
    }

    #[test]
    fn test_farmer_reward_update_fixed() {
        let mut r = FarmerReward::new();
        assert_eq!(123, r.outstanding_reward().unwrap());

        r.update_fixed_reward(9999, 10).unwrap();
        assert_eq!(133, r.outstanding_reward().unwrap());
        assert_eq!(210, r.fixed_rate.last_updated_ts);
    }

    #[test]
    fn test_farmer_reward_claim() {
        let mut r = FarmerReward::new();
        assert_eq!(123, r.outstanding_reward().unwrap());

        r.claim_reward(100).unwrap();
        assert_eq!(23, r.outstanding_reward().unwrap());
    }
}
