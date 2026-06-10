// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @author ed4ns
/// @title  ed4ns — Standalone Open Edition NFT & Commit-Reveal Survival Game
///
/// Architecture: Cloneable (EIP-1167) NFT survival game
///   - Initializable instead of constructor — used by Ed4nsFactory clones
///   - Commit-Reveal future blockhash randomizer (completely free, no Chainlink VRF)
///   - O(1) gas lazy mathematical evaluation survivor game engine

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {INonFungibleSeaDropToken} from "./interfaces/INonFungibleSeaDropToken.sol";
import {ISeaDrop} from "./interfaces/ISeaDrop.sol";
import {PublicDrop, AllowListData, TokenGatedDropStage, SignedMintValidationParams} from "./lib/SeaDropStructs.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

struct GameConfig {
    string name;
    string symbol;
    string description;
    string artworkURI;
    address payable artist;
    address payable protocol;
    uint256 mintPrice;
    uint256 mintOpenTime;
    uint256 mintCloseTime;
    uint256 minCutInterval;
    uint256 prizePoolSharePercent;
    uint256 artistSharePercent;
    uint256 protocolSharePercent;
}

contract ed4nsV2 is ERC721, INonFungibleSeaDropToken {
    using Strings for uint256;

    error Unauthorized();
    error InvalidArgs();
    error BadState();
    error BadTx();

    // ─── Constants ───────────────────────────────────────────────────────────
    uint256 public constant FINAL_SURVIVORS = 4;

    // ─── Clone init guard ────────────────────────────────────────────────────
    bool private _initialized;

    // ─── Metadata (overriding ERC721 name/symbol) ────────────────────────────
    string private _tokenName;
    string private _tokenSymbol;

    // ─── Game State ──────────────────────────────────────────────────────────
    address payable public artist;
    address payable public protocol;
    uint256 public mintPrice;
    uint256 public mintOpenTime;
    uint256 public mintCloseTime;
    uint256 public prizePoolSharePercent;
    uint256 public artistSharePercent;
    uint256 public protocolSharePercent;
    uint256 private _totalSupply;

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
    event MintOpen(uint256 openTime, uint256 closeTime, uint256 price);
    event TokenMinted(address indexed to, uint256 indexed tokenId, uint256 price);
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

    // ─── Initializer (called once per clone) ─────────────────────────────────
    // ═════════════════════════════════════════════════════════════════════════
    // SeaDrop Integration
    // ═════════════════════════════════════════════════════════════════════════

    mapping(address => bool) internal _allowedSeaDrop;

    function updateAllowedSeaDrop(address[] calldata allowedSeaDrop) external override onlyArtist {
        for (uint256 i = 0; i < allowedSeaDrop.length; i++) {
            _allowedSeaDrop[allowedSeaDrop[i]] = true;
        }
        emit AllowedSeaDropUpdated(allowedSeaDrop);
    }

    function mintSeaDrop(address minter, uint256 quantity) external override {
        if (!_allowedSeaDrop[msg.sender]) revert OnlyAllowedSeaDrop();
        if (block.timestamp < mintOpenTime || block.timestamp > mintCloseTime) revert BadState();

        uint256 startId = _totalSupply + 1;
        _totalSupply += quantity;

        for (uint256 i = 0; i < quantity; i++) {
            _mint(minter, startId + i);
            emit TokenMinted(minter, startId + i, mintPrice);
        }
    }

    function getMintStats(address minter) external view override returns (uint256 minterNumMinted, uint256 currentTotalSupply, uint256 _maxSupply) {
        minterNumMinted = ERC721.balanceOf(minter);
        currentTotalSupply = _totalSupply;
        _maxSupply = type(uint256).max;
    }

    modifier onlyAllowedSeaDrop(address seaDropImpl) {
        if (!_allowedSeaDrop[seaDropImpl]) revert OnlyAllowedSeaDrop();
        _;
    }

    function updatePublicDrop(address seaDropImpl, PublicDrop calldata publicDrop) external override onlyArtist onlyAllowedSeaDrop(seaDropImpl) {
        ISeaDrop(seaDropImpl).updatePublicDrop(publicDrop);
    }
    
    function updateAllowList(address seaDropImpl, AllowListData calldata allowListData) external override onlyArtist onlyAllowedSeaDrop(seaDropImpl) {
        ISeaDrop(seaDropImpl).updateAllowList(allowListData);
    }

    function updateTokenGatedDrop(address seaDropImpl, address allowedNftToken, TokenGatedDropStage calldata dropStage) external override onlyArtist onlyAllowedSeaDrop(seaDropImpl) {
        ISeaDrop(seaDropImpl).updateTokenGatedDrop(allowedNftToken, dropStage);
    }

    function updateDropURI(address seaDropImpl, string calldata dropURI) external override onlyArtist onlyAllowedSeaDrop(seaDropImpl) {
        ISeaDrop(seaDropImpl).updateDropURI(dropURI);
    }

    function updateCreatorPayoutAddress(address seaDropImpl, address payoutAddress) external override onlyArtist onlyAllowedSeaDrop(seaDropImpl) {
        ISeaDrop(seaDropImpl).updateCreatorPayoutAddress(payoutAddress);
    }

    function updateAllowedFeeRecipient(address seaDropImpl, address feeRecipient, bool allowed) external override onlyArtist onlyAllowedSeaDrop(seaDropImpl) {
        ISeaDrop(seaDropImpl).updateAllowedFeeRecipient(feeRecipient, allowed);
    }

    function updateSignedMintValidationParams(address seaDropImpl, address signer, SignedMintValidationParams memory params) external override onlyArtist onlyAllowedSeaDrop(seaDropImpl) {
        ISeaDrop(seaDropImpl).updateSignedMintValidationParams(signer, params);
    }

    function updatePayer(address seaDropImpl, address payer, bool allowed) external override onlyArtist onlyAllowedSeaDrop(seaDropImpl) {
        ISeaDrop(seaDropImpl).updatePayer(payer, allowed);
    }

    function setBaseURI(string calldata) external override { revert("Not supported"); }
    function setContractURI(string calldata) external override { revert("Not supported"); }
    function setMaxSupply(uint256) external override { revert("Not supported"); }
    function setProvenanceHash(bytes32) external override { revert("Not supported"); }
    function setRoyaltyInfo(RoyaltyInfo calldata) external override { revert("Not supported"); }
    function baseURI() external view override returns (string memory) { return ""; }
    function contractURI() external view override returns (string memory) { return ""; }
    function maxSupply() external view override returns (uint256) { return type(uint256).max; }
    function provenanceHash() external view override returns (bytes32) { return bytes32(0); }
    function royaltyAddress() external view override returns (address) { return address(0); }
    function royaltyBasisPoints() external view override returns (uint256) { return 0; }
    function royaltyInfo(uint256, uint256) external view override returns (address, uint256) { return (address(0), 0); }
    
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == type(INonFungibleSeaDropToken).interfaceId || super.supportsInterface(interfaceId);
    }

    // ─── Constructor (implementation lock only) ───────────────────────────────
    /// @dev Locks the implementation contract so it can never be initialized directly.
    ///      All real deployments happen via Ed4nsFactory clones + initialize().
    constructor() ERC721("", "") {
        _initialized = true; // prevent implementation from being used
    }

    // ─── Initializer (called once per clone) ─────────────────────────────────
    function initialize(GameConfig calldata config) external {
        if (_initialized) revert BadState();
        if (config.artist == address(0)) revert InvalidArgs();
        if (config.protocol == address(0)) revert InvalidArgs();
        if (config.mintCloseTime <= config.mintOpenTime) revert InvalidArgs();
        if (config.prizePoolSharePercent + config.artistSharePercent + config.protocolSharePercent != 100) revert InvalidArgs();

        _initialized = true;

        _tokenName   = config.name;
        _tokenSymbol = config.symbol;
        collectionDescription = config.description;
        artworkURI   = config.artworkURI;

        artist   = config.artist;
        protocol = config.protocol;
        mintPrice = config.mintPrice;
        mintOpenTime = config.mintOpenTime;
        mintCloseTime = config.mintCloseTime;
        minCutInterval = config.minCutInterval;

        prizePoolSharePercent = config.prizePoolSharePercent;
        artistSharePercent = config.artistSharePercent;
        protocolSharePercent = config.protocolSharePercent;

        collectionDescription = config.description;

        emit MintOpen(config.mintOpenTime, config.mintCloseTime, config.mintPrice);
    }

    // ─── ERC721 name/symbol overrides ────────────────────────────────────────
    function name() public view override returns (string memory) { return _tokenName; }
    function symbol() public view override returns (string memory) { return _tokenSymbol; }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 1 — Public Open Edition Minting
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice Publicly mint tokens during the open edition window.
    ///         Splits the payment: 45% prize pool, 45% artist, 10% protocol.
    receive() external payable {
        // Route incoming ETH (e.g. from SeaDrop) to prize pool, artist, and protocol
        if (msg.value == 0) return;
        uint256 poolShare = (msg.value * prizePoolSharePercent) / 100;
        uint256 artistShare = (msg.value * artistSharePercent) / 100;
        uint256 protocolShare = msg.value - poolShare - artistShare;

        prizePool += poolShare;

        (bool successArtist, ) = artist.call{value: artistShare}('\'\'');
        if (!successArtist) revert BadTx();

        (bool successProtocol, ) = protocol.call{value: protocolShare}('\'\'');
        if (!successProtocol) revert BadTx();
    }

    function mint(uint256 quantity) external payable {
        if (block.timestamp < mintOpenTime || block.timestamp > mintCloseTime) revert BadState();
        if (quantity == 0 || msg.value != mintPrice * quantity) revert InvalidArgs();

        uint256 startId = _totalSupply + 1;
        _totalSupply += quantity;

        for (uint256 i = 0; i < quantity; i++) {
            _mint(msg.sender, startId + i);
            emit TokenMinted(msg.sender, startId + i, mintPrice);
        }

        // Dynamic split
        uint256 poolShare = (msg.value * prizePoolSharePercent) / 100;
        uint256 artistShare = (msg.value * artistSharePercent) / 100;
        uint256 protocolShare = msg.value - poolShare - artistShare;

        prizePool += poolShare;

        (bool successArtist, ) = artist.call{value: artistShare}("");
        if (!successArtist) revert BadTx();

        (bool successProtocol, ) = protocol.call{value: protocolShare}("");
        if (!successProtocol) revert BadTx();
    }

    /// @notice Initialize the game after the mint concludes.
    function initializeGame() external onlyArtist {
        _initializeGame();
    }

    /// @notice Backwards compatible game initialization (starts the game phase).
    function initializeGame(uint256, uint256, string calldata /* ignored */) external onlyArtist {
        _initializeGame();
    }

    function _initializeGame() internal {
        if (gameInitialized) revert BadState();
        if (block.timestamp <= mintCloseTime && _totalSupply < 10) revert BadState();
        if (_totalSupply <= FINAL_SURVIVORS) revert BadState();

        gameInitialized = true;
        lastCutTimestamp = block.timestamp;

        emit GameInitialized(_totalSupply, artworkURI, prizePool);
        emit BatchMetadataUpdate(1, type(uint256).max);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Phase 2 — Future Blockhash Commit-Reveal Cuts (100% Free & On-Chain!)
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice Commit to a future blockhash to trigger the elimination round.
    function triggerCut() external {
        if (!gameInitialized || gameFinished || cutPending) revert BadState();
        if (block.timestamp < lastCutTimestamp + minCutInterval) revert BadState();
        if (_poolSizeAfterRounds(roundCount) <= FINAL_SURVIVORS) revert BadState();

        cutPending = true;
        revealBlock = uint64(block.number + 1);
        lastCutTimestamp = block.timestamp;

        emit CutCommitted(revealBlock, roundCount + 1);
    }

    /// @notice Reveal the cut results once the committed block has been mined.
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
        emit BatchMetadataUpdate(1, type(uint256).max);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Lazy Evaluation — Pure Mathematical Status Computation
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice Deterministically trace a token's index through active shuffles.
    function isTokenAlive(uint256 tokenId) public view returns (bool) {
        if (_totalSupply == 0) return false;
        if (tokenId < 1 || tokenId > _totalSupply) return false;

        uint256 index = tokenId - 1;
        uint256 poolSize = _totalSupply;

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

    /// @notice Returns which round a token was eliminated in (0 = alive).
    function eliminatedInRound(uint256 tokenId) public view returns (uint256) {
        if (_totalSupply == 0) return 0;
        if (tokenId < 1 || tokenId > _totalSupply) return 0;

        uint256 index = tokenId - 1;
        uint256 poolSize = _totalSupply;

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

    /// @notice Compute the survivors pool size after given rounds.
    function _poolSizeAfterRounds(uint256 rounds) internal view returns (uint256) {
        uint256 poolSize = _totalSupply;
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

    /// @notice Winning token holders claim their ETH payouts share.
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

    /// @notice Dynamic JSON tokenURI containing SVG borders and status attributes.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (tokenId == 0 || tokenId > _totalSupply) revert InvalidArgs();

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
            // Using 2vmin so the border scales perfectly with the viewport
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

        // Per-token elimination data
        uint256 elimRound = gameInitialized ? eliminatedInRound(tokenId) : 0;
        // survivedRounds = rounds the token survived (= roundCount for alive, elimRound-1 for eliminated)
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
        if (!cutPending || (block.number <= revealBlock + 256 && block.number <= revealBlock + 25)) revert BadState();
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
        // Allow withdrawal if the game finished naturally, OR if 30 days have passed since mint closed (failsafe)
        if (!gameFinished && block.timestamp < mintCloseTime + 30 days) revert BadState();
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool ok, ) = artist.call{value: balance}("");
            if (!ok) revert BadTx();
        }
    }

    // ─── View Helpers ────────────────────────────────────────────────────────

    function aliveCount() external view returns (uint256) {
        if (!gameInitialized) return 0;
        return _poolSizeAfterRounds(roundCount);
    }

    function totalSupply() public view returns (uint256) {
        return _totalSupply;
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
        return block.timestamp >= mintOpenTime && block.timestamp <= mintCloseTime;
    }
}
