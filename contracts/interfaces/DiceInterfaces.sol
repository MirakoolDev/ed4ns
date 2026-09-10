// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

abstract contract IEntropyConsumer {
    error EntropyErrorUnauthorizedCaller();

    /// @notice This method is called by the Entropy contract when a random number is generated.
    /// @param sequenceNumber The sequence number of the request.
    /// @param provider The address of the provider that generated the random number.
    /// @param randomNumber The generated random number.
    function entropyCallback(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) internal virtual;

    /// @notice This method is called by the Entropy contract to deliver the random number.
    /// It should revert if the caller is not the Entropy contract.
    function _entropyCallback(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) external {
        if (msg.sender != getEntropy()) revert EntropyErrorUnauthorizedCaller();
        entropyCallback(sequenceNumber, provider, randomNumber);
    }

    /// @notice Returns the address of the Entropy contract.
    function getEntropy() internal view virtual returns (address);
}

interface IEntropy {
    function requestV2(
        address provider,
        bytes32 userRandomNumber,
        uint32 gasLimit
    ) external payable returns (uint64 sequenceNumber);

    function getFee(address provider) external view returns (uint256 fee);
    function getFeeV2(address provider, uint32 gasLimit) external view returns (uint128 feeAmount);
}
