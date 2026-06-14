// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockERC721CreatorCore {
    mapping(uint256 => address) private _owners;
    address public extension;

    function setExtension(address ext) external {
        extension = ext;
    }

    function setOwnerOf(uint256 tokenId, address owner) external {
        _owners[tokenId] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "ERC721: invalid token ID");
        return owner;
    }
}
