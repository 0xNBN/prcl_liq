import {
  ProgramAccount,
  Market,
  ParclV3Sdk,
  getExchangePda,
  getMarketPda,
  MarginAccountWrapper,
  MarketWrapper,
  ExchangeWrapper,
  LiquidateAccounts,
  LiquidateParams,
  MarketMap,
  PriceFeedMap,
  Address,
  translateAddress,
} from "@parcl-oss/v3-sdk";
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  Signer,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
const WebSocket = require('ws');
const fs = require('fs');

//Before running this code, you need to update :
//          the websocket rpc on line 48, 
//          the rpc on line 150
//          the liquidator account on line 151
//          Your private key on line 152




let shared_margin_accounts_list: { [key: string]: any } = {};
let accounts_to_potentially_update: string[] =[];

let is_snapshot_updating_done=true
let is_potential_ma_updating_done=true



//--------------------------    LAUNCHING THE WS SERVICE TO GET NEW DTX FOR THE CONTRACT  -----------

// Create a WebSocket connection
const ws = new WebSocket('wss://atlas-mainnet.helius-rpc.com?api-key=YOUR_API_KEY');


function sendRequest(ws) {
    const request = {
        jsonrpc: "2.0",
        id: 420,
        method: "transactionSubscribe",
        params: [
            {
                accountInclude: ["3parcLrT7WnXAcyPfkCz49oofuuf2guUKkjuFkAhZW8Y"]
            },
            {
                commitment: "processed",
                encoding: "base64",
                transactionDetails: "accounts",
                showRewards: true,
                maxSupportedTransactionVersion: 0
            }
        ]
    };
    ws.send(JSON.stringify(request));
}


// Define WebSocket event handlers

ws.on('open', function open() {
    console.log('WebSocket is open');
    sendRequest(ws);  // Send a request once the WebSocket is open
});



ws.on('message', function incoming(data) {
  const messageStr = data.toString('utf8');
  try {
    const messageObj = JSON.parse(messageStr);
    let tx_sign=messageObj.params.result.signature
    //console.log("New tx : ",tx_sign)
    let tt=messageObj.params.result.transaction.transaction.accountKeys;
    for (let loc_account of tt){
          if (loc_account.writable==true){
           
            accounts_to_potentially_update.push(loc_account.pubkey)
          }
        }
    
    //console.log("Accounts to check update for ",accounts_to_potentially_update.length)
  }catch{
    console.log("Error for that ws message : ",messageStr)
  }
})


//---------------------------------------------------------------------------------------------------
async function load_account_margins_snapshot(sdk:ParclV3Sdk){
  is_snapshot_updating_done=false
  let local_new_data:{ [key: string]: any } = {};
  let unreffed_margin_accounts_objects=await sdk.accountFetcher.getAllMarginAccounts()
  for (let m_acc in unreffed_margin_accounts_objects){
    
    local_new_data[unreffed_margin_accounts_objects[m_acc]["address"].toString()]=unreffed_margin_accounts_objects[m_acc].account
  }
  shared_margin_accounts_list=local_new_data
  is_snapshot_updating_done=true

}

async function update_snapshot(sdk:ParclV3Sdk){
  if (is_snapshot_updating_done){
    await load_account_margins_snapshot(sdk)
  }
}


async function check_accounts_to_potentially_update(sdk:ParclV3Sdk){
  //console.log("Starting live update of margins")

  if (is_potential_ma_updating_done){
    is_potential_ma_updating_done=false
    let local_list=accounts_to_potentially_update.slice();
   
    for (let potential_account_indx in local_list){
      let potential_account_id=accounts_to_potentially_update[potential_account_indx]
      //console.log(potential_account_id)
      if (potential_account_id in shared_margin_accounts_list){
        console.log("LIVE ACCOUNT UPDATER :  Updating account ",potential_account_id)
        let unique_margin_account=await sdk.accountFetcher.getMarginAccount(potential_account_id)
        //console.log(unique_margin_account)
        shared_margin_accounts_list[potential_account_id]=unique_margin_account
      
      }
    }
    is_potential_ma_updating_done=true
    accounts_to_potentially_update=accounts_to_potentially_update.slice(local_list.length); 
  }
}


async function main() {
  console.log("Starting liquidator");
  let RPC_URL=""
  let LIQUIDATOR_MARGIN_ACCOUNT="ACCOUNT EXAMPLE"
  let PRIVATE_KEY=""
  // Note: only handling single exchange
  const [exchangeAddress] = getExchangePda(0);
  const liquidatorMarginAccount = translateAddress(LIQUIDATOR_MARGIN_ACCOUNT);
  let firstWinPrivKey=[...]
  let liquidatorSigner=Keypair.fromSeed(Uint8Array.from(firstWinPrivKey.slice(0,32)));
  

  const interval = parseInt("300");

  const sdk = new ParclV3Sdk({ rpcUrl: RPC_URL });
  const connection = new Connection(RPC_URL);

  await load_account_margins_snapshot(sdk)
  console.log("One time snapshot of margin accounts has been loaded")
  setInterval(() => update_snapshot(sdk), 600000); //refreshing data with snapshot every 10 minutes as a double check, 
  console.log("Redondancy service started")
  setInterval(() => check_accounts_to_potentially_update(sdk), 10000); //checking potential new accounts to create every 10 seconds
  console.log("Live margin accounts checking service started")
  await runLiquidator({
    sdk,
    connection,
    interval,
    exchangeAddress,
    liquidatorSigner,
    liquidatorMarginAccount,
  });
};

type RunLiquidatorParams = {
  sdk: ParclV3Sdk;
  connection: Connection;
  interval: number;
  exchangeAddress: Address;
  liquidatorSigner: Keypair;
  liquidatorMarginAccount: Address;
};

