const apiKey = "70cbe9b93749baa4e25242b839369605";
const address = "0xbEFE34702f3de85ddaDcB0B783dE21A14F1BBA55";
const chain = "base";

async function refreshTokens() {
  for (let i = 1; i <= 20; i++) {
    const url = `https://api.opensea.io/api/v2/chain/${chain}/contract/${address}/nfts/${i}/refresh`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "accept": "application/json"
        }
      });
      const data = await res.json().catch(() => ({}));
      console.log(`Token ${i}:`, res.status, data);
    } catch (e) {
      console.log(`Token ${i} Error:`, e.message);
    }
    // slight delay
    await new Promise(r => setTimeout(r, 200));
  }
}

refreshTokens();
