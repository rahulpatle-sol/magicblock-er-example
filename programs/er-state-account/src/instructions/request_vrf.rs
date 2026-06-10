use anchor_lang::prelude::*;
use switchboard_on_demand::RandomnessAccountData;

use crate::state::UserAccount;

#[derive(Accounts)]
pub struct RequestVrf<'info> {
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

impl<'info> RequestVrf<'info> {
    pub fn request_vrf(&mut self, randomness_account: Pubkey) -> Result<()> {
        require_keys_eq!(
            self.randomness_account_data.key(),
            randomness_account,
            VrfError::InvalidRandomnessAccount
        );

        let clock = Clock::get()?;
        let randomness_data = RandomnessAccountData::parse(
            self.randomness_account_data.data.borrow()
        ).map_err(|_| VrfError::InvalidRandomnessAccount)?;

        let prev_slot = clock.slot.checked_sub(1)
            .ok_or(VrfError::RandomnessExpired)?;
        require!(
            randomness_data.seed_slot == prev_slot,
            VrfError::RandomnessExpired
        );

        require!(
            randomness_data.get_value(clock.slot).is_err(),
            VrfError::RandomnessAlreadyRevealed
        );

        let user_account = &mut self.user_account;
        user_account.randomness_account = randomness_account;
        user_account.commit_slot = randomness_data.seed_slot;
        user_account.data = 0;

        msg!("VRF requested. Commit slot: {}", randomness_data.seed_slot);
        Ok(())
    }
}

#[error_code]
pub enum VrfError {
    #[msg("Randomness has expired.")]
    RandomnessExpired,
    #[msg("Randomness already revealed.")]
    RandomnessAlreadyRevealed,
    #[msg("Randomness not yet resolved.")]
    RandomnessNotResolved,
    #[msg("Invalid randomness account.")]
    InvalidRandomnessAccount,
}
