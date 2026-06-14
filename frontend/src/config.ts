// ─── Deployed Addresses ───────────────────────────────────────────────────────
// Update these after deploying via Remix.

export const FACTORY_ADDRESS = "0x18c6FAa50C3a5e66C8E0EA02Aef9012Cb63095BF"; // Ed4nsFactory (V1)
export const FACTORY_ADDRESS_V2 = "0x2e67fab851Abad4B6dAd40B0eb9C82E1020A9469"; // Ed4nsFactoryV2 (V2) - Update after deployment
export const PROTOCOL_ADDRESS = "0xa0a6e5C0F17DA5e5337C9CD5bf353C61BA375c0D"; // 10% fee recipient
export const STANDALONE_GAMES = ["0x8257Ea8CD22c397815BB0259EE0BE590752ce956","0xce2b3fdf0e230dd9da644ec348ea64e5b59a20b6"];

// The only wallet allowed to see the deploy form on the /launch page
export const AUTHORIZED_CREATOR = "0x420944b441715E34Dd672AE0Eb4526A7AD7d1EEF"; // Update to your wallet

export const getExplorerUrl = (address: string, chainId?: number) => {
    if (chainId === 8453) return `https://base.blockscout.com/address/${address}`;
    if (chainId === 84532) return `https://base-sepolia.blockscout.com/address/${address}`;
    return `https://eth-sepolia.blockscout.com/address/${address}`;
};

export const getAlchemyUrl = (key: string, chainId?: number) => {
    if (chainId === 8453) return `https://base-mainnet.g.alchemy.com/v2/${key}`;
    if (chainId === 84532) return `https://base-sepolia.g.alchemy.com/v2/${key}`;
    return `https://eth-sepolia.g.alchemy.com/v2/${key}`;
};

export const getAlchemyNftUrl = (key: string, chainId?: number) => {
    if (chainId === 8453) return `https://base-mainnet.g.alchemy.com/nft/v3/${key}`;
    if (chainId === 84532) return `https://base-sepolia.g.alchemy.com/nft/v3/${key}`;
    return `https://eth-sepolia.g.alchemy.com/nft/v3/${key}`;
};
