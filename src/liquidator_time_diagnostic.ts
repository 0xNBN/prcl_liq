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





async function main() {
  console.log("Starting liquidator");
  let RPC_URL="https://rpc.hellomoon.io/dd0a917e-e732-4c83-8cc6-1128027eb48d"
  let LIQUIDATOR_MARGIN_ACCOUNT=""
  let PRIVATE_KEY=""
  // Note: only handling single exchange
  const [exchangeAddress] = getExchangePda(0);
  const liquidatorMarginAccount = translateAddress(LIQUIDATOR_MARGIN_ACCOUNT);
  let firstWinPrivKey=[...]
  let liquidatorSigner=Keypair.fromSeed(Uint8Array.from(firstWinPrivKey.slice(0,32)));
  

  const interval = parseInt("300");

  const sdk = new ParclV3Sdk({ rpcUrl: RPC_URL });
  const connection = new Connection(RPC_URL);
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
    console.log("New iteration ",Date.now())
    if (firstRun) {
      firstRun = false;
    } else {
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    }
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
    let allMarginAccounts=await sdk.accountFetcher.getAllMarginAccounts()

    console.log("Got margings  info ",Date.now())
    console.log(`Fetched ${allMarginAccounts.length} margin accounts`);
    for (const rawMarginAccount of allMarginAccounts) {
      //console.log("New margin analysis info ",Date.now())
      const marginAccount = new MarginAccountWrapper(
        rawMarginAccount.account,
        rawMarginAccount.address
      );
      if (marginAccount.inLiquidation()) {
        console.log(`Liquidating account already in liquidation (${marginAccount.address})`);
        if (false){
                await liquidate(
                  sdk,
                  connection,
                  marginAccount,
                  {
                    marginAccount: rawMarginAccount.address,
                    exchange: rawMarginAccount.account.exchange,
                    owner: rawMarginAccount.account.owner,
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
                    marginAccount: rawMarginAccount.address,
                    exchange: rawMarginAccount.account.exchange,
                    owner: rawMarginAccount.account.owner,
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