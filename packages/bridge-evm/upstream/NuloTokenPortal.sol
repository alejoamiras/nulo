// NuloTokenPortal — a minimal SECURITY FORK of the canonical Aztec TokenPortal
// (packages/bridge-evm/upstream/TokenPortal.sol). It adds ONLY an init-once guard to close
// audit finding F-001: the canonical `initialize` has no access control and no guard, so anyone
// can re-call it on a deployed portal and repoint underlying/l2Bridge/registry (→ drain the held
// reserves / redirect deposits). Everything else — imports, storage layout, public getters, and the
// content-hash-critical `depositToAztec*` / `withdraw` bodies — is BYTE-IDENTICAL to canonical so the
// L1↔L2 content hashes do NOT drift (a drift would strand every deposit; pinned by ContentHash.t.sol
// + the Noir keystone). Compiled/deployed/Etherscan-verified from the l1-contracts root (real @aztec
// interfaces resolve there); the in-project forge regression test uses NuloTokenPortalShim instead.
pragma solidity >=0.8.27;

import {IERC20} from "@oz/token/ERC20/IERC20.sol";
import {SafeERC20} from "@oz/token/ERC20/utils/SafeERC20.sol";

// Messaging
import {IRegistry} from "@aztec/governance/interfaces/IRegistry.sol";
import {IInbox} from "@aztec/core/interfaces/messagebridge/IInbox.sol";
import {IOutbox} from "@aztec/core/interfaces/messagebridge/IOutbox.sol";
import {IRollup} from "@aztec/core/interfaces/IRollup.sol";
import {Epoch} from "@aztec/core/libraries/TimeLib.sol";
import {DataStructures} from "@aztec/core/libraries/DataStructures.sol";
import {Hash} from "@aztec/core/libraries/crypto/Hash.sol";

contract NuloTokenPortal {
  using SafeERC20 for IERC20;

  /// @notice F-001 fork: thrown if `initialize` is called more than once.
  error AlreadyInitialized();

  event DepositToAztecPublic(bytes32 to, uint256 amount, bytes32 secretHash, bytes32 key, uint256 index);

  event DepositToAztecPrivate(uint256 amount, bytes32 secretHashForL2MessageConsumption, bytes32 key, uint256 index);

  IRegistry public registry;
  IERC20 public underlying;
  bytes32 public l2Bridge;

  IRollup public rollup;
  IOutbox public outbox;
  IInbox public inbox;
  uint256 public rollupVersion;

  /**
   * @notice Initialize the portal
   * @param _registry - The registry address
   * @param _underlying - The underlying token address
   * @param _l2Bridge - The L2 bridge address
   */
  function initialize(address _registry, address _underlying, bytes32 _l2Bridge) external {
    // F-001: init-once. `registry` is the zero address only before the first initialize; any
    // later call reverts, so a deployed portal can never be repointed.
    if (address(registry) != address(0)) revert AlreadyInitialized();

    registry = IRegistry(_registry);
    underlying = IERC20(_underlying);
    l2Bridge = _l2Bridge;

    rollup = IRollup(address(registry.getCanonicalRollup()));
    outbox = rollup.getOutbox();
    inbox = rollup.getInbox();
    rollupVersion = rollup.getVersion();
  }

  // docs:start:deposit_public
  /**
   * @notice Deposit funds into the portal and adds an L2 message which can only be consumed publicly on Aztec
   * @param _to - The aztec address of the recipient
   * @param _amount - The amount to deposit
   * @param _secretHash - The hash of the secret consumable message. The hash should be 254 bits (so it can fit in a
   * Field element)
   * @return The key of the entry in the Inbox and its leaf index
   */
  function depositToAztecPublic(bytes32 _to, uint256 _amount, bytes32 _secretHash)
    external
    returns (bytes32, uint256)
  // docs:end:deposit_public
  {
    // Preamble
    DataStructures.L2Actor memory actor = DataStructures.L2Actor(l2Bridge, rollupVersion);

    // Hash the message content to be reconstructed in the receiving contract
    // The purpose of including the function selector is to make the message unique to that specific call. Note that
    // it has nothing to do with calling the function.
    bytes32 contentHash = Hash.sha256ToField(abi.encodeWithSignature("mint_to_public(bytes32,uint256)", _to, _amount));

    // Hold the tokens in the portal
    underlying.safeTransferFrom(msg.sender, address(this), _amount);

    // Send message to rollup
    (bytes32 key, uint256 index) = inbox.sendL2Message(actor, contentHash, _secretHash);

    // Emit event
    emit DepositToAztecPublic(_to, _amount, _secretHash, key, index);

    return (key, index);
  }

  // docs:start:deposit_private
  /**
   * @notice Deposit funds into the portal and adds an L2 message which can only be consumed privately on Aztec
   * @param _amount - The amount to deposit
   * @param _secretHashForL2MessageConsumption - The hash of the secret consumable L1 to L2 message. The hash should be
   * 254 bits (so it can fit in a Field element)
   * @return The key of the entry in the Inbox and its leaf index
   */
  function depositToAztecPrivate(uint256 _amount, bytes32 _secretHashForL2MessageConsumption)
    external
    returns (bytes32, uint256)
  // docs:end:deposit_private
  {
    // Preamble
    DataStructures.L2Actor memory actor = DataStructures.L2Actor(l2Bridge, rollupVersion);

    // Hash the message content to be reconstructed in the receiving contract - the signature below does not correspond
    // to a real function. It's just an identifier of an action.
    bytes32 contentHash = Hash.sha256ToField(abi.encodeWithSignature("mint_to_private(uint256)", _amount));

    // Hold the tokens in the portal
    underlying.safeTransferFrom(msg.sender, address(this), _amount);

    // Send message to rollup
    (bytes32 key, uint256 index) = inbox.sendL2Message(actor, contentHash, _secretHashForL2MessageConsumption);

    // Emit event
    emit DepositToAztecPrivate(_amount, _secretHashForL2MessageConsumption, key, index);

    return (key, index);
  }

  // docs:start:token_portal_withdraw
  /**
   * @notice Withdraw funds from the portal
   * @dev Second part of withdraw, must be initiated from L2 first as it will consume a message from outbox
   * @param _recipient - The address to send the funds to
   * @param _amount - The amount to withdraw
   * @param _withCaller - Flag to use `msg.sender` as caller, otherwise address(0)
   * @param _epoch - The epoch the message is in
   * @param _leafIndex - The amount to withdraw
   * @param _path - Flag to use `msg.sender` as caller, otherwise address(0)
   * Must match the caller of the message (specified from L2) to consume it.
   */
  function withdraw(
    address _recipient,
    uint256 _amount,
    bool _withCaller,
    Epoch _epoch,
    uint256 _leafIndex,
    bytes32[] calldata _path
  ) external {
    // The purpose of including the function selector is to make the message unique to that specific call. Note that
    // it has nothing to do with calling the function.
    DataStructures.L2ToL1Msg memory message = DataStructures.L2ToL1Msg({
      sender: DataStructures.L2Actor(l2Bridge, rollupVersion),
      recipient: DataStructures.L1Actor(address(this), block.chainid),
      content: Hash.sha256ToField(
        abi.encodeWithSignature(
          "withdraw(address,uint256,address)", _recipient, _amount, _withCaller ? msg.sender : address(0)
        )
      )
    });

    outbox.consume(message, _epoch, _leafIndex, _path);

    underlying.safeTransfer(_recipient, _amount);
  }
  // docs:end:token_portal_withdraw
}
