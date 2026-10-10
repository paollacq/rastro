// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// TIP-403 policy registry precompile, trimmed. A whitelist policy checks both
/// sides of a transfer, so contracts that hold or move the token (the RFQ, the
/// treasury) have to be on the list too.
interface ITIP403Registry {
    event PolicyCreated(uint64 indexed policyId, address indexed updater, uint8 policyType);
    event WhitelistUpdated(
        uint64 indexed policyId, address indexed updater, address indexed account, bool allowed
    );

    function policyIdCounter() external view returns (uint64);
    function policyExists(uint64 policyId) external view returns (bool);
    function policyData(uint64 policyId) external view returns (uint8 policyType, address admin);
    function isAuthorized(uint64 policyId, address user) external view returns (bool);

    function createPolicy(address admin, uint8 policyType) external returns (uint64);
    function createPolicyWithAccounts(address admin, uint8 policyType, address[] calldata accounts)
        external
        returns (uint64);
    function modifyPolicyWhitelist(uint64 policyId, address account, bool allowed) external;
    function setPolicyAdmin(uint64 policyId, address admin) external;
}
