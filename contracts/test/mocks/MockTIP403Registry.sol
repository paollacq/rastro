// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Stand-in for the TIP-403 registry precompile, for a local chain: the end-to-end test puts
/// its runtime code at the registry's address with anvil_setCode. Only what the screens read
/// is here: whitelist changes, with the registry's own event, and isAuthorized.
contract MockTIP403Registry {
    mapping(uint64 policyId => mapping(address account => bool)) private whitelisted;

    event WhitelistUpdated(
        uint64 indexed policyId, address indexed updater, address indexed account, bool allowed
    );

    function modifyPolicyWhitelist(uint64 policyId, address account, bool allowed) external {
        whitelisted[policyId][account] = allowed;
        emit WhitelistUpdated(policyId, msg.sender, account, allowed);
    }

    function isAuthorized(uint64 policyId, address user) external view returns (bool) {
        return whitelisted[policyId][user];
    }
}
