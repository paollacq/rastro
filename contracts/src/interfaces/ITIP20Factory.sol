// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// TIP-20 factory precompile. The token's currency is fixed at creation and
/// the transfer policy is not: new tokens start on policy 1 (everyone allowed)
/// until the admin calls changeTransferPolicyId.
interface ITIP20Factory {
    event TokenCreated(
        address indexed token,
        string name,
        string symbol,
        string currency,
        address quoteToken,
        address admin,
        bytes32 salt
    );

    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata currency,
        address quoteToken,
        address admin,
        bytes32 salt
    ) external returns (address);

    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata currency,
        address quoteToken,
        address admin,
        bytes32 salt,
        string calldata logoURI
    ) external returns (address);

    function getTokenAddress(address sender, bytes32 salt) external pure returns (address);
    // forge-lint: disable-next-line(mixed-case-function)
    function isTIP20(address token) external view returns (bool); // name fixed by the precompile
}
