import { clusterApiUrl } from "@solana/web3.js";
import { ParclV3Sdk } from "@parcl-oss/v3-sdk";


import { ComputeBudgetProgram, SignatureResult, TransactionInstruction } from '@solana/web3.js'
import * as anchor from "@project-serum/anchor";
import {
  createInitializeAccountInstruction,
  createTransferInstruction,
  NATIVE_MINT,
  ACCOUNT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createSyncNativeInstruction,
  createAccount,
  createCloseAccountInstruction,AccountLayout,TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { Keypair,SystemProgram,  Transaction,Connection,PublicKey } from "@solana/web3.js";




async function main() {
  const sdk = new ParclV3Sdk({ rpcUrl: "https://rpc.hellomoon.io/dd0a917e-e732-4c83-8cc6-1128027eb48d"});
  //let exchange1=await sdk.accountFetcher.getExchange("82dGS7Jt4Km8ZgwZVRsJ2V6vPXEhVdgDaMP7cqPGG1TW")
  //let market1=await sdk.accountFetcher.getMarket("7UHPEqFRVgyYtjXuXdL3hxwP8NMBQoeSxBSy23xoKrnG")
  console.log("Started gathering all margin accounts")
  let all_margin_accounts=await sdk.accountFetcher.getAllMarginAccounts();
  console.log(all_margin_accounts)
  console.log("Got all margin accounts : ",)
}

main()