// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title TimelockGift
/// @notice "Gift a basket": a giver buys a basket through the normal StaxExecutor path,
/// then parks the bought tokens here until an unlock date, addressed to a *hash* of the
/// recipient's email. No address is needed at gift time — the recipient may not have a
/// wallet yet, and their email must never touch the chain.
///
/// Three ways out, and only three:
///   claim(...)    after `unlockAt`, to any address the Stax server attests. The attestation
///                 is an EIP-712 `Claim` signature by `signer`: the server signs it only once
///                 it has checked, against the Privy user record, that the caller owns the
///                 email this gift was addressed to. Anyone may submit the transaction (the
///                 recipient's sponsored user op does), the signature is the authority.
///   reclaim(...)  after `reclaimAfter`, by the giver, when nobody ever claimed.
///   nothing else. The owner cannot move a parked gift.
///
/// `recipientHash` is recorded for the giver's own audit trail and for indexers; the
/// contract never checks it, because only the server can link an email to a person.
contract TimelockGift is EIP712, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct Gift {
        address from; // the giver; the only address that may reclaim
        bytes32 recipientHash; // hash of the recipient's email + a per-gift salt (server-side)
        uint64 unlockAt; // claimable from this timestamp
        uint64 reclaimAfter; // giver may take it back from this timestamp
        bool claimed; // set once, on the way out
        address[] tokens; // what was parked
        uint256[] amounts; // how much of each, raw units
        string note; // the giver's message, <= NOTE_MAX_BYTES bytes
    }

    /// @dev Claim(bytes32 giftId,address to,uint256 deadline) — what the Stax server signs.
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(bytes32 giftId,address to,uint256 deadline)");

    /// @dev A note is shown verbatim in the app; bound it so a gift can never be made
    /// unclaimable by an unbounded copy into memory.
    uint256 public constant NOTE_MAX_BYTES = 200;

    /// @dev The Stax server key that attests "this signed-in user owns the recipient email".
    address public signer;

    mapping(bytes32 => Gift) private _gifts;

    event SignerUpdated(address indexed signer);
    event GiftCreated(
        bytes32 indexed giftId,
        address indexed from,
        bytes32 indexed recipientHash,
        uint64 unlockAt,
        uint64 reclaimAfter,
        uint256 tokenCount
    );
    event GiftClaimed(bytes32 indexed giftId, address indexed to, uint256 tokenCount);
    event GiftReclaimed(bytes32 indexed giftId, address indexed from, uint256 tokenCount);

    error GiftExists(bytes32 giftId);
    error GiftUnknown(bytes32 giftId);
    error NoTokens();
    error LengthMismatch(uint256 tokens, uint256 amounts);
    error ZeroAmount(uint256 index);
    error ZeroToken(uint256 index);
    error UnlockInPast(uint64 unlockAt);
    error ReclaimBeforeUnlock(uint64 unlockAt, uint64 reclaimAfter);
    error NoteTooLong(uint256 length);
    error NotYetUnlocked(uint64 unlockAt);
    error AlreadyClaimed();
    error AuthorisationExpired(uint256 deadline);
    error SignerNotSet();
    error BadSigner(address recovered);
    error ZeroRecipient();
    error NotYetReclaimable(uint64 reclaimAfter);
    error NotGiver(address from);

    constructor(address _signer) EIP712("StaxGift", "1") Ownable(msg.sender) {
        signer = _signer;
        emit SignerUpdated(_signer);
    }

    // ---------------- admin ----------------

    /// @notice Point the contract at the Stax attestation key. Rotating it invalidates every
    /// claim authorisation the old key signed; unclaimed gifts are unaffected otherwise.
    function setSigner(address _signer) external onlyOwner {
        signer = _signer;
        emit SignerUpdated(_signer);
    }

    // ---------------- give ----------------

    /// @notice Park `tokens`/`amounts` for whoever proves ownership of `recipientHash`'s email.
    /// The caller must have approved this contract for every amount — batchable with the
    /// approvals in a single ERC-4337 UserOp, so the giver sees one gasless confirmation.
    ///
    /// @dev NEVER park a rebasing or fee-on-transfer token. Amounts here are RECORDED, not
    /// measured: `claim` and `reclaim` pay back exactly what was written down, never the live
    /// balance. A rebasing token's yield over a hold of up to 25 years would therefore be
    /// stranded here with no way out, and a fee-on-transfer token would pay out more than
    /// arrived. Stax parks the Aave "Safe Dollars" slice as plain USDC for this reason (see
    /// `splitGiftBasket` in web/src/lib/gifts.ts and docs/GIFTS.md). Measuring by balance
    /// delta would not fix it either: one balance is shared by every gift, so per-gift
    /// yield cannot be attributed without scaled-balance accounting.
    /// @param giftId Server-generated random 32 bytes; also the row id in the Stax database.
    /// @param recipientHash Hash of the recipient's email plus a per-gift salt. Never an email.
    /// @param unlockAt When the gift becomes claimable. Must be in the future.
    /// @param reclaimAfter When the giver may take it back. Must be after `unlockAt`.
    /// @param note The giver's message, shown to the recipient. At most NOTE_MAX_BYTES bytes.
    function create(
        bytes32 giftId,
        bytes32 recipientHash,
        uint64 unlockAt,
        uint64 reclaimAfter,
        address[] calldata tokens,
        uint256[] calldata amounts,
        string calldata note
    ) external nonReentrant {
        if (_gifts[giftId].from != address(0)) revert GiftExists(giftId);
        if (tokens.length == 0) revert NoTokens();
        if (tokens.length != amounts.length) revert LengthMismatch(tokens.length, amounts.length);
        if (unlockAt <= block.timestamp) revert UnlockInPast(unlockAt);
        if (reclaimAfter <= unlockAt) revert ReclaimBeforeUnlock(unlockAt, reclaimAfter);
        if (bytes(note).length > NOTE_MAX_BYTES) revert NoteTooLong(bytes(note).length);

        Gift storage g = _gifts[giftId];
        g.from = msg.sender;
        g.recipientHash = recipientHash;
        g.unlockAt = unlockAt;
        g.reclaimAfter = reclaimAfter;
        g.note = note;

        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i] == address(0)) revert ZeroToken(i);
            if (amounts[i] == 0) revert ZeroAmount(i);
            // Record the amount we asked for. Fee-on-transfer tokens are not in the Stax
            // asset set; if one is ever added, the parked amount must be measured by balance
            // delta instead (and `claim` would then hand out more than the contract holds).
            g.tokens.push(tokens[i]);
            g.amounts.push(amounts[i]);
            IERC20(tokens[i]).safeTransferFrom(msg.sender, address(this), amounts[i]);
        }

        emit GiftCreated(giftId, msg.sender, recipientHash, unlockAt, reclaimAfter, tokens.length);
    }

    // ---------------- claim ----------------

    /// @notice Move an unlocked gift to `to`. Callable by anyone: the EIP-712 signature from
    /// the Stax `signer` over (giftId, to, deadline) is what authorises the move, because only
    /// the server can decide whether the person asking owns the recipient's email. `deadline`
    /// keeps an attestation short-lived, so a leaked one cannot be replayed a month later.
    function claim(bytes32 giftId, address to, uint256 deadline, bytes calldata signature) external nonReentrant {
        Gift storage g = _gifts[giftId];
        if (g.from == address(0)) revert GiftUnknown(giftId);
        if (g.claimed) revert AlreadyClaimed();
        if (block.timestamp < g.unlockAt) revert NotYetUnlocked(g.unlockAt);
        if (block.timestamp > deadline) revert AuthorisationExpired(deadline);
        if (to == address(0)) revert ZeroRecipient();

        address expected = signer;
        if (expected == address(0)) revert SignerNotSet();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, giftId, to, deadline)));
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != expected) revert BadSigner(recovered);

        g.claimed = true; // set before any transfer — a second claim can never start
        uint256 n = g.tokens.length;
        for (uint256 i; i < n; ++i) {
            IERC20(g.tokens[i]).safeTransfer(to, g.amounts[i]);
        }

        emit GiftClaimed(giftId, to, n);
    }

    // ---------------- reclaim ----------------

    /// @notice Return an unclaimed gift to the giver once the grace period has passed.
    /// Nothing is ever stranded: a recipient who never signs up leaves the tokens recoverable.
    function reclaim(bytes32 giftId) external nonReentrant {
        Gift storage g = _gifts[giftId];
        if (g.from == address(0)) revert GiftUnknown(giftId);
        if (g.claimed) revert AlreadyClaimed();
        if (msg.sender != g.from) revert NotGiver(g.from);
        if (block.timestamp < g.reclaimAfter) revert NotYetReclaimable(g.reclaimAfter);

        g.claimed = true; // one way out, whichever it is
        uint256 n = g.tokens.length;
        for (uint256 i; i < n; ++i) {
            IERC20(g.tokens[i]).safeTransfer(g.from, g.amounts[i]);
        }

        emit GiftReclaimed(giftId, g.from, n);
    }

    // ---------------- views ----------------

    /// @notice The whole gift, tokens and amounts included. An unknown id reads back zeroed
    /// (`from == address(0)`), which is how the Stax server tells "not funded yet" from "funded".
    function getGift(bytes32 giftId) external view returns (Gift memory) {
        return _gifts[giftId];
    }

    /// @notice True when the gift exists, is unclaimed, and its unlock date has passed.
    function isClaimable(bytes32 giftId) external view returns (bool) {
        Gift storage g = _gifts[giftId];
        return g.from != address(0) && !g.claimed && block.timestamp >= g.unlockAt;
    }
}
