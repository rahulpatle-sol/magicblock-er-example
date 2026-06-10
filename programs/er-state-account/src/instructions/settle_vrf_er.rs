use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_accounts};
use switchboard_on_demand::RandomnessAccountData;

use crate::state::UserAccount;
use crate::instructions::request_vrf::VrfError;

#[commit]
#[derive(Accounts)]
pub struct SettleVrfEr<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    /// CHECK: parsed as Switchboard RandomnessAccountData
    pub randomness_account_data: UncheckedAccount<'info>,
}

impl<'info> SettleVrfEr<'info> {
    pub fn settle_vrf_er(&mut self) -> Result<()> {
        let user_account = &mut self.user_account;

        require_keys_eq!(
            self.randomness_account_data.key(),
            user_account.randomness_account,
            VrfError::InvalidRandomnessAccount
        );

        let clock = Clock::get()?;
        let randomness_data = RandomnessAccountData::parse(
            self.randomness_account_data.data.borrow()
        ).map_err(|_| VrfError::InvalidRandomnessAccount)?;

        require!(
            randomness_data.seed_slot == user_account.commit_slot,
            VrfError::RandomnessExpired
        );

        let revealed = randomness_data
            .get_value(clock.slot)
            .map_err(|_| VrfError::RandomnessNotResolved)?;

        let random_value = u64::from_le_bytes(
            revealed[0..8].try_into().unwrap()
        );

        user_account.data = random_value;

        commit_accounts(
            &self.user.to_account_info(),
            vec![&self.user_account.to_account_info()],
            &self.magic_context,
            &self.magic_program
        )?;

        msg!("VRF settled inside ER and committed. Random value: {}", random_value);
        Ok(())
    }
}
