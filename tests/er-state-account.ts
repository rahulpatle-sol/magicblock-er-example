import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey, Keypair } from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import * as sb from "@switchboard-xyz/on-demand";
import { ErStateAccount } from "../target/types/er_state_account";

describe("er-state-account", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet.magicblock.app/", {wsEndpoint: process.env.EPHEMERAL_WS_ENDPOINT || "wss://devnet.magicblock.app/"}
    ),
    anchor.Wallet.local()
  );
  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log("Ephemeral Rollup Connection: ", providerEphemeralRollup.connection.rpcEndpoint);
  console.log(`Current SOL Public Key: ${anchor.Wallet.local().publicKey}`)

  before(async function () {
    const balance = await provider.connection.getBalance(anchor.Wallet.local().publicKey)
    console.log('Current balance is', balance / LAMPORTS_PER_SOL, ' SOL','\n')
  })

  const program = anchor.workspace.erStateAccount as Program<ErStateAccount>;

  const userAccount = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user"), anchor.Wallet.local().publicKey.toBuffer()],
    program.programId
  )[0];

  it("Is initialized!", async () => {
    const tx = await program.methods.initialize().accountsPartial({
      user: anchor.Wallet.local().publicKey,
      userAccount: userAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
    console.log("User Account initialized: ", tx);
  });

  it("Update State!", async () => {
    const tx = await program.methods.update(new anchor.BN(42)).accountsPartial({
      user: anchor.Wallet.local().publicKey,
      userAccount: userAccount,
    })
    .rpc();
    console.log("\nUser Account State Updated: ", tx);
  });

  it("Delegate to Ephemeral Rollup!", async () => {

    let tx = await program.methods.delegate().accountsPartial({
      user: anchor.Wallet.local().publicKey,
      userAccount: userAccount,
      validator: new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc({skipPreflight: true});

    console.log("\nUser Account Delegated to Ephemeral Rollup: ", tx);
  });

  it("Update State and Commit to Base Layer!", async () => {
    let tx = await program.methods.updateCommit(new anchor.BN(43)).accountsPartial({
      user: providerEphemeralRollup.wallet.publicKey,
      userAccount: userAccount,
    })
    .transaction();

    tx.feePayer = providerEphemeralRollup.wallet.publicKey;

    tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {skipPreflight: false});
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      providerEphemeralRollup.connection
  );

    console.log("\nUser Account State Updated: ", txHash);
  });

  it("Commit and undelegate from Ephemeral Rollup!", async () => {
    let info = await providerEphemeralRollup.connection.getAccountInfo(userAccount);

    console.log("User Account Info: ", info);

    console.log("User account", userAccount.toBase58());

    let tx = await program.methods.undelegate().accounts({
      user: providerEphemeralRollup.wallet.publicKey,
    })
    .transaction();

    tx.feePayer = providerEphemeralRollup.wallet.publicKey;

    tx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {skipPreflight: false});
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      providerEphemeralRollup.connection
  );

    console.log("\nUser Account Undelegated: ", txHash);
  });

  it("Update State!", async () => {
    let tx = await program.methods.update(new anchor.BN(45)).accountsPartial({
      user: anchor.Wallet.local().publicKey,
      userAccount: userAccount,
    })
    .rpc();

    console.log("\nUser Account State Updated: ", tx);
  });

  it("Close Account!", async () => {
    const tx = await program.methods.close().accountsPartial({
      user: anchor.Wallet.local().publicKey,
      userAccount: userAccount,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
    console.log("\nUser Account Closed: ", tx);
  });

  // ─── VRF Tests ──────────────────────────────────────────────────────────
  //
  // These tests use Switchboard On-Demand Randomness.
  // Requires: npm install @switchboard-xyz/on-demand
  // Requires: Devnet SOL in the wallet (~2 SOL for VRF account rent)
  //
  // The VRF flow uses a commit-reveal pattern:
  //   1. Create randomness account
  //   2. commitIx + requestVrf (same tx, same slot)
  //   3. Wait for oracle fulfillment
  //   4. revealIx + settleVrf  (same tx, same slot)

  const COMMIT_REVEAL_WAIT_MS = 3_000;
  const REVEAL_RETRIES = 5;
  const REVEAL_BACKOFF_MS = 2_000;

  it("VRF (outside ER): Request randomness", async () => {
    const queue = await sb.getDefaultQueue(provider.connection.rpcEndpoint);
    const sbProgram = queue.program;

    const rngKp = Keypair.generate();
    console.log("VRF randomness account:", rngKp.publicKey.toBase58());

    const [randomness, createIx] = await sb.Randomness.create(
      sbProgram,
      rngKp,
      queue.pubkey,
      provider.wallet.publicKey,
    );

    const createTx = await sb.asV0Tx({
      connection: provider.connection,
      ixs: [createIx],
      signers: [provider.wallet.payer, rngKp],
      payer: provider.wallet.publicKey,
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });
    const createSig = await provider.connection.sendTransaction(createTx);
    await provider.connection.confirmTransaction(createSig, "confirmed");
    console.log("VRF account created:", createSig);

    // Build commitIx + requestVrf in same transaction
    const commitIx = await randomness.commitIx(queue.pubkey, provider.wallet.publicKey);
    const requestVrfIx = await program.methods
      .requestVrf(rngKp.publicKey)
      .accountsPartial({
        randomnessAccountData: rngKp.publicKey,
        user: provider.wallet.publicKey,
        userAccount: userAccount,
      })
      .instruction();

    const commitTx = await sb.asV0Tx({
      connection: provider.connection,
      ixs: [commitIx, requestVrfIx],
      signers: [provider.wallet.payer],
      payer: provider.wallet.publicKey,
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });
    const commitSig = await provider.connection.sendTransaction(commitTx);
    await provider.connection.confirmTransaction(commitSig, "confirmed");
    console.log("VRF requested (commit tx):", commitSig);
  });

  it("VRF (outside ER): Settle randomness", async () => {
    const queue = await sb.getDefaultQueue(provider.connection.rpcEndpoint);
    const sbProgram = queue.program;

    // Look up the randomness account that was created in the request step
    const userState = await program.account.userAccount.fetch(userAccount);
    const randomnessPubkey = userState.randomnessAccount;

    if (randomnessPubkey.equals(PublicKey.default)) {
      console.log("No VRF request found, skipping settle. Run VRF request test first.");
      return;
    }

    console.log("Settling randomness for account:", randomnessPubkey.toBase58());

    // Wait for oracle
    await new Promise((r) => setTimeout(r, COMMIT_REVEAL_WAIT_MS));

    const randomness = new sb.Randomness(sbProgram, randomnessPubkey);

    let revealIx;
    for (let attempt = 1; attempt <= REVEAL_RETRIES; attempt++) {
      try {
        revealIx = await randomness.revealIx(provider.wallet.publicKey);
        break;
      } catch (e) {
        if (attempt === REVEAL_RETRIES) throw e;
        console.log(`Reveal not ready (attempt ${attempt}), retrying...`);
        await new Promise((r) => setTimeout(r, REVEAL_BACKOFF_MS));
      }
    }

    const settleVrfIx = await program.methods
      .settleVrf()
      .accountsPartial({
        randomnessAccountData: randomnessPubkey,
        user: provider.wallet.publicKey,
        userAccount: userAccount,
      })
      .instruction();

    const settleTx = await sb.asV0Tx({
      connection: provider.connection,
      ixs: [revealIx, settleVrfIx],
      signers: [provider.wallet.payer],
      payer: provider.wallet.publicKey,
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });
    const settleSig = await provider.connection.sendTransaction(settleTx);
    await provider.connection.confirmTransaction(settleSig, "confirmed");
    console.log("VRF settled (reveal tx):", settleSig);

    const finalState = await program.account.userAccount.fetch(userAccount);
    console.log("User data updated with random value:", finalState.data.toString());
  });

  it("VRF (inside ER): Request randomness on delegated account", async () => {
    // First re-delegate the account
    let tx = await program.methods.delegate().accountsPartial({
      user: anchor.Wallet.local().publicKey,
      userAccount: userAccount,
      validator: new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
      systemProgram: anchor.web3.SystemProgram.programId,
    }).rpc({skipPreflight: true});

    const queue = await sb.getDefaultQueue(provider.connection.rpcEndpoint);
    const sbProgram = queue.program;

    const rngKp = Keypair.generate();
    console.log("VRF ER randomness account:", rngKp.publicKey.toBase58());

    const [randomness, createIx] = await sb.Randomness.create(
      sbProgram,
      rngKp,
      queue.pubkey,
      provider.wallet.publicKey,
    );

    const createTx = await sb.asV0Tx({
      connection: provider.connection,
      ixs: [createIx],
      signers: [provider.wallet.payer, rngKp],
      payer: provider.wallet.publicKey,
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });
    const createSig = await provider.connection.sendTransaction(createTx);
    await provider.connection.confirmTransaction(createSig, "confirmed");
    console.log("VRF ER account created:", createSig);

    const commitIx = await randomness.commitIx(queue.pubkey, provider.wallet.publicKey);
    const requestVrfErIx = await program.methods
      .requestVrfEr(rngKp.publicKey)
      .accountsPartial({
        randomnessAccountData: rngKp.publicKey,
        user: provider.wallet.publicKey,
        userAccount: userAccount,
      })
      .instruction();

    const commitTx = await sb.asV0Tx({
      connection: provider.connection,
      ixs: [commitIx, requestVrfErIx],
      signers: [provider.wallet.payer],
      payer: provider.wallet.publicKey,
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });
    const commitSig = await provider.connection.sendTransaction(commitTx);
    await provider.connection.confirmTransaction(commitSig, "confirmed");
    console.log("VRF ER requested:", commitSig);
  });

  it("VRF (inside ER): Settle randomness with commit", async () => {
    const userState = await program.account.userAccount.fetch(userAccount);
    const randomnessPubkey = userState.randomnessAccount;

    if (randomnessPubkey.equals(PublicKey.default)) {
      console.log("No VRF ER request found, skipping settle.");
      return;
    }

    const queue = await sb.getDefaultQueue(provider.connection.rpcEndpoint);
    const sbProgram = queue.program;

    await new Promise((r) => setTimeout(r, COMMIT_REVEAL_WAIT_MS));

    const randomness = new sb.Randomness(sbProgram, randomnessPubkey);

    let revealIx;
    for (let attempt = 1; attempt <= REVEAL_RETRIES; attempt++) {
      try {
        revealIx = await randomness.revealIx(provider.wallet.publicKey);
        break;
      } catch (e) {
        if (attempt === REVEAL_RETRIES) throw e;
        console.log(`Reveal not ready (attempt ${attempt}), retrying...`);
        await new Promise((r) => setTimeout(r, REVEAL_BACKOFF_MS));
      }
    }

    // Build settleVrfEr tx via ER provider
    let settleTx = await program.methods
      .settleVrfEr()
      .accountsPartial({
        randomnessAccountData: randomnessPubkey,
        user: providerEphemeralRollup.wallet.publicKey,
        userAccount: userAccount,
      })
      .transaction();

    // Add reveal instruction at the beginning
    const tx = await sb.asV0Tx({
      connection: providerEphemeralRollup.connection,
      ixs: [revealIx],
      signers: [providerEphemeralRollup.wallet.payer],
      payer: providerEphemeralRollup.wallet.publicKey,
      computeUnitPrice: 75_000,
      computeUnitLimitMultiple: 1.3,
    });

    // Combine: settle tx goes through ER provider to commit back to base layer
    settleTx.feePayer = providerEphemeralRollup.wallet.publicKey;
    settleTx.recentBlockhash = (await providerEphemeralRollup.connection.getLatestBlockhash()).blockhash;
    settleTx = await providerEphemeralRollup.wallet.signTransaction(settleTx);

    const txHash = await providerEphemeralRollup.sendAndConfirm(settleTx, [], {skipPreflight: false});
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      providerEphemeralRollup.connection
    );
    console.log("VRF ER settled and committed:", txHash);

    const finalState = await program.account.userAccount.fetch(userAccount);
    console.log("User data after VRF ER:", finalState.data.toString());
  });
});
