import { Hex, parseAbiItem } from "viem";

export const TRANSFER_EVENT_ABI = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export const TRANSFER_EVENT_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;

export const BEFORE_EXECUTION_EVENT_TOPIC =
  "0xbb47ee3e183a558b1a2ff0874b079f3fc5478b7454eacf2bfc5af2ff5878f972" as Hex;

export const USER_OPERATION_EVENT_ABI = parseAbiItem(
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
);

export const USER_OPERATION_EVENT_TOPIC =
  "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f" as Hex;

export const INNER_HANDLE_OP_ABI = parseAbiItem([
  "struct MemoryUserOp { address sender; uint256 nonce; uint256 verificationGasLimit; uint256 callGasLimit; uint256 paymasterVerificationGasLimit; uint256 paymasterPostOpGasLimit; uint256 preVerificationGas; address paymaster; uint256 maxFeePerGas; uint256 maxPriorityFeePerGas;}",
  "struct UserOpInfo { MemoryUserOp mUserOp; bytes32 userOpHash; uint256 prefund; uint256 contextOffset; uint256 preOpGas;}",
  "function innerHandleOp(bytes memory callData, UserOpInfo memory opInfo, bytes calldata context) external returns (uint256 actualGasCost)",
]);

export const WITHDRAWN_EVENT_ABI = parseAbiItem(
  "event Withdrawn(address indexed account, address withdrawAddress, uint256 amount)",
);

export const WITHDRAWN_EVENT_TOPIC =
  "0xd1c19fbcd4551a5edfb66d43d2e337c04837afda3482b42bdf569a8fccdae5fb" as Hex;

export const INNER_HANDLE_OP_SELECTOR = "0x0042dc53" as Hex;

export const POST_OP_SELECTIOR = "0x7c627b21" as Hex;
