use anchor_lang::prelude::*;

#[account]
pub struct UserAccount {
    pub user: Pubkey,
    pub data: u64,
    pub bump: u8,
    pub randomness_account: Pubkey,
    pub commit_slot: u64,
}

impl Space for UserAccount {
    const INIT_SPACE: usize = 32 + 8 + 1 + 32 + 8 + 8;
}
