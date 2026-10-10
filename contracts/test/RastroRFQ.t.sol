// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {RastroRFQ} from "../src/RastroRFQ.sol";
import {ITIP20} from "../src/interfaces/ITIP20.sol";
import {MockTIP20} from "./mocks/MockTIP20.sol";

contract RastroRFQTest is Test {
    uint256 internal constant MODERATO = 42431;
    bytes32 internal constant REF = "fatura-0047";
    uint256 internal constant START = 10_000e6;

    MockTIP20 internal usd;
    MockTIP20 internal brl;
    RastroRFQ internal rfq;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal payer = makeAddr("payer");
    address internal ana = makeAddr("ana");
    address internal stranger = makeAddr("stranger");
    address internal quoter;
    uint256 internal quoterKey;
    uint256 internal lastNonce;

    event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo);
    event Filled(
        bytes32 indexed quoteHash,
        address indexed payer,
        address indexed recipient,
        uint256 usdIn,
        uint256 brlOut,
        bytes32 invoiceRef
    );

    function setUp() public {
        vm.chainId(MODERATO);
        vm.warp(1_791_000_000);
        (quoter, quoterKey) = makeAddrAndKey("quoter");

        usd = new MockTIP20("pathUSD", "pathUSD");
        brl = new MockTIP20("Real Rastro (teste)", "tBRL");
        rfq = new RastroRFQ(admin, quoter, treasury, ITIP20(address(usd)), ITIP20(address(brl)));

        // tBRL runs on a whitelist, as it does on Moderato.
        brl.setWhitelisted(treasury, true);
        brl.setWhitelisted(address(rfq), true);
        brl.setWhitelisted(ana, true);
        brl.setWhitelistOn(true);

        usd.mint(payer, START);
        brl.mint(address(rfq), START);
        vm.prank(payer);
        usd.approve(address(rfq), type(uint256).max);
    }

    // Happy path

    function test_fill_happyPath() public {
        RastroRFQ.Quote memory q = _quote(1_540e6, 8_182.41e6);
        bytes memory sig = _sign(quoterKey, q);
        bytes32 quoteHash = rfq.hashQuote(q);

        vm.expectEmit(true, true, true, true, address(usd));
        emit TransferWithMemo(payer, treasury, q.usdIn, REF);
        vm.expectEmit(true, true, true, true, address(brl));
        emit TransferWithMemo(address(rfq), ana, q.brlOut, REF);
        vm.expectEmit(true, true, true, true, address(rfq));
        emit Filled(quoteHash, payer, ana, q.usdIn, q.brlOut, REF);

        _fill(q, sig);

        assertEq(usd.balanceOf(treasury), q.usdIn);
        assertEq(usd.balanceOf(payer), START - q.usdIn);
        assertEq(brl.balanceOf(ana), q.brlOut);
        assertEq(brl.balanceOf(address(rfq)), START - q.brlOut);
        assertTrue(rfq.nonceUsed(q.nonce));
    }

    function test_fill_onTheExpirySecond() public {
        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        bytes memory sig = _sign(quoterKey, q);
        vm.warp(q.expiry);
        _fill(q, sig);
        assertEq(brl.balanceOf(ana), q.brlOut);
    }

    // Rules of fill, in the order the contract checks them

    function test_revert_paused() public {
        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        bytes memory sig = _sign(quoterKey, q);

        vm.prank(admin);
        rfq.pause();
        vm.prank(payer);
        vm.expectRevert(RastroRFQ.IsPaused.selector);
        rfq.fill(q, sig);

        vm.prank(admin);
        rfq.unpause();
        _fill(q, sig);
        assertEq(brl.balanceOf(ana), q.brlOut);
    }

    function test_revert_expired() public {
        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        bytes memory sig = _sign(quoterKey, q);
        vm.warp(q.expiry + 1);
        vm.prank(payer);
        vm.expectRevert(RastroRFQ.Expired.selector);
        rfq.fill(q, sig);
    }

    function test_revert_notPayer() public {
        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        bytes memory sig = _sign(quoterKey, q);
        vm.prank(stranger);
        vm.expectRevert(RastroRFQ.NotPayer.selector);
        rfq.fill(q, sig);
    }

    function test_revert_replay() public {
        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        bytes memory sig = _sign(quoterKey, q);
        _fill(q, sig);
        vm.prank(payer);
        vm.expectRevert(RastroRFQ.NonceUsed.selector);
        rfq.fill(q, sig);
    }

    function test_revert_wrongSigner() public {
        (, uint256 otherKey) = makeAddrAndKey("not-the-quoter");
        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        bytes memory sig = _sign(otherKey, q);
        vm.prank(payer);
        vm.expectRevert(RastroRFQ.BadSignature.selector);
        rfq.fill(q, sig);
    }

    function test_revert_payerRaisesTheirOwnPayout() public {
        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        bytes memory sig = _sign(quoterKey, q);
        q.brlOut += 1e6;
        vm.prank(payer);
        vm.expectRevert(RastroRFQ.BadSignature.selector);
        rfq.fill(q, sig);
    }

    function test_revert_payerSwapsTheRecipient() public {
        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        bytes memory sig = _sign(quoterKey, q);
        q.recipient = treasury;
        vm.prank(payer);
        vm.expectRevert(RastroRFQ.BadSignature.selector);
        rfq.fill(q, sig);
    }

    function test_revert_malformedSignature() public {
        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        vm.prank(payer);
        vm.expectRevert(RastroRFQ.BadSignature.selector);
        rfq.fill(q, hex"1234");
    }

    // The token's policy, not the RFQ, keeps tBRL away from unknown wallets

    function test_revert_recipientOutsideThePolicy() public {
        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        q.recipient = stranger;
        bytes memory sig = _sign(quoterKey, q);

        vm.prank(payer);
        vm.expectRevert(MockTIP20.PolicyForbids.selector);
        rfq.fill(q, sig);

        // All or nothing: the payer keeps the dollars and the quote can still be used.
        assertEq(usd.balanceOf(payer), START);
        assertFalse(rfq.nonceUsed(q.nonce));
    }

    function test_revert_withoutAllowance() public {
        vm.prank(payer);
        usd.approve(address(rfq), 0);
        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        bytes memory sig = _sign(quoterKey, q);
        vm.prank(payer);
        vm.expectRevert(MockTIP20.InsufficientAllowance.selector);
        rfq.fill(q, sig);
    }

    // Admin

    function test_onlyAdmin() public {
        vm.startPrank(stranger);
        vm.expectRevert(RastroRFQ.NotAdmin.selector);
        rfq.setQuoter(stranger);
        vm.expectRevert(RastroRFQ.NotAdmin.selector);
        rfq.setTreasury(stranger);
        vm.expectRevert(RastroRFQ.NotAdmin.selector);
        rfq.pause();
        vm.expectRevert(RastroRFQ.NotAdmin.selector);
        rfq.unpause();
        vm.expectRevert(RastroRFQ.NotAdmin.selector);
        rfq.sweep(1);
        vm.stopPrank();
    }

    function test_setQuoter_retiresTheOldKey() public {
        (address newQuoter, uint256 newKey) = makeAddrAndKey("new-quoter");
        vm.prank(admin);
        rfq.setQuoter(newQuoter);

        RastroRFQ.Quote memory q = _quote(100e6, 530e6);
        bytes memory oldSig = _sign(quoterKey, q);
        vm.prank(payer);
        vm.expectRevert(RastroRFQ.BadSignature.selector);
        rfq.fill(q, oldSig);

        _fill(q, _sign(newKey, q));
        assertEq(brl.balanceOf(ana), q.brlOut);
    }

    function test_sweep_returnsInventoryEvenWhenPaused() public {
        bytes32 sweepMemo = rfq.SWEEP_MEMO();
        vm.startPrank(admin);
        rfq.pause();
        vm.expectEmit(true, true, true, true, address(brl));
        emit TransferWithMemo(address(rfq), treasury, 2_500e6, sweepMemo);
        rfq.sweep(2_500e6);
        vm.stopPrank();

        assertEq(brl.balanceOf(treasury), 2_500e6);
        assertEq(brl.balanceOf(address(rfq)), START - 2_500e6);
    }

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(RastroRFQ.ZeroAddress.selector);
        new RastroRFQ(admin, address(0), treasury, ITIP20(address(usd)), ITIP20(address(brl)));
        vm.expectRevert(RastroRFQ.ZeroAddress.selector);
        new RastroRFQ(admin, quoter, address(0), ITIP20(address(usd)), ITIP20(address(brl)));
        vm.expectRevert(RastroRFQ.ZeroAddress.selector);
        new RastroRFQ(address(0), quoter, treasury, ITIP20(address(usd)), ITIP20(address(brl)));
    }

    // The TypeScript signer and this contract must agree byte for byte. The digest below
    // comes from viem's hashTypedData; packages/chain/src/quote.test.ts pins the same value.
    function test_hashQuote_matchesViem() public {
        address at = 0x1111111111111111111111111111111111111111;
        deployCodeTo(
            "RastroRFQ.sol:RastroRFQ", abi.encode(admin, quoter, treasury, address(usd), address(brl)), at
        );
        RastroRFQ.Quote memory q = RastroRFQ.Quote({
            payer: 0x2222222222222222222222222222222222222222,
            recipient: 0x3333333333333333333333333333333333333333,
            usdIn: 1_540e6,
            brlOut: 8_182.41e6,
            invoiceRef: REF,
            expiry: 1_791_000_000,
            nonce: 47
        });
        assertEq(
            RastroRFQ(at).QUOTE_TYPEHASH(), 0x08bf1fec71eceaeec63a28346c75996a1e20ca52f5699b0609a65f658c3eb89a
        );
        assertEq(
            RastroRFQ(at).hashQuote(q), 0x19df3580515d64050eae38698a028ce959cea517d0d4a4452eaf3a4fd7764c61
        );
    }

    // Fuzz

    function testFuzz_amounts(uint256 usdIn, uint256 brlOut) public {
        usdIn = bound(usdIn, 0, START);
        brlOut = bound(brlOut, 0, START);
        RastroRFQ.Quote memory q = _quote(usdIn, brlOut);
        _fill(q, _sign(quoterKey, q));

        assertEq(usd.balanceOf(payer) + usd.balanceOf(treasury), START);
        assertEq(brl.balanceOf(ana) + brl.balanceOf(address(rfq)), START);
        assertEq(usd.balanceOf(treasury), usdIn);
        assertEq(brl.balanceOf(ana), brlOut);
    }

    // Helpers

    function _quote(uint256 usdIn, uint256 brlOut) internal returns (RastroRFQ.Quote memory) {
        return RastroRFQ.Quote({
            payer: payer,
            recipient: ana,
            usdIn: usdIn,
            brlOut: brlOut,
            invoiceRef: REF,
            expiry: uint64(block.timestamp + 30),
            nonce: ++lastNonce
        });
    }

    function _sign(uint256 key, RastroRFQ.Quote memory q) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, rfq.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }

    function _fill(RastroRFQ.Quote memory q, bytes memory sig) internal {
        vm.prank(q.payer);
        rfq.fill(q, sig);
    }
}
