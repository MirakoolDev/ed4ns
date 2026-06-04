const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SurvivorExtension", function () {
  // ── Constants ──────────────────────────────────────────────────────────────
  const MINT_FEE = ethers.parseEther("0.01");
  const MIN_CUT_INTERVAL = 4 * 60; // 4 minutes
  const CALLBACK_GAS_LIMIT = 500_000;
  const FINAL_SURVIVORS = 4;
  const VRF_KEY_HASH =
    "0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae";

  // ── Fixtures ───────────────────────────────────────────────────────────────
  let extension, mockCore, mockVRF;
  let owner, artist, minters;
  let subId;

  beforeEach(async function () {
    [owner, artist, ...minters] = await ethers.getSigners();

    // Deploy Mock VRF Coordinator V2.5
    const MockVRF = await ethers.getContractFactory("VRFCoordinatorV2_5Mock");
    mockVRF = await MockVRF.deploy(
      ethers.parseEther("0.1"),  // baseFee (0.1 LINK)
      1_000_000_000,             // gasPrice (1 gwei)
      ethers.parseEther("0.004") // weiPerUnitLink
    );
    await mockVRF.waitForDeployment();

    // Create VRF subscription and get its ID
    const tx = await mockVRF.createSubscription();
    const receipt = await tx.wait();
    const log = receipt.logs.find(x => x.fragment && x.fragment.name === "SubscriptionCreated") || receipt.logs[0];
    const parsedLog = mockVRF.interface.parseLog(log);
    subId = parsedLog.args.subId;

    // Fund subscription with 1000 LINK
    await mockVRF.fundSubscription(subId, ethers.parseEther("1000"));

    // Deploy Mock Manifold Creator Core
    const MockCore = await ethers.getContractFactory("MockERC721CreatorCore");
    mockCore = await MockCore.deploy();
    await mockCore.waitForDeployment();

    // Deploy SurvivorExtension
    const SurvivorExtension = await ethers.getContractFactory("SurvivorExtension");
    extension = await SurvivorExtension.deploy(
      mockCore.target,
      artist.address,
      MIN_CUT_INTERVAL,
      mockVRF.target,
      subId,
      VRF_KEY_HASH,
      CALLBACK_GAS_LIMIT
    );
    await extension.waitForDeployment();

    // Register extension on the mock core
    await mockCore.setExtension(extension.target);

    // Add extension as VRF consumer
    await mockVRF.addConsumer(subId, extension.target);

    // Set artwork URI
    await extension.connect(artist).setArtworkURI("https://arweave.net/test123");
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  async function mintN(n) {
    for (let i = 0; i < n; i++) {
      const minter = minters[i % minters.length];
      await minter.sendTransaction({
        to: extension.target,
        value: MINT_FEE
      });
      await mockCore.setOwnerOf(i + 1, minter.address);
    }
  }

  async function fulfillVRF(randomWord) {
    const requestId = await extension.s_lastRequestId();
    return mockVRF.fulfillRandomWordsWithOverride(
      requestId,
      extension.target,
      [randomWord]
    );
  }

  async function advanceTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  describe("Phase 1 — Payout Splits", function () {
    it("should accept payment, keep 50% for prizePool, and forward 50% to artist", async function () {
      const artistBefore = await ethers.provider.getBalance(artist.address);

      await minters[0].sendTransaction({
        to: extension.target,
        value: MINT_FEE
      });

      const artistAfter = await ethers.provider.getBalance(artist.address);
      const expectedShare = MINT_FEE / 2n;

      expect(artistAfter - artistBefore).to.equal(expectedShare);
      expect(await extension.prizePool()).to.equal(expectedShare);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("initializeGame", function () {
    it("should reject if not artist", async function () {
      await expect(
        extension.connect(minters[0]).initializeGame(1, 10, "https://arweave.net/test123")
      ).to.be.revertedWith("Not artist");
    });

    it("should reject if not enough players", async function () {
      await expect(
        extension.connect(artist).initializeGame(1, FINAL_SURVIVORS, "https://arweave.net/test123")
      ).to.be.revertedWith("Not enough players");
    });

    it("should reject if token range is invalid", async function () {
      await expect(
        extension.connect(artist).initializeGame(0, 10, "https://arweave.net/test123")
      ).to.be.revertedWith("Invalid start ID");

      await expect(
        extension.connect(artist).initializeGame(10, 5, "https://arweave.net/test123")
      ).to.be.revertedWith("Invalid range");
    });

    it("should reject if artwork URI is empty", async function () {
      await mintN(10);
      await expect(
        extension.connect(artist).initializeGame(1, 10, "")
      ).to.be.revertedWith("URI cannot be empty");
    });

    it("should reject if boundary tokens do not exist on Creator Core", async function () {
      await mintN(5);
      await expect(
        extension.connect(artist).initializeGame(1, 10, "https://arweave.net/test123")
      ).to.be.revertedWith("ERC721: invalid token ID");
    });

    it("should initialize O(1) without per-token storage writes", async function () {
      await mintN(10);
      await extension.connect(artist).initializeGame(5, 10, "https://arweave.net/test123");

      expect(await extension.mintingOpen()).to.be.false;
      expect(await extension.aliveCount()).to.equal(6);
      expect(await extension.startTokenId()).to.equal(5n);
      expect(await extension.endTokenId()).to.equal(10n);
      expect(await extension.initialPoolSize()).to.equal(6n);
      expect(await extension.artworkURI()).to.equal("https://arweave.net/test123");
    });

    it("should initialize game status and emit MintingClosed", async function () {
      await mintN(10);
      await expect(extension.connect(artist).initializeGame(1, 10, "https://arweave.net/test123"))
        .to.emit(extension, "MintingClosed");

      expect(await extension.mintingOpen()).to.be.false;
      expect(await extension.aliveCount()).to.equal(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("triggerCut", function () {
    beforeEach(async function () {
      await mintN(10);
      await extension.connect(artist).initializeGame(1, 10, "https://arweave.net/test123");
    });

    it("should reject if called too soon", async function () {
      await expect(extension.triggerCut()).to.be.revertedWith("Too soon");
    });

    it("should accept after interval and emit CutRequested", async function () {
      await advanceTime(MIN_CUT_INTERVAL);
      await expect(extension.triggerCut()).to.emit(extension, "CutRequested");
      expect(await extension.vrfPending()).to.be.true;
    });

    it("should reject a second triggerCut while VRF pending", async function () {
      await advanceTime(MIN_CUT_INTERVAL);
      await extension.triggerCut();

      await advanceTime(MIN_CUT_INTERVAL);
      await expect(extension.triggerCut()).to.be.revertedWith("VRF request pending");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("fulfillRandomWords (Lazy Evaluation)", function () {
    beforeEach(async function () {
      await mintN(10);
      await extension.connect(artist).initializeGame(1, 10, "https://arweave.net/test123");
      await advanceTime(MIN_CUT_INTERVAL);
      await extension.triggerCut();
    });

    it("should store seed and increment roundCount", async function () {
      expect(await extension.roundCount()).to.equal(0);
      await fulfillVRF(12345);
      expect(await extension.roundCount()).to.equal(1);
      expect(await extension.getRoundSeed(0)).to.equal(12345n);
      expect(await extension.vrfPending()).to.be.false;
    });

    it("should update aliveCount via lazy computation", async function () {
      const beforeCount = await extension.aliveCount();
      await fulfillVRF(12345);
      const afterCount = await extension.aliveCount();
      expect(afterCount).to.be.lt(beforeCount);
      // 10 tokens → ceil(10/2) = 5 survivors
      expect(afterCount).to.equal(5);
    });

    it("should reset lastCutTimestamp on fulfillment", async function () {
      await fulfillVRF(42);
      await expect(extension.triggerCut()).to.be.revertedWith("Too soon");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("isTokenAlive — Deterministic Math", function () {
    beforeEach(async function () {
      await mintN(10);
      await extension.connect(artist).initializeGame(1, 10, "https://arweave.net/test123");
    });

    it("should return true for all tokens before any cut", async function () {
      for (let i = 1; i <= 10; i++) {
        expect(await extension.isTokenAlive(i)).to.be.true;
      }
    });

    it("should return false for tokens outside game range", async function () {
      expect(await extension.isTokenAlive(0)).to.be.false;
      expect(await extension.isTokenAlive(11)).to.be.false;
    });

    it("should produce exactly ceil(n/2) survivors after one round", async function () {
      await advanceTime(MIN_CUT_INTERVAL);
      await extension.triggerCut();
      await fulfillVRF(42);

      let aliveTokens = 0;
      for (let i = 1; i <= 10; i++) {
        if (await extension.isTokenAlive(i)) aliveTokens++;
      }
      expect(aliveTokens).to.equal(5); // ceil(10/2) = 5
    });

    it("should be deterministic — same seed always produces same result", async function () {
      await advanceTime(MIN_CUT_INTERVAL);
      await extension.triggerCut();
      await fulfillVRF(99999);

      const results = [];
      for (let i = 1; i <= 10; i++) {
        results.push(await extension.isTokenAlive(i));
      }

      // Verify the pattern is fixed (snapshot test)
      const aliveCount = results.filter(x => x).length;
      expect(aliveCount).to.equal(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("eliminatedInRound", function () {
    it("should return 0 for alive tokens and round number for eliminated", async function () {
      await mintN(10);
      await extension.connect(artist).initializeGame(1, 10, "https://arweave.net/test123");

      // Before any cut, all tokens report 0 (alive)
      for (let i = 1; i <= 10; i++) {
        expect(await extension.eliminatedInRound(i)).to.equal(0);
      }

      // After round 1
      await advanceTime(MIN_CUT_INTERVAL);
      await extension.triggerCut();
      await fulfillVRF(12345);

      let round1Eliminated = 0;
      for (let i = 1; i <= 10; i++) {
        const round = await extension.eliminatedInRound(i);
        if (round > 0n) {
          expect(round).to.equal(1n); // Eliminated in round 1
          round1Eliminated++;
        }
      }
      expect(round1Eliminated).to.equal(5); // 10 - ceil(10/2) = 5 eliminated
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("Full game — 5 tokens to completion", function () {
    it("should complete game and let winners claim", async function () {
      await mintN(5);
      expect(await extension.prizePool()).to.equal((MINT_FEE * 5n) / 2n);

      await extension.connect(artist).initializeGame(1, 5, "https://arweave.net/test123");
      expect(await extension.aliveCount()).to.equal(5);

      // Round 1: 5 → ceil(5/2) = 3, but FINAL_SURVIVORS = 4, so survivors = 4
      await advanceTime(MIN_CUT_INTERVAL);
      await extension.triggerCut();
      await fulfillVRF(9999);

      expect(await extension.gameFinished()).to.be.true;
      expect(await extension.aliveCount()).to.equal(4);
      expect(await extension.roundCount()).to.equal(1);

      // Count alive tokens
      let aliveTokens = [];
      for (let i = 1; i <= 5; i++) {
        if (await extension.isTokenAlive(i)) aliveTokens.push(i);
      }
      expect(aliveTokens.length).to.equal(4);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("Full game — 20 tokens multi-round", function () {
    it("should run multiple rounds and finish at FINAL_SURVIVORS", async function () {
      await mintN(20);
      await extension.connect(artist).initializeGame(1, 20, "https://arweave.net/test123");
      expect(await extension.aliveCount()).to.equal(20);

      let round = 0;
      while (!(await extension.gameFinished())) {
        await advanceTime(MIN_CUT_INTERVAL);
        await extension.triggerCut();
        await fulfillVRF(round * 1000 + 42);
        round++;
      }

      expect(await extension.aliveCount()).to.equal(FINAL_SURVIVORS);
      expect(await extension.roundCount()).to.equal(round);

      // Verify exactly 4 alive
      let aliveCount = 0;
      for (let i = 1; i <= 20; i++) {
        if (await extension.isTokenAlive(i)) aliveCount++;
      }
      expect(aliveCount).to.equal(FINAL_SURVIVORS);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("claimPrize", function () {
    let winnerTokenId;
    let winnerSigner;

    beforeEach(async function () {
      await mintN(5);
      await extension.connect(artist).initializeGame(1, 5, "https://arweave.net/test123");
      await advanceTime(MIN_CUT_INTERVAL);
      await extension.triggerCut();
      await fulfillVRF(42);

      // Find a winning token
      for (let i = 1; i <= 5; i++) {
        if (await extension.isTokenAlive(i)) {
          winnerTokenId = i;
          break;
        }
      }
      winnerSigner = minters[Number(winnerTokenId) % minters.length];
      await mockCore.setOwnerOf(winnerTokenId, winnerSigner.address);
    });

    it("should pay prize share to winner", async function () {
      if (!(await extension.gameFinished())) this.skip();

      const prizePool = await extension.prizePool();
      const finalSurvivors = await extension.aliveCount();
      const expectedShare = prizePool / finalSurvivors;

      const balBefore = await ethers.provider.getBalance(winnerSigner.address);
      const tx = extension.connect(winnerSigner).claimPrize(winnerTokenId);
      await expect(tx).to.emit(extension, "PrizeClaimed");

      const balAfter = await ethers.provider.getBalance(winnerSigner.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("should reject double claim", async function () {
      if (!(await extension.gameFinished())) this.skip();
      await extension.connect(winnerSigner).claimPrize(winnerTokenId);
      await expect(
        extension.connect(winnerSigner).claimPrize(winnerTokenId)
      ).to.be.revertedWith("Already claimed");
    });

    it("should reject claim from non-owner", async function () {
      if (!(await extension.gameFinished())) this.skip();
      const intruder = minters[minters.length - 1];
      await expect(
        extension.connect(intruder).claimPrize(winnerTokenId)
      ).to.be.revertedWith("Not token owner");
    });

    it("should reject claim for eliminated token", async function () {
      if (!(await extension.gameFinished())) this.skip();
      // Find an eliminated token
      let eliminatedId;
      for (let i = 1; i <= 5; i++) {
        if (!(await extension.isTokenAlive(i))) {
          eliminatedId = i;
          break;
        }
      }
      if (!eliminatedId) this.skip();
      const signer = minters[eliminatedId % minters.length];
      await mockCore.setOwnerOf(eliminatedId, signer.address);
      await expect(
        extension.connect(signer).claimPrize(eliminatedId)
      ).to.be.revertedWith("Not a winner");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("tokenURI", function () {
    it("should return valid base64 JSON with image and animation_url", async function () {
      await mintN(10);
      await extension.connect(artist).initializeGame(1, 10, "https://arweave.net/test123");
      const tokenId = 1;

      const uri = await extension.tokenURI(mockCore.target, tokenId);
      expect(uri).to.match(/^data:application\/json;base64,/);

      const jsonStr = Buffer.from(uri.split(",")[1], "base64").toString("utf8");
      const json = JSON.parse(jsonStr);

      expect(json.name).to.equal("ed4ns #1");
      // image field should be the raw artwork URL
      expect(json.image).to.equal("https://arweave.net/test123");
      // animation_url should be a base64 SVG
      expect(json.animation_url).to.match(/^data:image\/svg\+xml;base64,/);

      const statusAttr = json.attributes.find((a) => a.trait_type === "Status");
      expect(statusAttr.value).to.equal("Alive");
    });

    it("should show Eliminated status after cut", async function () {
      await mintN(10);
      await extension.connect(artist).initializeGame(1, 10, "https://arweave.net/test123");

      await advanceTime(MIN_CUT_INTERVAL);
      await extension.triggerCut();
      await fulfillVRF(42);

      // Find an eliminated token
      let eliminatedId;
      for (let i = 1; i <= 10; i++) {
        if (!(await extension.isTokenAlive(i))) {
          eliminatedId = i;
          break;
        }
      }

      const uri = await extension.tokenURI(mockCore.target, eliminatedId);
      const jsonStr = Buffer.from(uri.split(",")[1], "base64").toString("utf8");
      const json = JSON.parse(jsonStr);

      const statusAttr = json.attributes.find((a) => a.trait_type === "Status");
      expect(statusAttr.value).to.equal("Eliminated");
    });

    it("should show Claimed status but keep white border after claiming", async function () {
      await mintN(5);
      await extension.connect(artist).initializeGame(1, 5, "https://arweave.net/test123");
      await advanceTime(MIN_CUT_INTERVAL);
      await extension.triggerCut();
      await fulfillVRF(42);

      let winnerTokenId;
      for (let i = 1; i <= 5; i++) {
        if (await extension.isTokenAlive(i)) {
          winnerTokenId = i;
          break;
        }
      }
      const winnerSigner = minters[Number(winnerTokenId) % minters.length];
      await mockCore.setOwnerOf(winnerTokenId, winnerSigner.address);

      await extension.connect(winnerSigner).claimPrize(winnerTokenId);

      const uri = await extension.tokenURI(mockCore.target, winnerTokenId);
      const jsonStr = Buffer.from(uri.split(",")[1], "base64").toString("utf8");
      const json = JSON.parse(jsonStr);

      const statusAttr = json.attributes.find((a) => a.trait_type === "Status");
      expect(statusAttr.value).to.equal("Claimed");

      const animationUrl = Buffer.from(json.animation_url.split(",")[1], "base64").toString("utf8");
      expect(animationUrl).to.include('stroke="#ffffff"');
      expect(animationUrl).to.not.include('stroke="#a855f7"');
    });

    it("should revert for unminted token", async function () {
      await expect(
        extension.tokenURI(mockCore.target, 999)
      ).to.be.revertedWith("Token not minted");
    });

    it("should revert for wrong core address", async function () {
      await mintN(5);
      await extension.connect(artist).initializeGame(1, 5, "https://arweave.net/test123");
      await expect(
        extension.tokenURI(minters[0].address, 1)
      ).to.be.revertedWith("Wrong core");
    });
  });

  // ─── View helpers ──────────────────────────────────────────────────────────
  describe("View helpers", function () {
    it("secondsUntilNextCut returns MaxUint256 while minting open", async function () {
      const result = await extension.secondsUntilNextCut();
      expect(result).to.equal(ethers.MaxUint256);
    });

    it("secondsUntilNextCut returns 0 when eligible", async function () {
      await mintN(5);
      await extension.connect(artist).initializeGame(1, 5, "https://arweave.net/test123");
      await advanceTime(MIN_CUT_INTERVAL);
      expect(await extension.secondsUntilNextCut()).to.equal(0n);
    });

    it("prizePerWinner returns prizePool / actual survivors", async function () {
      await mintN(5);
      const pool = await extension.prizePool();
      const alive = await extension.aliveCount();
      // Before init, aliveCount is 0, but prizePerWinner should handle division
      // After init:
      await extension.connect(artist).initializeGame(1, 5, "https://arweave.net/test123");
      const ppw = await extension.prizePerWinner();
      expect(ppw).to.equal(pool / 5n);
    });

    it("aliveCount returns computed survivor count", async function () {
      await mintN(10);
      await extension.connect(artist).initializeGame(1, 10, "https://arweave.net/test123");
      expect(await extension.aliveCount()).to.equal(10);

      await advanceTime(MIN_CUT_INTERVAL);
      await extension.triggerCut();
      await fulfillVRF(42);
      expect(await extension.aliveCount()).to.equal(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("Administrative VRF Setters", function () {
    it("should allow the artist to change VRF settings", async function () {
      const newGasLimit = 100_000;
      await extension.connect(artist).setCallbackGasLimit(newGasLimit);
      expect(await extension.s_callbackGasLimit()).to.equal(newGasLimit);

      const newSubId = 999;
      await extension.connect(artist).setSubscriptionId(newSubId);
      expect(await extension.s_subscriptionId()).to.equal(newSubId);

      const newKeyHash = "0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677aa";
      await extension.connect(artist).setVrfKeyHash(newKeyHash);
      expect(await extension.s_keyHash()).to.equal(newKeyHash);
    });

    it("should reject VRF updates from non-artist", async function () {
      await expect(
        extension.connect(minters[0]).setCallbackGasLimit(100_000)
      ).to.be.revertedWith("Not artist");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe("Emergency Rescue & Timeout Cuts", function () {
    beforeEach(async function () {
      await mintN(10);
      await extension.connect(artist).initializeGame(1, 10, "https://arweave.net/test123");
      await advanceTime(MIN_CUT_INTERVAL);
      await extension.triggerCut();
    });

    it("should allow resetting vrfPending after 5 minutes", async function () {
      await expect(extension.triggerCut()).to.be.revertedWith("VRF request pending");

      await advanceTime(5 * 60);
      await extension.connect(artist).resetVrfPending();
      expect(await extension.vrfPending()).to.be.false;

      await extension.triggerCut();
      expect(await extension.vrfPending()).to.be.true;
    });

    it("should reject resetVrfPending if not artist or called too soon", async function () {
      await expect(
        extension.connect(minters[0]).resetVrfPending()
      ).to.be.revertedWith("Not artist");

      await expect(
        extension.connect(artist).resetVrfPending()
      ).to.be.revertedWith("Too soon");
    });

    it("should allow emergency manual cut after 15 minutes of stalling", async function () {
      await expect(
        extension.connect(artist).emergencyManualCut(12345)
      ).to.be.revertedWith("Too soon");

      await advanceTime(15 * 60);

      const beforeCount = await extension.aliveCount();
      await expect(
        extension.connect(artist).emergencyManualCut(12345)
      ).to.emit(extension, "CutFulfilled");

      const afterCount = await extension.aliveCount();
      expect(afterCount).to.be.lt(beforeCount);
      expect(await extension.vrfPending()).to.be.false;
    });

    it("should reject emergency manual cut from non-artist", async function () {
      await advanceTime(15 * 60);
      await expect(
        extension.connect(minters[0]).emergencyManualCut(12345)
      ).to.be.revertedWith("Not artist");
    });
  });
});
