// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// TIP-20 precompile, trimmed to what Rastro calls.
/// Signatures match the ABI that ships with viem/tempo (Abis.tip20).
interface ITIP20 {
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo);
    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external pure returns (uint8);
    function currency() external view returns (string memory);
    function quoteToken() external view returns (address);
    function totalSupply() external view returns (uint256);
    function supplyCap() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function paused() external view returns (bool);
    function transferPolicyId() external view returns (uint64);

    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    // Unlike transfer, transferWithMemo returns nothing.
    function transferWithMemo(address to, uint256 amount, bytes32 memo) external;
    function transferFromWithMemo(address from, address to, uint256 amount, bytes32 memo)
        external
        returns (bool);

    function mintWithMemo(address to, uint256 amount, bytes32 memo) external;
    function burnWithMemo(uint256 amount, bytes32 memo) external;

    function changeTransferPolicyId(uint64 newPolicyId) external;
    function setSupplyCap(uint256 newSupplyCap) external;
    function pause() external;
    function unpause() external;

    function ISSUER_ROLE() external view returns (bytes32);
    function PAUSE_ROLE() external view returns (bytes32);
    function UNPAUSE_ROLE() external view returns (bytes32);

    // Account first, role second: the reverse of OpenZeppelin's hasRole.
    function hasRole(address account, bytes32 role) external view returns (bool);
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
}
