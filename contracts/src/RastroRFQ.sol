// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ITIP20} from "./interfaces/ITIP20.sol";

/// @title RastroRFQ
/// @notice pathUSD in, tBRL out, at a price Rastro's quoter signed a few seconds earlier.
/// Tempo's stablecoin DEX doesn't pair different currencies yet, so this contract is the
/// bridge between them. Both legs carry the invoice reference as their TIP-20 memo, which
/// is what lets anyone match the dollar payment to the real payout on the explorer.
contract RastroRFQ is EIP712 {
    struct Quote {
        address payer; // pays in pathUSD and is the only one who can fill
        address recipient; // must pass tBRL's TIP-403 policy, or the tBRL leg reverts
        uint256 usdIn; // pathUSD base units (6 decimals)
        uint256 brlOut; // tBRL base units (6 decimals)
        bytes32 invoiceRef; // memo on both legs
        uint64 expiry; // unix seconds; the backend uses now + 30
        uint256 nonce; // random, single use
    }

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(address payer,address recipient,uint256 usdIn,uint256 brlOut,bytes32 invoiceRef,uint64 expiry,uint256 nonce)"
    );
    bytes32 public constant SWEEP_MEMO = "rastro:sweep";

    ITIP20 public immutable usd;
    ITIP20 public immutable brl;
    address public immutable admin;

    address public quoter;
    address public treasury;
    bool public paused;
    mapping(uint256 nonce => bool used) public nonceUsed;

    event Filled(
        bytes32 indexed quoteHash,
        address indexed payer,
        address indexed recipient,
        uint256 usdIn,
        uint256 brlOut,
        bytes32 invoiceRef
    );
    event QuoterSet(address quoter);
    event TreasurySet(address treasury);
    event Paused(address by);
    event Unpaused(address by);
    event Swept(address to, uint256 amount);

    error Expired();
    error BadSignature();
    error NonceUsed();
    error NotPayer();
    error IsPaused();
    error NotAdmin();
    error ZeroAddress();
    error TransferFailed();

    modifier onlyAdmin() {
        _checkAdmin();
        _;
    }

    constructor(address admin_, address quoter_, address treasury_, ITIP20 usd_, ITIP20 brl_)
        EIP712("RastroRFQ", "1")
    {
        if (admin_ == address(0) || address(usd_) == address(0) || address(brl_) == address(0)) {
            revert ZeroAddress();
        }
        admin = admin_;
        usd = usd_;
        brl = brl_;
        _setQuoter(quoter_);
        _setTreasury(treasury_);
    }

    /// @notice Executes a signed quote. The payer needs a pathUSD allowance of at least `usdIn`;
    /// in a Tempo transaction the approve and the fill go in one batch, under one signature.
    function fill(Quote calldata q, bytes calldata sig) external {
        if (paused) revert IsPaused();
        if (block.timestamp > q.expiry) revert Expired();
        if (msg.sender != q.payer) revert NotPayer();
        if (nonceUsed[q.nonce]) revert NonceUsed();

        bytes32 quoteHash = hashQuote(q);
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(quoteHash, sig);
        if (err != ECDSA.RecoverError.NoError || signer != quoter) revert BadSignature();

        // Burn the nonce before moving anything.
        nonceUsed[q.nonce] = true;

        if (!usd.transferFromWithMemo(q.payer, treasury, q.usdIn, q.invoiceRef)) revert TransferFailed();
        brl.transferWithMemo(q.recipient, q.brlOut, q.invoiceRef);

        emit Filled(quoteHash, q.payer, q.recipient, q.usdIn, q.brlOut, q.invoiceRef);
    }

    /// @notice The EIP-712 digest the quoter signs. Public so the backend can check its own work.
    function hashQuote(Quote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    QUOTE_TYPEHASH, q.payer, q.recipient, q.usdIn, q.brlOut, q.invoiceRef, q.expiry, q.nonce
                )
            )
        );
    }

    function setQuoter(address quoter_) external onlyAdmin {
        _setQuoter(quoter_);
    }

    function setTreasury(address treasury_) external onlyAdmin {
        _setTreasury(treasury_);
    }

    function pause() external onlyAdmin {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Sends tBRL inventory back to the treasury. Works while paused, so it is also the way out.
    function sweep(uint256 amount) external onlyAdmin {
        brl.transferWithMemo(treasury, amount, SWEEP_MEMO);
        emit Swept(treasury, amount);
    }

    function _checkAdmin() private view {
        if (msg.sender != admin) revert NotAdmin();
    }

    function _setQuoter(address quoter_) private {
        if (quoter_ == address(0)) revert ZeroAddress();
        quoter = quoter_;
        emit QuoterSet(quoter_);
    }

    function _setTreasury(address treasury_) private {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }
}
