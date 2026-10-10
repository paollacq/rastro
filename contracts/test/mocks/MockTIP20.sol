// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Stand-in for a TIP-20 precompile, which only exists on Tempo nodes. It copies the
/// signatures, events and error names the RFQ touches, and a whitelist that checks both
/// sides of a transfer (and only the recipient of a mint), like TIP-403 does.
/// The real precompiles are exercised on Moderato by `pnpm chain:fill-test`.
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

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo);

    error InsufficientBalance(uint256 available, uint256 required, address token);
    error InsufficientAllowance();
    error PolicyForbids();

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    // Test controls.

    function mint(address to, uint256 amount) external {
        _authorize(to);
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setWhitelisted(address account, bool allowed) external {
        whitelisted[account] = allowed;
    }

    function setWhitelistOn(bool on) external {
        whitelistOn = on;
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

    function _spend(address from, uint256 amount) private {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
    }

    function _move(address from, address to, uint256 amount) private {
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
        if (whitelistOn && !whitelisted[account]) revert PolicyForbids();
    }
}