async function runLiquidator({
  sdk,
  connection,
  interval,
  exchangeAddress,
  liquidatorSigner,
  liquidatorMarginAccount,
}: RunLiquidatorParams): Promise<void> {
  let firstRun = true;
  // eslint-disable-next-line no-constant-condition

  while (true) {
    console.log("MAIN LIQUIDATOR New iteration ",Date.now())
    console.log("Getting  exchange info ",Date.now())
    const exchange = await sdk.accountFetcher.getExchange(exchangeAddress);
    console.log("Got exchange info ",Date.now())
    if (exchange === undefined) {
      throw new Error("Invalid exchange address");
    }
    const allMarketAddresses: PublicKey[] = [];
    for (const marketId of exchange.marketIds) {
      if (marketId === 0) {
        continue;
      }
      const [market] = getMarketPda(exchangeAddress, marketId);
      allMarketAddresses.push(market);
    }
    const allMarkets = await sdk.accountFetcher.getMarkets(allMarketAddresses);
    console.log("Got markets info ",Date.now())
    let [markets, priceFeeds]=await getMarketMapAndPriceFeedMap(sdk, allMarkets)
    console.log("Got price feeds info ",Date.now())
    //let allMarginAccounts=await sdk.accountFetcher.getAllMarginAccounts()

    console.log(`Checking  margin accounts`,Object.keys(shared_margin_accounts_list).length );
    for (const [address, rawMarginAccount] of Object.entries(shared_margin_accounts_list)) {
      //console.log("New margin analysis info ",Date.now())
      let current_public_key=new PublicKey(rawMarginAccount.publicKey)
      let current_account=rawMarginAccount
      const marginAccount = new MarginAccountWrapper(
        current_account,
        current_public_key
      );
      if (marginAccount.inLiquidation()) {
        console.log(`Liquidating account already in liquidation (${marginAccount.address})`);
        if (false){
                await liquidate(
                  sdk,
                  connection,
                  marginAccount,
                  {
                    marginAccount: current_public_key,
                    exchange: current_account.exchange,
                    owner: current_account.owner,
                    liquidator: liquidatorSigner.publicKey,
                    liquidatorMarginAccount,
                  },
                  markets,
                  [liquidatorSigner],
                  liquidatorSigner.publicKey
                );
              }
      }


      const margins = marginAccount.getAccountMargins(
        new ExchangeWrapper(exchange),
        markets,
        priceFeeds,
        Math.floor(Date.now() / 1000)
      );
      //console.log("Done gathering individual account margin info ",Date.now())

      if (margins.canLiquidate()) {
        console.log(`Starting liquidation for ${marginAccount.address}`);
        if (false){
                const signature = await liquidate(
                  sdk,
                  connection,
                  marginAccount,
                  {
                    marginAccount: current_public_key,
                    exchange: current_account.exchange,
                    owner: current_account.owner,
                    liquidator: liquidatorSigner.publicKey,
                    liquidatorMarginAccount,
                  },
                  markets,
                  [liquidatorSigner],
                  liquidatorSigner.publicKey
                );
                console.log("Signature: ", signature);
          }
      }
    }
    console.log("Done all mrgn accounts",Date.now())
  }
}

async function getMarketMapAndPriceFeedMap(
  sdk: ParclV3Sdk,
  allMarkets: (ProgramAccount<Market> | undefined)[]
): Promise<[MarketMap, PriceFeedMap]> {
  const markets: MarketMap = {};
  for (const market of allMarkets) {
    if (market === undefined) {
      continue;
    }
    markets[market.account.id] = new MarketWrapper(market.account, market.address);
  }
  const allPriceFeedAddresses = (allMarkets as ProgramAccount<Market>[]).map(
    (market) => market.account.priceFeed
  );
  const allPriceFeeds = await sdk.accountFetcher.getPythPriceFeeds(allPriceFeedAddresses);
  const priceFeeds: PriceFeedMap = {};
  for (let i = 0; i < allPriceFeeds.length; i++) {
    const priceFeed = allPriceFeeds[i];
    if (priceFeed === undefined) {
      continue;
    }
    priceFeeds[allPriceFeedAddresses[i]] = priceFeed;
  }
  return [markets, priceFeeds];
}

function getMarketsAndPriceFeeds(
  marginAccount: MarginAccountWrapper,
  markets: MarketMap
): [Address[], Address[]] {
  const marketAddresses: Address[] = [];
  const priceFeedAddresses: Address[] = [];
  for (const position of marginAccount.positions()) {
    const market = markets[position.marketId()];
    if (market.address === undefined) {
      throw new Error(`Market is missing from markets map (id=${position.marketId()})`);
    }
    marketAddresses.push(market.address);
    priceFeedAddresses.push(market.priceFeed());
  }
  return [marketAddresses, priceFeedAddresses];
}

async function liquidate(
  sdk: ParclV3Sdk,
  connection: Connection,
  marginAccount: MarginAccountWrapper,
  accounts: LiquidateAccounts,
  markets: MarketMap,
  signers: Signer[],
  feePayer: Address,
  params?: LiquidateParams
): Promise<string> {
  const [marketAddresses, priceFeedAddresses] = getMarketsAndPriceFeeds(marginAccount, markets);
  const { blockhash: recentBlockhash } = await connection.getLatestBlockhash();
  const tx = sdk
    .transactionBuilder()
    .liquidate(accounts, marketAddresses, priceFeedAddresses, params)
    .feePayer(feePayer)
    .buildSigned(signers, recentBlockhash);
  return await sendAndConfirmTransaction(connection, tx, signers);
}


main()