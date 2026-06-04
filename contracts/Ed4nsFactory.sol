// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./ed4ns.sol";

/// @title  Ed4nsFactory — Clone factory for ed4ns survival games
/// @notice Deploys minimal EIP-1167 proxy clones of the ed4ns implementation.
///         The factory is tiny (~3KB) because it does NOT embed ed4ns bytecode.
///         Deploy ed4ns once as the implementation, then clone it cheaply per game.
contract Ed4nsFactory {

    // ─── State ───────────────────────────────────────────────────────────────
    address public owner;
    address payable public protocol;

    address public immutable implementation; // the master ed4ns contract

    uint256 public prizePoolSharePercent = 45;
    uint256 public artistSharePercent    = 45;
    uint256 public protocolSharePercent  = 10;

    address[] private _games;
    mapping(address => address[]) public gamesByArtist;

    // ─── Events ──────────────────────────────────────────────────────────────
    event GameDeployed(
        address indexed game,
        address indexed artist
    );
    event ProtocolUpdated(address indexed newProtocol);
    event FeeSplitsUpdated(uint256 prize, uint256 artist, uint256 protocol);
    event OwnershipTransferred(address indexed newOwner);

    // ─── Modifiers ───────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────
    /// @param _protocol  Wallet receiving the protocol share of every mint.
    constructor(address payable _protocol) {
        require(_protocol != address(0), "Invalid protocol");
        owner    = msg.sender;
        protocol = _protocol;

        // Deploy the implementation once — it is locked (initialized=true in its constructor)
        implementation = address(new ed4ns());
    }

    // ─── Protocol Management ─────────────────────────────────────────────────
    function setProtocol(address payable _protocol) external onlyOwner {
        require(_protocol != address(0), "Invalid address");
        protocol = _protocol;
        emit ProtocolUpdated(_protocol);
    }

    function setFeeSplits(uint256 _prize, uint256 _artist, uint256 _protocol) external onlyOwner {
        require(_prize + _artist + _protocol == 100, "Splits must sum to 100");
        prizePoolSharePercent = _prize;
        artistSharePercent    = _artist;
        protocolSharePercent  = _protocol;
        emit FeeSplitsUpdated(_prize, _artist, _protocol);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
        emit OwnershipTransferred(newOwner);
    }

    // ─── Deploy ──────────────────────────────────────────────────────────────
    struct DeployParams {
        string name;
        string symbol;
        string description;
        string artworkURI;
        uint256 mintPrice;
        uint256 mintOpenTime;
        uint256 mintCloseTime;
        uint256 minCutInterval;
    }

    /// @notice Clone the implementation and initialize a new game. Caller becomes the artist.
    function deployGame(DeployParams calldata params) external returns (address) {
        // Clone the implementation (EIP-1167 minimal proxy)
        address clone = Clones.clone(implementation);

        // Initialize the clone with caller as artist
        GameConfig memory config;
        config.name                 = params.name;
        config.symbol               = params.symbol;
        config.description          = params.description;
        config.artworkURI           = params.artworkURI;
        config.artist               = payable(msg.sender);
        config.protocol             = protocol;
        config.mintPrice            = params.mintPrice;
        config.mintOpenTime         = params.mintOpenTime;
        config.mintCloseTime        = params.mintCloseTime;
        config.minCutInterval       = params.minCutInterval;
        config.prizePoolSharePercent = prizePoolSharePercent;
        config.artistSharePercent   = artistSharePercent;
        config.protocolSharePercent = protocolSharePercent;

        ed4ns(clone).initialize(config);

        _games.push(clone);
        gamesByArtist[msg.sender].push(clone);

        emit GameDeployed(clone, msg.sender);

        return clone;
    }

    // ─── Registry Views ──────────────────────────────────────────────────────
    function gameCount() external view returns (uint256) { return _games.length; }
    function getGames() external view returns (address[] memory) { return _games; }

    function getGamesPaginated(uint256 offset, uint256 limit)
        external view returns (address[] memory page)
    {
        uint256 total = _games.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = _games[i];
        }
    }

    function getGamesByArtist(address artist) external view returns (address[] memory) {
        return gamesByArtist[artist];
    }
}
