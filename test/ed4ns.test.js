const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ed4ns", function () {
  // ── Constants ──────────────────────────────────────────────────────────────
  const MINT_PRICE = ethers.parseEther("0.01");
  const MIN_CUT_INTERVAL = 4 * 60; // 4 minutes
  const FINAL_SURVIVORS = 4;
  const ARTWORK_URI = "https://arweave.net/7voe7GOK5tdxnBWZRe0Oz4pOp3nmy3MBpNBrArm9sU8";

  // ── Fixtures ───────────────────────────────────────────────────────────────
  let contract;
  let artist, minters;
  let mintOpenTime, mintCloseTime;

  beforeEach(async function () {
    [artist, ...minters] = await ethers.getSigners();

    const latestBlock = await ethers.provider.getBlock("latest");
    const now = latestBlock.timestamp;
    mintOpenTime = now - 60;          // Open 1 minute ago
    mintCloseTime = now + 24 * 60 * 60; // Closes in 24 hours

    const ed4nsFactory = await ethers.getContractFactory("ed4ns");
    contract = await ed4nsFactory.deploy(
      artist.address,
      MINT_PRICE,
      mintOpenTime,
      mintCloseTime,
      MIN_CUT_INTERVAL
    );
    await contract.waitForDeployment();
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  async function mintN(n) {
    for (let i = 0; i < n; i++) {
      const minter = minters[i % minters.length];
      await contract.connect(minter).mint(1, { value: MINT_PRICE });
    }
  }

  async function advanceTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
  }

  async function mineBlock() {
    await ethers.provider.send("evm_mine");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  describe("Phase 1 — Public Open Edition Minting", function () {
    it("should allow public mint during active window and split funds 50/50", async function () {
      const artistBefore = await ethers.provider.getBalance(artist.address);

      const tx = await contract.connect(minters[0]).mint(5, { value: MINT_PRICE * 5n });
      await tx.wait();

      // Check total supply
      expect(await contract.totalSupply()).to.equal(5n);
      expect(await contract.balanceOf(minters[0].address)).to.equal(5n);

      // Check artist got 50%
      const artistAfter = await ethers.provider.getBalance(artist.address);
      const expectedArtistShare = (MINT_PRICE * 5n) / 2n;
      expect(artistAfter - artistBefore).to.equal(expectedArtistShare);

      // Check contract holds 50%
      expect(await contract.prizePool()).to.equal(expectedArtistShare);
      expect(await ethers.provider.getBalance(contract.target)).to.equal(expectedArtistShare);
    });

    it("should reject minting if not open or already concluded", async function () {
      const latestBlock = await ethers.provider.getBlock("latest");
      const now = latestBlock.timestamp;
      const ed4nsFactory = await ethers.getContractFactory("ed4ns");
      
      const futureContract = await ed4nsFactory.deploy(
        artist.address,
        MINT_PRICE,
        now + 100, // opens in future
        now + 500,
        MIN_CUT_INTERVAL
      );
      await futureContract.waitForDeployment();

      await expect(
        futureContract.connect(minters[0]).mint(1, { value: MINT_PRICE })
      ).to.be.revertedWith("Minting not open yet");

      // Advance past close time
      await advanceTime(24 * 60 * 60 + 100);

      await expect(
        contract.connect(minters[0]).mint(1, { value: MINT_PRICE })
      ).to.be.revertedWith("Minting concluded");
    });

    it("should reject minting if payment is incorrect", async function () {
      await expect(
        contract.connect(minters[0]).mint(2, { value: MINT_PRICE })
      ).to.be.revertedWith("Incorrect ETH sent");
    });
  });

  describe("initializeGame", function () {
    it("should allow the artist to initialize once minting ends", async function () {
      await mintN(10);
      
      // Conclude minting
      await advanceTime(24 * 60 * 60 + 100);

      await expect(
        contract.connect(minters[0]).initializeGame(ARTWORK_URI)
      ).to.be.revertedWith("Not artist");

      await expect(
        contract.connect(artist).initializeGame("")
      ).to.be.revertedWith("Invalid artwork URI");

      await expect(
        contract.connect(artist).initializeGame(ARTWORK_URI)
      ).to.emit(contract, "GameInitialized");

      expect(await contract.gameInitialized()).to.be.true;
      expect(await contract.artworkURI()).to.equal(ARTWORK_URI);
    });

    it("should reject initialization if players count is too low", async function () {
      await mintN(3); // Less than FINAL_SURVIVORS (4)
      await advanceTime(24 * 60 * 60 + 100);

      await expect(
        contract.connect(artist).initializeGame(ARTWORK_URI)
      ).to.be.revertedWith("Not enough players");
    });
  });

  describe("triggerCut and revealCut (Commit-Reveal randomizer)", function () {
    beforeEach(async function () {
      await mintN(10);
      await advanceTime(24 * 60 * 60 + 100);
      await contract.connect(artist).initializeGame(ARTWORK_URI);
    });

    it("should commit cut to the next block and successfully resolve via revealCut", async function () {
      await advanceTime(MIN_CUT_INTERVAL);

      const commitTx = await contract.triggerCut();
      const receipt = await commitTx.wait();

      const expectedRevealBlock = receipt.blockNumber + 1;
      expect(await contract.cutPending()).to.be.true;
      expect(await contract.revealBlock()).to.equal(expectedRevealBlock);

      // Try to reveal immediately in the SAME block (should revert)
      await expect(
        contract.revealCut()
      ).to.be.revertedWith("Block not mined yet");

      // Mine the next block
      await mineBlock();

      // Now reveal
      const revealTx = await contract.revealCut();
      await expect(revealTx).to.emit(contract, "CutFulfilled");

      expect(await contract.cutPending()).to.be.false;
      expect(await contract.roundCount()).to.equal(1n);

      // Verify seeds and alive count
      expect(await contract.getRoundSeed(0)).to.not.equal(0n);
      expect(await contract.aliveCount()).to.be.lt(10n);
    });

    it("should reject triggerCut if called too soon or already pending", async function () {
      await advanceTime(MIN_CUT_INTERVAL);
      await contract.triggerCut();

      await expect(
        contract.triggerCut()
      ).to.be.revertedWith("Cut already pending");

      await mineBlock();
      await contract.revealCut();

      // Attempt to trigger again immediately without waiting for cooldown
      await expect(
        contract.triggerCut()
      ).to.be.revertedWith("Too soon");
    });

    it("should recover gracefully if revealCut is stalled past EVM blockhash range (256 blocks)", async function () {
      await advanceTime(MIN_CUT_INTERVAL);
      await contract.triggerCut();

      // Stall the game by mining 300 blocks
      for (let i = 0; i < 300; i++) {
        await mineBlock();
      }

      // Should succeed and use fallback blockhash without reverting!
      await expect(contract.revealCut()).to.emit(contract, "CutFulfilled");
      expect(await contract.cutPending()).to.be.false;
      expect(await contract.roundCount()).to.equal(1n);
    });

    it("should allow resetting the pending state if stalled", async function () {
      await advanceTime(MIN_CUT_INTERVAL);
      await contract.triggerCut();

      // Too soon to reset
      await expect(
        contract.connect(artist).resetVrfPending()
      ).to.be.revertedWith("Too soon");

      // Advance 30 blocks (~6 minutes)
      for (let i = 0; i < 30; i++) {
        await mineBlock();
      }

      await contract.connect(artist).resetVrfPending();
      expect(await contract.cutPending()).to.be.false;
    });
  });

  describe("Lazy Evaluation Mathematical Tracing", function () {
    beforeEach(async function () {
      await mintN(10);
      await advanceTime(24 * 60 * 60 + 100);
      await contract.connect(artist).initializeGame(ARTWORK_URI);
    });

    it("should correctly compute isTokenAlive and round status mathematically", async function () {
      // Before any cuts, all tokens must be alive
      for (let i = 1; i <= 10; i++) {
        expect(await contract.isTokenAlive(i)).to.be.true;
        expect(await contract.eliminatedInRound(i)).to.equal(0n);
      }

      // Trigger and resolve cut
      await advanceTime(MIN_CUT_INTERVAL);
      await contract.triggerCut();
      await mineBlock();
      await contract.revealCut();

      // Total alive should decrease (roughly half eliminated)
      let aliveCount = 0;
      for (let i = 1; i <= 10; i++) {
        const isAlive = await contract.isTokenAlive(i);
        const elimRound = await contract.eliminatedInRound(i);

        if (isAlive) {
          aliveCount++;
          expect(elimRound).to.equal(0n);
        } else {
          expect(elimRound).to.equal(1n); // eliminated in round 1
        }
      }
      expect(aliveCount).to.equal(await contract.aliveCount());
      expect(aliveCount).to.be.lt(10);
    });
  });

  describe("tokenURI and claimPrize", function () {
    beforeEach(async function () {
      await mintN(6);
      await advanceTime(24 * 60 * 60 + 100);
      await contract.connect(artist).initializeGame(ARTWORK_URI);
    });

    it("should return valid base64 metadata URI and allow winners to claim", async function () {
      const uri = await contract.tokenURI(1);
      expect(uri).to.contain("data:application/json;base64,");

      // Play rounds until game finishes (FINAL_SURVIVORS = 4)
      await advanceTime(MIN_CUT_INTERVAL);
      await contract.triggerCut();
      await mineBlock();
      await contract.revealCut();

      expect(await contract.gameFinished()).to.be.true;

      // Find a winning token
      let winnerTokenId = 0;
      for (let i = 1; i <= 6; i++) {
        if (await contract.isTokenAlive(i)) {
          winnerTokenId = i;
          break;
        }
      }

      const winnerAddress = await contract.ownerOf(winnerTokenId);
      const winnerSigner = minters.find(m => m.address === winnerAddress) || artist;

      const balanceBefore = await ethers.provider.getBalance(winnerSigner.address);
      const prizePoolSize = await contract.prizePool();
      const expectedShare = prizePoolSize / 4n;

      const claimTx = await contract.connect(winnerSigner).claimPrize(winnerTokenId);
      const receipt = await claimTx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(winnerSigner.address);
      expect(balanceAfter - balanceBefore).to.equal(expectedShare - gasUsed);
      expect(await contract.prizeClaimed(winnerTokenId)).to.be.true;

      // Duplicate claims must revert
      await expect(
        contract.connect(winnerSigner).claimPrize(winnerTokenId)
      ).to.be.revertedWith("Already claimed");
    });
  });
});
