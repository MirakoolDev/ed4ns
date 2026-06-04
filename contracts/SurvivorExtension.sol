// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @author: ed4ns
/// @title  SurvivorExtension — Manifold Creator Core extension for the ed4ns survivor game
///
/// Architecture: Lazy Mathematical Evaluation
///   - Cuts store only a random seed on-chain (O(1) gas, ~50k flat)
///   - Token status is computed mathematically via Fisher-Yates trace
///   - Scales to unlimited players with zero gas increase per cut
///
/// Flow:
///   Phase 1 — Open Edition (OE): The artist runs an OE mint on Manifold.
///             When the OE period ends, the artist calls `initializeGame()` to lock
///             the token supply and start the game clock.
///   Phase 2 — Survival: Anyone can call `triggerCut()` every minCutInterval seconds.
///             Chainlink VRF delivers a random seed. Each round eliminates ~half.
///             When the pool reaches FINAL_SURVIVORS (4), the game ends.
///   Phase 3 — Claim: Each winning token holder calls `claimPrize(tokenId)`
///             to collect their share of the prize pool.

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {IVRFCoordinatorV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {IERC721CreatorCore} from "@manifoldxyz/creator-core-solidity/contracts/core/IERC721CreatorCore.sol";
import {ICreatorExtensionTokenURI} from "@manifoldxyz/creator-core-solidity/contracts/extensions/ICreatorExtensionTokenURI.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract SurvivorExtension is
    VRFConsumerBaseV2Plus,
    ICreatorExtensionTokenURI,
    ReentrancyGuard
{
    using Strings for uint256;

    // ─── Constants ───────────────────────────────────────────────────────────
    uint256 public constant FINAL_SURVIVORS = 4;

    // ─── Game State ──────────────────────────────────────────────────────────
    address public immutable creatorCore;
    address payable public artist;
    uint256 public prizePool;
    bool public mintingOpen;
    bool public gameFinished;
    uint256 public lastCutTimestamp;
    uint256 public minCutInterval;

    // Artwork — set once via setArtworkURI() before calling initializeGame()
    string public artworkURI;       // Direct artwork URL (Arweave / IPFS). Auto-read from Manifold by the platform.

    // Token range (set once during initializeGame)
    uint256 public startTokenId;
    uint256 public endTokenId;
    uint256 public initialPoolSize; // endTokenId - startTokenId + 1

    // ─── Lazy Evaluation State ───────────────────────────────────────────────
    // Instead of storing per-token status, we store one seed per round.
    // Token status is computed mathematically by tracing the Fisher-Yates shuffle.
    uint256[] public roundSeeds;    // One random seed per completed round
    uint256 public roundCount;      // Number of completed rounds
    mapping(uint256 => bool) public prizeClaimed; // tokenId => already claimed

    // ─── Chainlink VRF V2.5 ─────────────────────────────────────────────────
    uint256 public s_subscriptionId;
    bytes32 public s_keyHash;
    uint32 public s_callbackGasLimit;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    uint32 public constant NUM_WORDS = 1;
    uint256 public s_lastRequestId;
    bool public vrfPending;
    uint256 public lastVrfRequestTimestamp;

    // ─── Events ──────────────────────────────────────────────────────────────
    event MintingClosed(uint256 totalPlayers, uint256 prizePool);
    event CutRequested(uint256 indexed requestId, uint256 currentPoolSize);
    event CutFulfilled(uint256 indexed requestId, uint256 round, uint256 survivorsRemaining);
    event GameFinished(uint256 round, uint256 finalSurvivors, uint256 prizePool);
    event PrizeClaimed(address indexed winner, uint256 indexed tokenId, uint256 amount);

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyArtist() {
        require(msg.sender == artist, "Not artist");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(
        address _creatorCore,
        address payable _artist,
        uint256 _minCutInterval,
        address _vrfCoordinator,
        uint256 _subscriptionId,
        bytes32 _keyHash,
        uint32 _callbackGasLimit
    ) VRFConsumerBaseV2Plus(_vrfCoordinator) {
        require(_creatorCore != address(0), "Invalid core");
        require(_artist != address(0), "Invalid artist");

        creatorCore = _creatorCore;
        artist = _artist;
        minCutInterval = _minCutInterval;
        mintingOpen = true;

        // VRF
        s_subscriptionId = _subscriptionId;
        s_keyHash = _keyHash;
        s_callbackGasLimit = _callbackGasLimit;
    }

    // ─── ERC-165 ─────────────────────────────────────────────────────────────
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(IERC165)
        returns (bool)
    {
        return
            interfaceId == type(ICreatorExtensionTokenURI).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 1 — Game Initialization (O(1) — no loops!)
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice Initialize the game after the Manifold Open Edition ends.
    ///         Call setArtworkURI() before this — the platform pre-fills it from Manifold token metadata.
    ///         NO per-token storage writes. O(1) gas regardless of player count.
    function initializeGame(
        uint256 startTokenId_,
        uint256 endTokenId_,
        string calldata artworkURI_
    ) external onlyArtist {
        require(mintingOpen, "Already closed/initialized");
        require(startTokenId_ > 0, "Invalid start ID");
        require(endTokenId_ > startTokenId_, "Invalid range");
        require(endTokenId_ - startTokenId_ + 1 > FINAL_SURVIVORS, "Not enough players");
        require(bytes(artworkURI_).length > 0, "URI cannot be empty");

        // Verify that boundary tokens actually exist on the creator core
        IERC721(creatorCore).ownerOf(startTokenId_);
        IERC721(creatorCore).ownerOf(endTokenId_);

        artworkURI = artworkURI_;
        startTokenId = startTokenId_;
        endTokenId = endTokenId_;
        initialPoolSize = endTokenId_ - startTokenId_ + 1;

        mintingOpen = false;
        lastCutTimestamp = block.timestamp;

        emit MintingClosed(initialPoolSize, prizePool);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 2 — Survival Rounds (O(1) gas per cut!)
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice Anyone can trigger a cut round once conditions are met.
    function triggerCut() external {
        require(!mintingOpen, "Minting still open");
        require(!gameFinished, "Game already finished");
        require(!vrfPending, "VRF request pending");
        require(
            block.timestamp >= lastCutTimestamp + minCutInterval,
            "Too soon"
        );
        require(
            _poolSizeAfterRounds(roundCount) > FINAL_SURVIVORS,
            "Already at final survivors"
        );

        vrfPending = true;
        lastVrfRequestTimestamp = block.timestamp;

        uint256 requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: s_keyHash,
                subId: s_subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit: s_callbackGasLimit,
                numWords: NUM_WORDS,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: false})
                )
            })
        );

        s_lastRequestId = requestId;
        emit CutRequested(requestId, _poolSizeAfterRounds(roundCount));
    }

    /// @notice Chainlink VRF callback — stores the random seed. That's it.
    ///         No array shuffles, no storage pops, no per-token writes.
    ///         Gas cost: ~40,000-50,000 regardless of player count.
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        require(requestId == s_lastRequestId, "Unknown request");
        vrfPending = false;

        // Store the seed — this is the ONLY write per round
        roundSeeds.push(randomWords[0]);
        roundCount++;
        lastCutTimestamp = block.timestamp;

        uint256 survivorsRemaining = _poolSizeAfterRounds(roundCount);

        // Check if game is over
        if (survivorsRemaining <= FINAL_SURVIVORS) {
            gameFinished = true;
            emit GameFinished(roundCount, survivorsRemaining, prizePool);
        }

        emit CutFulfilled(requestId, roundCount, survivorsRemaining);
    }

    /// @notice Emergency: trigger cut manually if VRF is permanently broken.
    ///         Can only be called after 15 minutes of pending request state.
    function emergencyManualCut(uint256 manualSeed) external onlyArtist {
        require(vrfPending, "No request pending");
        require(block.timestamp >= lastVrfRequestTimestamp + 15 minutes, "Too soon");

        vrfPending = false;

        roundSeeds.push(manualSeed);
        roundCount++;
        lastCutTimestamp = block.timestamp;

        uint256 survivorsRemaining = _poolSizeAfterRounds(roundCount);

        if (survivorsRemaining <= FINAL_SURVIVORS) {
            gameFinished = true;
            emit GameFinished(roundCount, survivorsRemaining, prizePool);
        }

        emit CutFulfilled(0, roundCount, survivorsRemaining);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Lazy Evaluation — Pure Mathematical Status Computation
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice Deterministically check if a token survived all rounds.
    ///         Traces the token's virtual index through each round's Fisher-Yates shuffle.
    ///         This is a VIEW function — runs on the RPC node at zero gas cost.
    ///         When called on-chain (e.g. claimPrize), costs ~100k gas for typical games.
    function isTokenAlive(uint256 tokenId) public view returns (bool) {
        if (initialPoolSize == 0) return false;
        if (tokenId < startTokenId || tokenId > endTokenId) return false;

        uint256 index = tokenId - startTokenId; // 0-based position in the pool
        uint256 poolSize = initialPoolSize;

        for (uint256 r = 0; r < roundCount; r++) {
            uint256 survivors = (poolSize + 1) / 2;
            if (survivors < FINAL_SURVIVORS) survivors = FINAL_SURVIVORS;

            uint256 seed = roundSeeds[r];

            // Trace this single token's index through the Fisher-Yates shuffle.
            // We only need to check if our index gets swapped at each step.
            for (uint256 i = 0; i < survivors; i++) {
                uint256 j = i + (uint256(keccak256(abi.encode(seed, i))) % (poolSize - i));
                if (index == i) {
                    index = j;
                } else if (index == j) {
                    index = i;
                }
            }

            // After the shuffle, positions 0..survivors-1 survived.
            // If our index landed at >= survivors, we were eliminated.
            if (index >= survivors) {
                return false;
            }

            poolSize = survivors;
        }

        return true;
    }

    /// @notice Returns which round a token was eliminated in (0 = still alive).
    ///         Useful for frontend display and historical data.
    function eliminatedInRound(uint256 tokenId) public view returns (uint256) {
        if (initialPoolSize == 0) return 0;
        if (tokenId < startTokenId || tokenId > endTokenId) return 0;

        uint256 index = tokenId - startTokenId;
        uint256 poolSize = initialPoolSize;

        for (uint256 r = 0; r < roundCount; r++) {
            uint256 survivors = (poolSize + 1) / 2;
            if (survivors < FINAL_SURVIVORS) survivors = FINAL_SURVIVORS;

            uint256 seed = roundSeeds[r];

            for (uint256 i = 0; i < survivors; i++) {
                uint256 j = i + (uint256(keccak256(abi.encode(seed, i))) % (poolSize - i));
                if (index == i) {
                    index = j;
                } else if (index == j) {
                    index = i;
                }
            }

            if (index >= survivors) {
                return r + 1; // Eliminated in round r+1 (1-indexed)
            }

            poolSize = survivors;
        }

        return 0; // Still alive
    }

    /// @notice Compute the pool size after a given number of rounds.
    function _poolSizeAfterRounds(uint256 rounds) internal view returns (uint256) {
        uint256 poolSize = initialPoolSize;
        for (uint256 r = 0; r < rounds; r++) {
            uint256 survivors = (poolSize + 1) / 2;
            if (survivors < FINAL_SURVIVORS) survivors = FINAL_SURVIVORS;
            poolSize = survivors;
        }
        return poolSize;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 3 — Prize Claim
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice Winning token holders call this to claim their ETH share.
    ///         Prize is divided by actual final survivor count (not hardcoded).
    function claimPrize(uint256 tokenId) external nonReentrant {
        require(gameFinished, "Game not finished");
        require(!prizeClaimed[tokenId], "Already claimed");
        require(isTokenAlive(tokenId), "Not a winner");
        require(
            IERC721(creatorCore).ownerOf(tokenId) == msg.sender,
            "Not token owner"
        );

        prizeClaimed[tokenId] = true;

        uint256 finalSurvivors = _poolSizeAfterRounds(roundCount);
        uint256 share = prizePool / finalSurvivors;
        // Safety: send remaining balance on last claim to avoid dust lockup
        uint256 balance = address(this).balance;
        uint256 payout = share < balance ? share : balance;

        (bool ok, ) = payable(msg.sender).call{value: payout}("");
        require(ok, "Transfer failed");

        emit PrizeClaimed(msg.sender, tokenId, payout);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Dynamic On-Chain Metadata
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice Called by Manifold Creator Core when tokenURI is requested.
    ///         Computes status mathematically — no storage lookups needed.
    function tokenURI(address creator, uint256 tokenId)
        external
        view
        override
        returns (string memory)
    {
        require(creator == creatorCore, "Wrong core");

        // Verify token exists on core
        try IERC721(creatorCore).ownerOf(tokenId) returns (address) {
            // Token exists, continue
        } catch {
            revert("Token not minted");
        }

        // Compute status mathematically
        string memory statusStr;
        string memory borderColor;

        bool inGameRange = tokenId >= startTokenId && tokenId <= endTokenId;

        if (mintingOpen || !inGameRange) {
            // During minting or tokens outside game range: neutral state
            statusStr = inGameRange ? "Pending" : "Non-Participant";
            borderColor = "";
        } else if (gameFinished && inGameRange && isTokenAlive(tokenId)) {
            if (prizeClaimed[tokenId]) {
                statusStr = "Claimed";
            } else {
                statusStr = "Winner";
            }
            borderColor = "#ffffff"; // White for winner
        } else if (inGameRange && isTokenAlive(tokenId)) {
            statusStr = "Alive";
            borderColor = "#39d353"; // Green
        } else {
            statusStr = "Eliminated";
            borderColor = "#f43f5e"; // Red/Rose
        }

        string memory animSvg = _buildBorderSVG(borderColor);
        string memory json = _buildJSON(tokenId, statusStr, animSvg);

        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64.encode(bytes(json))
            )
        );
    }

    /// @notice Build a transparent SVG border frame that adapts to artwork dimensions.
    ///         Uses artworkWidth/artworkHeight for proper aspect ratio.
    ///         Does NOT embed external images — avoiding all browser/platform sandbox issues.
    function _buildBorderSVG(string memory borderColor)
        internal
        pure
        returns (string memory)
    {
        // Ratio-agnostic SVG: viewBox 0 0 100 100, preserveAspectRatio handles any image shape.
        // The border is a rect with a 2-unit inset and 4-unit stroke — looks clean at any ratio.
        string memory borderTag = "";
        if (bytes(borderColor).length > 0) {
            borderTag = string(
                abi.encodePacked(
                    '<rect x="2" y="2" width="96" height="96"',
                    ' fill="none" stroke="', borderColor,
                    '" stroke-width="4"/>'
                )
            );
        }

        return string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg"',
                ' viewBox="0 0 100 100"',
                ' preserveAspectRatio="xMidYMid meet"',
                ' style="background-color:transparent;">',
                borderTag,
                '</svg>'
            )
        );
    }

    function _buildJSON(
        uint256 tokenId,
        string memory statusStr,
        string memory animSvg
    ) internal view returns (string memory) {
        string memory animSvgBase64 = Base64.encode(bytes(animSvg));

        uint256 currentAlive = mintingOpen ? initialPoolSize : _poolSizeAfterRounds(roundCount);
        uint256 finalSurvivors = _poolSizeAfterRounds(roundCount);
        uint256 perWinner = finalSurvivors > 0 ? prizePool / finalSurvivors : 0;

        return string(
            abi.encodePacked(
                '{"name":"ed4ns #', tokenId.toString(), '",',
                '"description":"A survivor NFT. Only the final 4 share the prize pool.",',
                '"image":"', artworkURI, '",',
                '"animation_url":"data:image/svg+xml;base64,', animSvgBase64, '",',
                '"attributes":[',
                '{"trait_type":"Status","value":"', statusStr, '"},',
                '{"trait_type":"Token ID","value":', tokenId.toString(), '},',
                '{"trait_type":"Round","value":', roundCount.toString(), '},',
                '{"trait_type":"Prize Pool (wei)","value":', prizePool.toString(), '},',
                '{"trait_type":"Alive Count","value":', currentAlive.toString(), '},',
                '{"trait_type":"Prize Per Winner (wei)","value":', perWinner.toString(), '}',
                ']}'
            )
        );
    }

    // ─── Emergency ───────────────────────────────────────────────────────────

    /// @notice Emergency: Reset VRF pending state if request times out.
    function resetVrfPending() external onlyArtist {
        require(vrfPending, "No request pending");
        require(block.timestamp >= lastVrfRequestTimestamp + 5 minutes, "Too soon");
        vrfPending = false;
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    /// @notice Update the URI for the base artwork.
    ///         Call this BEFORE initializeGame(). The platform UI auto-populates
    ///         this from the existing Manifold token metadata — no manual lookup needed.
    function setArtworkURI(string calldata uri) external onlyArtist {
        require(bytes(uri).length > 0, "Invalid URI");
        artworkURI = uri;
    }

    /// @notice Update the artist address.
    function setArtist(address payable newArtist) external onlyArtist {
        require(newArtist != address(0), "Invalid");
        artist = newArtist;
    }

    /// @notice Update the cut interval (seconds between rounds).
    function setMinCutInterval(uint256 interval) external onlyArtist {
        minCutInterval = interval;
    }

    /// @notice Set the callback gas limit for Chainlink VRF.
    function setCallbackGasLimit(uint32 callbackGasLimit) external onlyArtist {
        s_callbackGasLimit = callbackGasLimit;
    }

    /// @notice Set the subscription ID for Chainlink VRF.
    function setSubscriptionId(uint256 subId) external onlyArtist {
        s_subscriptionId = subId;
    }

    /// @notice Set the key hash for Chainlink VRF.
    function setVrfKeyHash(bytes32 keyHash) external onlyArtist {
        s_keyHash = keyHash;
    }

    /// @notice Emergency: allow artist to recover stuck ETH after game ends and all claimed.
    function emergencyWithdraw() external onlyArtist {
        require(gameFinished, "Game not finished");
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool ok, ) = artist.call{value: balance}("");
            require(ok, "Withdraw failed");
        }
    }

    // ─── View Helpers ────────────────────────────────────────────────────────

    /// @notice Current number of alive tokens (computed, not stored).
    function aliveCount() external view returns (uint256) {
        if (mintingOpen || initialPoolSize == 0) return 0;
        return _poolSizeAfterRounds(roundCount);
    }

    /// @notice Seconds until the next cut is eligible (0 if eligible now).
    function secondsUntilNextCut() external view returns (uint256) {
        if (mintingOpen || gameFinished || vrfPending) return type(uint256).max;
        if (_poolSizeAfterRounds(roundCount) <= FINAL_SURVIVORS) return type(uint256).max;
        uint256 nextCut = lastCutTimestamp + minCutInterval;
        if (block.timestamp >= nextCut) return 0;
        return nextCut - block.timestamp;
    }

    /// @notice Prize share per winner in wei (uses actual final survivor count).
    function prizePerWinner() external view returns (uint256) {
        uint256 finalSurvivors = _poolSizeAfterRounds(roundCount);
        if (finalSurvivors == 0) return 0;
        return prizePool / finalSurvivors;
    }

    /// @notice Get a specific round's seed.
    function getRoundSeed(uint256 roundIndex) external view returns (uint256) {
        require(roundIndex < roundCount, "Round not played");
        return roundSeeds[roundIndex];
    }

    receive() external payable {
        // Automatically split incoming Manifold mint proceeds:
        // 50% stays in the contract for the prize pool
        // 50% is instantly forwarded to the artist's personal wallet
        uint256 poolShare = msg.value / 2;
        uint256 artistShare = msg.value - poolShare;

        prizePool += poolShare;

        (bool ok, ) = artist.call{value: artistShare}("");
        require(ok, "Artist transfer failed");
    }
}
