// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Stand-in for a TIP-20 precompile, which only exists on Tempo nodes. It copies the
/// signatures, events and error names the RFQ touches, and a whitelist that checks both
/// sides of a transfer (and only the recipient of a mint), like TIP-403 does.
/// The real precompiles are exercised on Moderato by `pnpm chain:fill-test`.
interface IPolicyRegistry {
    function isAuthorized(uint64 policyId, address user) external view returns (bool);
}

contract MockTIP20 {
    string public name;
    string public symbol;
    // forge-lint: disable-next-line(screaming-snake-case-const)
    uint8 public constant decimals = 6; // name fixed by the TIP-20 interface
    uint256 public totalSupply;

    mapping(address account => uint256) public balanceOf;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    bool public whitelistOn;
    mapping(address account => bool) public whitelisted;

    /// When set, the token asks the TIP-403 registry instead of its own list, the way a
    /// real TIP-20 does. Left unset, the local list above answers.
    IPolicyRegistry public registry;
    uint64 public policyId;

    /// Set by the reserve monitor when the supply outgrows its backing. Nothing moves while
    /// it is true, which is what the technical demo shows.
    bool public paused;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo);
    event Burn(address indexed from, uint256 amount);
    event PauseStateUpdate(address indexed updater, bool isPaused);

    error InsufficientBalance(uint256 available, uint256 required, address token);
    error InsufficientAllowance();
    error PolicyForbids();
    error TokenPaused();

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    // Test controls.

    function mint(address to, uint256 amount) external {
        _running();
        _authorize(to);
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function pause() external {
        paused = true;
        emit PauseStateUpdate(msg.sender, true);
    }

    function unpause() external {
        paused = false;
        emit PauseStateUpdate(msg.sender, false);
    }

    function mintWithMemo(address to, uint256 amount, bytes32 memo) external {
        _running();
        _authorize(to);
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
        emit TransferWithMemo(address(0), to, amount, memo);
    }

    function setWhitelisted(address account, bool allowed) external {
        whitelisted[account] = allowed;
    }

    function setWhitelistOn(bool on) external {
        whitelistOn = on;
    }

    function setPolicy(address registry_, uint64 policyId_) external {
        registry = IPolicyRegistry(registry_);
        policyId = policyId_;
        whitelistOn = true;
    }

    // TIP-20 surface.

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spend(from, amount);
        _move(from, to, amount);
        return true;
    }

    function transferWithMemo(address to, uint256 amount, bytes32 memo) external {
        _move(msg.sender, to, amount);
        emit TransferWithMemo(msg.sender, to, amount, memo);
    }

    function transferFromWithMemo(address from, address to, uint256 amount, bytes32 memo)
        external
        returns (bool)
    {
        _spend(from, amount);
        _move(from, to, amount);
        emit TransferWithMemo(from, to, amount, memo);
        return true;
    }

    // Burns from the caller. The real token also requires ISSUER_ROLE.
    function burnWithMemo(uint256 amount, bytes32 memo) external {
        _running();
        uint256 available = balanceOf[msg.sender];
        if (available < amount) revert InsufficientBalance(available, amount, address(this));
        unchecked {
            balanceOf[msg.sender] = available - amount;
            totalSupply -= amount;
        }
        emit Transfer(msg.sender, address(0), amount);
        emit TransferWithMemo(msg.sender, address(0), amount, memo);
        emit Burn(msg.sender, amount);
    }

    function _spend(address from, uint256 amount) private {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
    }

    function _move(address from, address to, uint256 amount) private {
        _running();
        _authorize(from);
        _authorize(to);
        uint256 available = balanceOf[from];
        if (available < amount) revert InsufficientBalance(available, amount, address(this));
        unchecked {
            balanceOf[from] = available - amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _authorize(address account) private view {
        if (!whitelistOn) return;
        bool allowed =
            address(registry) == address(0) ? whitelisted[account] : registry.isAuthorized(policyId, account);
        if (!allowed) revert PolicyForbids();
    }

    function _running() private view {
        if (paused) revert TokenPaused();
    }
}
