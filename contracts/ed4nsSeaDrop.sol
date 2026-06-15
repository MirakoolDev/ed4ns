// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @author ed4ns
/// @title  ed4nsSeaDrop — Standalone Open Edition NFT & Commit-Reveal Survival Game
///
/// Architecture: Standalone SeaDrop NFT survival game (no clones, no factory)
///   - Inherits ERC721SeaDrop directly for native OpenSea Studio compatibility
///   - Commit-Reveal future blockhash randomizer (completely free, no Chainlink VRF)
///   - O(1) gas lazy mathematical evaluation survivor game engine

import {ERC721SeaDrop} from "seadrop/ERC721SeaDrop.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

struct GameConfig {
    string name;
    string symbol;
    string description;
    string artworkURI;
    address payable artist;
    address payable protocol;
    uint256 minCutInterval;
    uint256 prizePoolSharePercent;
    uint256 artistSharePercent;
    uint256 protocolSharePercent;
}

contract ed4nsSeaDrop is ERC721SeaDrop {
    using Strings for uint256;

    error Unauthorized();
    error InvalidArgs();
    error BadState();
    error BadTx();

    // ─── Constants ───────────────────────────────────────────────────────────
    uint256 public constant FINAL_SURVIVORS = 4;

    // ─── Game State ──────────────────────────────────────────────────────────
    address payable public artist;
    address payable public protocol;
    uint256 public prizePoolSharePercent;
    uint256 public artistSharePercent;
    uint256 public protocolSharePercent;

    uint256 public prizePool;
    bool public gameInitialized;
    bool public gameFinished;

    // Cooldown & Commit-Reveal Cut State
    uint256 public lastCutTimestamp;
    uint256 public minCutInterval;
    bool public cutPending;
    uint64 public revealBlock;

    // Artwork
    string public artworkURI;
    string public collectionDescription;

    // Lazy Evaluation State
    uint256[] public roundSeeds;
    uint256 public roundCount;
    mapping(uint256 => bool) public prizeClaimed;

    // ─── Events ──────────────────────────────────────────────────────────────
    event GameInitialized(uint256 totalPlayers, string artworkURI, uint256 prizePool);
    event CutCommitted(uint64 indexed targetBlock, uint256 round);
    event CutFulfilled(uint256 indexed round, uint256 survivorsRemaining);
    event GameFinished(uint256 round, uint256 finalSurvivors, uint256 prizePool);
    event PrizeClaimed(address indexed winner, uint256 indexed tokenId, uint256 amount);
    event MetadataUpdate(uint256 _tokenId);
    
    modifier onlyArtist() {
        if (msg.sender != artist) revert Unauthorized();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────
    constructor(
        GameConfig memory config,
        address[] memory allowedSeaDrop
    ) ERC721SeaDrop(config.name, config.symbol, allowedSeaDrop) {
        if (config.artist == address(0)) revert InvalidArgs();
        if (config.protocol == address(0)) revert InvalidArgs();
        if (config.prizePoolSharePercent + config.artistSharePercent + config.protocolSharePercent != 100) revert InvalidArgs();

        collectionDescription = config.description;
        artworkURI   = config.artworkURI;

        artist   = config.artist;
        protocol = config.protocol;
        minCutInterval = config.minCutInterval;

        prizePoolSharePercent = config.prizePoolSharePercent;
        artistSharePercent = config.artistSharePercent;
        protocolSharePercent = config.protocolSharePercent;

        // SeaDrop owner is msg.sender by default, transfer to artist
        _transferOwnership(artist);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 1 — Initialization
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice Route incoming ETH (e.g. from SeaDrop) to prize pool, artist, and protocol
    receive() external payable {
        if (msg.value == 0) return;
        uint256 poolShare = (msg.value * prizePoolSharePercent) / 100;
        uint256 artistShare = (msg.value * artistSharePercent) / 100;
        uint256 protocolShare = msg.value - poolShare - artistShare;

        prizePool += poolShare;

        (bool successArtist, ) = artist.call{value: artistShare}("");
        if (!successArtist) revert BadTx();

        (bool successProtocol, ) = protocol.call{value: protocolShare}("");
        if (!successProtocol) revert BadTx();
    }

    // ─── Game Initialization ─────────────────────────────────────────────────
    function initializeGame() external onlyArtist {
        if (gameInitialized) revert BadState();
        if (totalSupply() == 0) revert BadState(); // Require at least 1 mint
        
        gameInitialized = true;
        lastCutTimestamp = block.timestamp;

        if (totalSupply() <= FINAL_SURVIVORS) {
            gameFinished = true;
            emit GameFinished(0, totalSupply(), prizePool);
        }
        
        emit GameInitialized(totalSupply(), artworkURI, prizePool);
    }

    // ─── SeaDrop Mint Override ───────────────────────────────────────────────
    /**
     * @dev We override mintSeaDrop to ensure that NO mints can happen after 
     * the game has been initialized, even if OpenSea's schedule says otherwise.
     */
    function mintSeaDrop(address minter, uint256 quantity) external override nonReentrant {
        require(!gameInitialized, "Game already started, minting closed");
        
        // Ensure the SeaDrop is allowed.
        _onlyAllowedSeaDrop(msg.sender);

        // Extra safety check to ensure the max supply is not exceeded.
        if (_totalMinted() + quantity > maxSupply()) {
            revert MintQuantityExceedsMaxSupply(
                _totalMinted() + quantity,
                maxSupply()
            );
        }

        // Mint the quantity of tokens to the minter.
        _safeMint(minter, quantity);
    }

    /// @dev Override ERC721A starting token ID to 1 for game logic compatibility
    function _startTokenId() internal view virtual override returns (uint256) {
        return 1;
    }

    /// @notice Backwards compatible game initialization
    function initializeGame(uint256, uint256, string calldata) external onlyArtist {
        if (gameInitialized) revert BadState();
        if (totalSupply() == 0) revert BadState();

        gameInitialized = true;
        lastCutTimestamp = block.timestamp;

        emit GameInitialized(totalSupply(), artworkURI, prizePool);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 2 — Future Blockhash Commit-Reveal Cuts (100% Free & On-Chain!)
    // ═════════════════════════════════════════════════════════════════════════

    function triggerCut() external {
        if (!gameInitialized || gameFinished || cutPending) revert BadState();
        if (block.timestamp < lastCutTimestamp + minCutInterval) revert BadState();
        if (_poolSizeAfterRounds(roundCount) <= FINAL_SURVIVORS) revert BadState();

        cutPending = true;
        revealBlock = uint64(block.number + 1);
        lastCutTimestamp = block.timestamp;

        emit CutCommitted(revealBlock, roundCount + 1);
    }

    function revealCut() external {
        if (!cutPending || block.number <= revealBlock || block.number > revealBlock + 256) revert BadState();

        bytes32 bhash = blockhash(revealBlock);
        if (bhash == bytes32(0)) revert BadState();

        uint256 seed = uint256(
            keccak256(abi.encodePacked(bhash, block.prevrandao, roundCount))
        );

        roundSeeds.push(seed);
        roundCount++;
        cutPending = false;

        uint256 survivorsRemaining = _poolSizeAfterRounds(roundCount);

        if (survivorsRemaining <= FINAL_SURVIVORS) {
            gameFinished = true;
            emit GameFinished(roundCount, survivorsRemaining, prizePool);
        }

        emit CutFulfilled(roundCount, survivorsRemaining);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Lazy Evaluation — Pure Mathematical Status Computation
    // ═════════════════════════════════════════════════════════════════════════

    function isTokenAlive(uint256 tokenId) public view returns (bool) {
        if (totalSupply() == 0) return false;
        if (tokenId < 1 || tokenId > totalSupply()) return false;

        uint256 index = tokenId - 1;
        uint256 poolSize = totalSupply();

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
                return false;
            }

            poolSize = survivors;
        }

        return true;
    }

    function eliminatedInRound(uint256 tokenId) public view returns (uint256) {
        if (totalSupply() == 0) return 0;
        if (tokenId < 1 || tokenId > totalSupply()) return 0;

        uint256 index = tokenId - 1;
        uint256 poolSize = totalSupply();

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
                return r + 1;
            }

            poolSize = survivors;
        }

        return 0;
    }

    function _poolSizeAfterRounds(uint256 rounds) internal view returns (uint256) {
        uint256 poolSize = totalSupply();
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

    function claimPrize(uint256 tokenId) external {
        if (!gameFinished || prizeClaimed[tokenId] || !isTokenAlive(tokenId) || ownerOf(tokenId) != msg.sender) revert BadState();

        prizeClaimed[tokenId] = true;

        uint256 finalSurvivors = _poolSizeAfterRounds(roundCount);
        uint256 share = prizePool / finalSurvivors;
        uint256 balance = address(this).balance;
        uint256 payout = share < balance ? share : balance;

        (bool ok, ) = payable(msg.sender).call{value: payout}("");
        if (!ok) revert BadTx();

        emit PrizeClaimed(msg.sender, tokenId, payout);
        emit MetadataUpdate(tokenId);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Dynamic Metadata & Borders
    // ═════════════════════════════════════════════════════════════════════════

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (tokenId == 0 || tokenId > totalSupply()) revert InvalidArgs();

        string memory statusStr;
        string memory borderColor;

        if (!gameInitialized) {
            statusStr = "Pending";
            borderColor = "";
        } else if (gameFinished && isTokenAlive(tokenId)) {
            statusStr = prizeClaimed[tokenId] ? "Claimed" : "Winner";
            borderColor = "#ffffff";
        } else if (isTokenAlive(tokenId)) {
            statusStr = "Alive";
            borderColor = "#39d353";
        } else {
            statusStr = "Eliminated";
            borderColor = "#f43f5e";
        }

        string memory animSvg = _buildBorderSVG(borderColor, artworkURI);
        string memory json = _buildJSON(tokenId, statusStr, animSvg);

        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64.encode(bytes(json))
            )
        );
    }

    function _buildBorderSVG(string memory borderColor, string memory artUri)
        internal
        pure
        returns (string memory)
    {
        string memory borderCss = "";
        if (bytes(borderColor).length > 0) {
            borderCss = string(abi.encodePacked("border: 2vmin solid ", borderColor, ";"));
        }

        return string(
            abi.encodePacked(
                '<!DOCTYPE html><html><head><style>body{margin:0;display:flex;justify-content:center;align-items:center;height:100vh;background:transparent;}img{max-width:100%;max-height:100%;box-sizing:border-box;',
                borderCss,
                '}</style></head><body><img src="',
                artUri,
                '"/></body></html>'
            )
        );
    }

    function _buildJSON(
        uint256 tokenId,
        string memory statusStr,
        string memory animSvg
    ) internal view returns (string memory) {
        string memory animSvgBase64 = Base64.encode(bytes(animSvg));

        uint256 elimRound = gameInitialized ? eliminatedInRound(tokenId) : 0;
        uint256 survivedRounds = elimRound > 0 ? elimRound - 1 : roundCount;

        string memory part1 = string(
            abi.encodePacked(
                '{"name":"', name(), ' #', tokenId.toString(), '",',
                '"description":"', collectionDescription, '",',
                '"image":"', artworkURI, '",',
                '"animation_url":"data:text/html;base64,', animSvgBase64, '",'
            )
        );

        string memory part2a = string(
            abi.encodePacked(
                '"attributes":[',
                '{"trait_type":"Status","value":"', statusStr, '"},',
                '{"trait_type":"Survived Rounds","value":', survivedRounds.toString(), '},'
            )
        );

        string memory part2b = string(
            abi.encodePacked(
                '{"trait_type":"Eliminated In Round","value":', elimRound.toString(), '},',
                '{"trait_type":"Token ID","value":', tokenId.toString(), '}',
                ']}' 
            )
        );

        return string(abi.encodePacked(part1, part2a, part2b));
    }

    // ─── Emergency & Admin ───────────────────────────────────────────────────

    function resetCutPending() external onlyArtist {
        if (!cutPending || block.number <= revealBlock + 256) revert BadState();
        cutPending = false;
    }

    function setArtworkURI(string calldata uri) external onlyArtist {
        if (bytes(uri).length == 0) revert InvalidArgs();
        artworkURI = uri;
    }

    function setArtist(address payable newArtist) external onlyArtist {
        if (newArtist == address(0)) revert InvalidArgs();
        artist = newArtist;
    }

    function setMinCutInterval(uint256 interval) external onlyArtist {
        minCutInterval = interval;
    }

    function emergencyWithdraw() external onlyArtist {
        if (!gameFinished) revert BadState();
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool ok, ) = artist.call{value: balance}("");
            if (!ok) revert BadTx();
        }
    }

    // ─── External View Helpers ───────────────────────────────────────────────

    function aliveCount() external view returns (uint256) {
        if (!gameInitialized) return 0;
        return _poolSizeAfterRounds(roundCount);
    }

    function secondsUntilNextCut() external view returns (uint256) {
        if (!gameInitialized || gameFinished || cutPending) return type(uint256).max;
        if (_poolSizeAfterRounds(roundCount) <= FINAL_SURVIVORS) return type(uint256).max;
        uint256 nextCut = lastCutTimestamp + minCutInterval;
        if (block.timestamp >= nextCut) return 0;
        return nextCut - block.timestamp;
    }

    function prizePerWinner() external view returns (uint256) {
        uint256 finalSurvivors = _poolSizeAfterRounds(roundCount);
        if (finalSurvivors == 0) return 0;
        return prizePool / finalSurvivors;
    }

    function getRoundSeed(uint256 roundIndex) external view returns (uint256) {
        if (roundIndex >= roundCount) revert BadState();
        return roundSeeds[roundIndex];
    }

    function startTokenId() external pure returns (uint256) { return 1; }
    function endTokenId() external view returns (uint256) { return totalSupply(); }
    function mintingOpen() external view returns (bool) {
        return !gameInitialized;
    }
}