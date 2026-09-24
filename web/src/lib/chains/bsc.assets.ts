// The curated BSC tokenized-stock list: the 40 tickers both bStock and Ondo list
// (docs/BINANCE-WEB3.md §7.1), plus AAPL and AMZN from Ondo only (§7.3 / appendix). Addresses
// come straight from a live `/rwa/tokens` pull at 2026-09-24 12:28 UTC; every row is 18
// decimals. The default venue is bStock where both issuers list a ticker — bStock tracked its
// own reference tighter in that one snapshot (§2, "On-chain vs reference price gap") — and the
// `twin` is the other issuer, so the RWA catalog (Task 9) can quote and pick between them.
//
// `/tokens` can omit a real, tradable token: AAPLB (bStock's Apple) turns up through `/search`
// but not `/tokens` (§7.2). It stays listed here as AAPL's twin anyway — buildCatalog drops a
// venue whose address isn't in the live pull rather than dropping the whole ticker, so AAPL
// still shows up with just its Ondo venue until bStock's list catches up.
import type { Asset, RwaTwin } from "./types";

const stock = (a: Omit<Asset, "tier" | "via" | "decimals">): Asset => ({
  ...a,
  tier: "stock",
  via: "binance",
  decimals: 18,
});

const bstockTwin = (address: `0x${string}`, onchainSymbol: string): RwaTwin => ({
  platform: "bstock",
  address,
  onchainSymbol,
  decimals: 18,
});

const ondoTwin = (address: `0x${string}`, onchainSymbol: string): RwaTwin => ({
  platform: "ondo",
  address,
  onchainSymbol,
  decimals: 18,
});

