#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

mod state;
mod instructions;

use instructions::*;

declare_id!("E1k8eaY4Cz3GkBLJRUoCVt1vj7TT7VViAvKMgUoZ4Zeb");

#[ephemeral]
#[program]
pub mod er_state_account {

    use super::*;

    pub fn initialize(ctx: Context<InitUser>) -> Result<()> {
        ctx.accounts.initialize(&ctx.bumps)?;
        
        Ok(())
    }

    pub fn update(ctx: Context<UpdateUser>, new_data: u64) -> Result<()> {
        ctx.accounts.update(new_data)?;
        
        Ok(())
    }

    pub fn update_commit(ctx: Context<UpdateCommit>, new_data: u64) -> Result<()> {
        ctx.accounts.update_commit(new_data)?;
        
        Ok(())
    }

    pub fn delegate(ctx: Context<Delegate>) -> Result<()> {
        ctx.accounts.delegate()?;
        
        Ok(())
    }

    pub fn undelegate(ctx: Context<Undelegate>) -> Result<()> {
        ctx.accounts.undelegate()?;
        
        Ok(())
    }

    pub fn close(ctx: Context<CloseUser>) -> Result<()> {
        ctx.accounts.close()?;
        
        Ok(())
    }

    pub fn request_vrf(
        ctx: Context<RequestVrf>,
        randomness_account: Pubkey,
    ) -> Result<()> {
        ctx.accounts.request_vrf(randomness_account)
    }

    pub fn settle_vrf(ctx: Context<SettleVrf>) -> Result<()> {
        ctx.accounts.settle_vrf()
    }

    pub fn request_vrf_er(
        ctx: Context<RequestVrfEr>,
        randomness_account: Pubkey,
    ) -> Result<()> {
        ctx.accounts.request_vrf_er(randomness_account)
    }

    pub fn settle_vrf_er(ctx: Context<SettleVrfEr>) -> Result<()> {
        ctx.accounts.settle_vrf_er()
    }
}