export const BSC_STOCKS: Asset[] = [
  // Task 1's original six — address unchanged; twin added now that the catalog task exists.
  stock({
    symbol: "NVDA",
    name: "Nvidia",
    address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    platform: "bstock",
    onchainSymbol: "NVDAB",
    twin: ondoTwin("0xa9ee28c80f960b889dfbd1902055218cba016f75", "NVDAon"),
  }),
  stock({
    symbol: "TSLA",
    name: "Tesla",
    address: "0x5b1910eaad6450e50f816082aa078c41f10c292f",
    platform: "bstock",
    onchainSymbol: "TSLAB",
    twin: ondoTwin("0x2494b603319d4d9f9715c9f4496d9e0364b59d93", "TSLAon"),
  }),
  stock({
    symbol: "MSFT",
    name: "Microsoft",
    address: "0x80106cb3ead06659a5ad19df39d9b4733863b9b0",
    platform: "bstock",
    onchainSymbol: "MSFTB",
    twin: ondoTwin("0x6bfe75d1ad432050ea973c3a3dcd88f02e2444c3", "MSFTon"),
  }),
  stock({
    symbol: "META",
    name: "Meta",
    address: "0x7425889fe94f9d693e8daefe88bcced6acfef4c0",
    platform: "bstock",
    onchainSymbol: "METAB",
    twin: ondoTwin("0xd7df5863a3e742f0c767768cdfcb63f09e0422f6", "METAon"),
  }),
  stock({
    symbol: "GOOGL",
    name: "Google",
    address: "0x3f53de71c126bdabae20f9cd64848d317f6c3238",
    platform: "bstock",
    onchainSymbol: "GOOGLB",
    twin: ondoTwin("0x091fc7778e6932d4009b087b191d1ee3bac5729a", "GOOGLon"),
  }),
  stock({
    symbol: "AAPL",
    name: "Apple",
    address: "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4",
    platform: "ondo",
    onchainSymbol: "AAPLon",
    // AAPLB is real (found via /search) but missing from /tokens as of the research pull.
    twin: bstockTwin("0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a", "AAPLB"),
  }),

  // The other 34 of the 40 dual-listed tickers (§7.1).
  stock({
    symbol: "AAOI",
    name: "Applied Optoelectronics",
    address: "0x10343ef7da3301493d7ecb647d68a288c6c1db2f",
    platform: "bstock",
    onchainSymbol: "AAOIB",
    twin: ondoTwin("0x149bda9e7251dc36f536d1fe7f92a5ea203f4f3d", "AAOIon"),
  }),
  stock({
    symbol: "AMD",
    name: "Advanced Micro Devices",
    address: "0x75fd4cf6f8392e41e70391d60c90c0d5211603a1",
    platform: "bstock",
    onchainSymbol: "AMDB",
    twin: ondoTwin("0x9f16e46c73b43bdb70861247d537bee4ea18f639", "AMDon"),
  }),
  stock({
    symbol: "ARM",
    name: "Arm Holdings",
    address: "0xd42a79ebb7f527f40faecd196ffb47ad5e8d6f8c",
    platform: "bstock",
    onchainSymbol: "ARMB",
    twin: ondoTwin("0x527c6436e1eaa4f2065cde4090f798cb5d031dd6", "ARMon"),
  }),
  stock({
    symbol: "AVGO",
    name: "Broadcom",
    address: "0x76682c454467b3a1150ad8b6a92fc5ee2c21d7ed",
    platform: "bstock",
    onchainSymbol: "AVGOB",
    twin: ondoTwin("0x0ed2e3180edf393e6bf8db124bd15ddd54de150a", "AVGOon"),
  }),
  stock({
    symbol: "AXTI",
    name: "AXT Inc",
    address: "0x9bdc8b470dbf89dbcb123587c6f5e49cca3463be",
    platform: "bstock",
    onchainSymbol: "AXTIB",
    twin: ondoTwin("0x0c50323af81d5c33822c6add256fb9093d42bc74", "AXTIon"),
  }),
  stock({
    symbol: "BABA",
    name: "Alibaba Group",
    address: "0x4ef9d3062c7f6eba4aae4990c5036598c6eff4ec",
    platform: "bstock",
    onchainSymbol: "BABAB",
    twin: ondoTwin("0xd5964f3fcee8d649995ab88f04b8982539c282d2", "BABAon"),
  }),
  stock({
    // Underlying company unconfirmed in research; ticker kept as the display name rather than guess.
    symbol: "CBRS",
    name: "CBRS",
    address: "0xe81c6bb0266cd68b4f17278531dd03ea1f12da4e",
    platform: "bstock",
    onchainSymbol: "CBRSB",
    twin: ondoTwin("0x441a4d4fc23f17f4cf23e3d60f12d2bd6f176728", "CBRSon"),
  }),
  stock({
    symbol: "COIN",
    name: "Coinbase Global",
    address: "0x585bde7c54abb5ccd7791f923d6c2187635f3952",
    platform: "bstock",
    onchainSymbol: "COINB",
    twin: ondoTwin("0xf8589b526fdd65f7f301c605a6e04f0f1b4b3620", "COINon"),
  }),
  stock({
    symbol: "CRCL",
    name: "Circle Internet Group",
    address: "0x80f3d493ebce97e343c53d29a137942416b4ffc0",
    platform: "bstock",
    onchainSymbol: "CRCLB",
    twin: ondoTwin("0x992879cd8ce0c312d98648875b5a8d6d042cbf34", "CRCLon"),
  }),
  stock({
    symbol: "CRWV",
    name: "CoreWeave",
    address: "0x33e7317e17838fee56b10fe8d0b9ca6ca3090c95",
    platform: "bstock",
    onchainSymbol: "CRWVB",
    twin: ondoTwin("0x76e39171cb665a35981e744e2ceb7012f76caeac", "CRWVon"),
  }),
  stock({
    // Leveraged/inverse memory-sector ETF; exact issuer unconfirmed in research.
    symbol: "DRAM",
    name: "DRAM ETF",
    address: "0x93862d63fd9fd488b1328e9b47717d75e994a84b",
    platform: "bstock",
    onchainSymbol: "DRAMB",
    twin: ondoTwin("0x087b5761b161429013d41ea54cd2fb6022a21564", "DRAMon"),
  }),
  stock({
    symbol: "EWY",
    name: "iShares MSCI South Korea ETF",
    address: "0xbe82f76637dba2c114c41df856c2c51e522e2cb8",
    platform: "bstock",
    onchainSymbol: "EWYB",
    twin: ondoTwin("0x12b7adc48416a103f63e7e6210f62c81dfb91fd0", "EWYon"),
  }),
  stock({
    symbol: "GLW",
    name: "Corning",
    address: "0x740e075cbbea22a082b9d6679e65e82767875b6a",
    platform: "bstock",
    onchainSymbol: "GLWB",
    twin: ondoTwin("0x25a4dbae9a0cd8c75656d6b50ffdf4900cc20d8f", "GLWon"),
  }),
  stock({
    symbol: "HOOD",
    name: "Robinhood Markets",
    address: "0xa394dcea3fd3847fd793afbfd163e2e3858b7c65",
    platform: "bstock",
    onchainSymbol: "HOODB",
    twin: ondoTwin("0x19601179a60f55ff6636f5d1a8b6671053bd60a8", "HOODon"),
  }),
  stock({
    symbol: "IBM",
    name: "IBM",
    address: "0xfa273b076feb8c0fb34e554ae341082323d016a3",
    platform: "bstock",
    onchainSymbol: "IBMB",
    twin: ondoTwin("0xe8ff70859ce4cbd72e4352b4fb45f5bf39d07464", "IBMon"),
  }),
  stock({
    symbol: "INTC",
    name: "Intel",
    address: "0xe614e2fc6c787035ff51f452e8e826bfd32d5283",
    platform: "bstock",
    onchainSymbol: "INTCB",
    twin: ondoTwin("0xa528caaa2f96090e379d43f90834c75df54d6e74", "INTCon"),
  }),
  stock({
    symbol: "LITE",
    name: "Lumentum Holdings",
    address: "0x64748bea17b6d19e242adf20425de2440c656142",
    platform: "bstock",
    onchainSymbol: "LITEB",
    twin: ondoTwin("0x0facafb97ffdba3cae88512070af49bd30674cd9", "LITEon"),
  }),
  stock({
    symbol: "MRVL",
    name: "Marvell Technology",
    address: "0x16cd4fe7e8880ecc3ba222795229e20489fc2c76",
    platform: "bstock",
    onchainSymbol: "MRVLB",
    twin: ondoTwin("0x1501ec83ffef405b4331cc4f73277a40fb0c627d", "MRVLon"),
  }),
  stock({
    symbol: "MSTR",
    name: "Strategy (MicroStrategy)",
    address: "0xe87afb3076aeb0f9b14e368de8145ae6a2826a14",
    platform: "bstock",
    onchainSymbol: "MSTRB",
    twin: ondoTwin("0x7313ea16493b2f55054df0131a3a14b043ec8992", "MSTRon"),
  }),
  stock({
    symbol: "MU",
    name: "Micron Technology",
    address: "0xcdf2f3e0fa43c47a6662a91c9e4a7c5f69762699",
    platform: "bstock",
    onchainSymbol: "MUB",
    twin: ondoTwin("0x8b6acf6041a81567f012ff6a4c6d96d5818d74bf", "MUon"),
  }),
  stock({
    symbol: "NBIS",
    name: "Nebius Group",
    address: "0xe256bc2a4f5297f8ba6f043f180a46300ecbcbb1",
    platform: "bstock",
    onchainSymbol: "NBISB",
    twin: ondoTwin("0xee268780473e7a0e47bac41547c6e01512555a16", "NBISon"),
  }),
  stock({
    symbol: "NOK",
    name: "Nokia",
    address: "0x7c4d7a180d737dd5a70d8065a90e6746a69c37ea",
    platform: "bstock",
    onchainSymbol: "NOKB",
    twin: ondoTwin("0xe9518cb0010c717db69001f1418eff9e97330137", "NOKon"),
  }),
  stock({
    symbol: "ORCL",
    name: "Oracle",
    address: "0x4684d9887fc1c71cba7bab8e88835cec217eb598",
    platform: "bstock",
    onchainSymbol: "ORCLB",
    twin: ondoTwin("0x03e4bd1ea53f1da84513da0319d1f03dd1bbcf93", "ORCLon"),
  }),
  stock({
    symbol: "PLTR",
    name: "Palantir Technologies",
    address: "0x0ca5d51d0277bd006fd9607d3e560785ebad8222",
    platform: "bstock",
    onchainSymbol: "PLTRB",
    twin: ondoTwin("0x9351abd19f42101dd36025e495b98e910b255d78", "PLTRon"),
  }),
  stock({
    symbol: "QCOM",
    name: "Qualcomm",
    address: "0x5f7a56e877b9130608bf8be962621011182fefe1",
    platform: "bstock",
    onchainSymbol: "QCOMB",
    twin: ondoTwin("0xfbd4d681c92ead6af0e49950c8b2e47eeacbb2db", "QCOMon"),
  }),
  stock({
    symbol: "QQQ",
    name: "Invesco QQQ Trust",
    address: "0x205812cdbed920aff76c6580abd681a46d11efc7",
    platform: "bstock",
    onchainSymbol: "QQQB",
    twin: ondoTwin("0x0cde6936d305d5b34667fc46425e852efd73559a", "QQQon"),
  }),
  stock({
    symbol: "RKLB",
    name: "Rocket Lab",
    address: "0xc8da12cbcce7c45180692a6420b0076e03a5179a",
    platform: "bstock",
    onchainSymbol: "RKLBB",
    twin: ondoTwin("0xb4d695569236273745b4cd54b539b1b9cc1513af", "RKLBon"),
  }),
  stock({
    // Likely an SK Hynix-linked product; underlying issuer unconfirmed in research.
    symbol: "SKHY",
    name: "SKHY",
    address: "0xca750ef65f295bbecd685abf54e82caf297bdb61",
    platform: "bstock",
    onchainSymbol: "SKHYB",
    twin: ondoTwin("0x4268f2bfb23a7496504aa5ed1ee325248586299f", "SKHYon"),
  }),
  stock({
    symbol: "SNDK",
    name: "SanDisk",
    address: "0x3ee4df61bd4f867e349beae8bfe07bc31b4850fb",
    platform: "bstock",
    onchainSymbol: "SNDKB",
    twin: ondoTwin("0x4fd67cb8cfedc718bac984b5936abe3330d0a2a4", "SNDKon"),
  }),
  stock({
    symbol: "SOXL",
    name: "Direxion Daily Semiconductor Bull 3X Shares",
    address: "0xd97d097a89113fa59b76c572e5b2eb647e8eefaf",
    platform: "bstock",
    onchainSymbol: "SOXLB",
    twin: ondoTwin("0xb943c8a0d77b656daf5244da060d647fd9152289", "SOXLon"),
  }),
  stock({
    // Docs list a "SpaceX" catalog sector; SPCX is presumed to be SpaceX pre-IPO shares, unconfirmed.
    symbol: "SPCX",
    name: "SPCX",
    address: "0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1",
    platform: "bstock",
    onchainSymbol: "SPCXB",
    twin: ondoTwin("0xd0a58bc9d88d3ff48c0294cb7e45937d0e41a928", "SPCXon"),
  }),
  stock({
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    address: "0x7138b48df7d98d7e3cc221bfe7192d0a178182d8",
    platform: "bstock",
    onchainSymbol: "SPYB",
    twin: ondoTwin("0x6a708ead771238919d85930b5a0f10454e1c331a", "SPYon"),
  }),
  stock({
    symbol: "TQQQ",
    name: "ProShares UltraPro QQQ",
    address: "0x462b5f13b7c7748279358962925c5de83bb9e598",
    platform: "bstock",
    onchainSymbol: "TQQQB",
    twin: ondoTwin("0xe42cfb20e00912409b77a602b5bdcff3c7acc5f4", "TQQQon"),
  }),
  stock({
    symbol: "TSM",
    name: "Taiwan Semiconductor Manufacturing",
    address: "0xab78b89b5bb00236be0b4b20704cbfa04efc711c",
    platform: "bstock",
    onchainSymbol: "TSMB",
    twin: ondoTwin("0xc37042a7a4fa510d8884a433762ab87257b91965", "TSMon"),
  }),
  stock({
    symbol: "WDC",
    name: "Western Digital",
    address: "0xebe29695f8047c13d36e7a790ca8c1b239ffad1c",
    platform: "bstock",
    onchainSymbol: "WDCB",
    twin: ondoTwin("0xceb29848d04ad3cb46e1fe8e45b82ffac39d797d", "WDCon"),
  }),

  // bStock-only rows (§7.2) — no Ondo twin.
  stock({
    symbol: "INTW",
    name: "GraniteShares 2x Long INTC Daily ETF",
    address: "0x0735d9904b7e34e6fe39b0f66e00c111b3f2b681",
    platform: "bstock",
    onchainSymbol: "INTWB",
  }),
  stock({
    symbol: "KORU",
    name: "Direxion Daily MSCI South Korea Bull 3X Shares",
    address: "0x1ffad32d69c5fead99f88c25ca0191edc3757636",
    platform: "bstock",
    onchainSymbol: "KORUB",
  }),
  stock({
    symbol: "MUU",
    name: "Direxion Daily 2X Long Micron ETF",
    address: "0x0bb3fa77e0809f42948e435f04883c25415e8263",
    platform: "bstock",
    onchainSymbol: "MUUB",
  }),
  stock({
    symbol: "MVLL",
    name: "GraniteShares 2x Long Marvell Daily ETF",
    address: "0x7c26a12f20507e2cee22ceebed9e88fda47f866c",
    platform: "bstock",
    onchainSymbol: "MVLLB",
  }),
  stock({
    symbol: "QNT",
    name: "Quantinuum",
    address: "0xd721c192d612db77621df57a9fab38418033c02e",
    platform: "bstock",
    onchainSymbol: "QNTB",
  }),
  stock({
    symbol: "SNXX",
    name: "Tradr 2X Long SanDisk Daily ETF",
    address: "0x9e82e3da8f1115b73d24bb24113ab836ffdab6b6",
    platform: "bstock",
    onchainSymbol: "SNXXB",
  }),

  // Ondo-only megacaps (§7.3 / appendix) — no bStock listing found.
  stock({
    symbol: "AMZN",
    name: "Amazon",
    address: "0x4553cfe1c09f37f38b12dc509f676964e392f8fc",
    platform: "ondo",
    onchainSymbol: "AMZNon",
  }),
];

export const BSC_ASSETS = { stocks: BSC_STOCKS, safe: [] as Asset[], crypto: [] as Asset[], all: BSC_STOCKS };
