export const NEXUS_121 = [
  {
    type: "constructor",
    inputs: [
      {
        name: "anEntryPoint",
        type: "address",
        internalType: "address",
      },
      {
        name: "defaultValidator",
        type: "address",
        internalType: "address",
      },
      {
        name: "initData",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "fallback",
    stateMutability: "payable",
  },
  {
    type: "receive",
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "accountId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "string",
        internalType: "string",
      },
    ],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "addDeposit",
    inputs: [],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "checkERC7739Support",
    inputs: [
      {
        name: "hash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "signature",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "eip712Domain",
    inputs: [],
    outputs: [
      {
        name: "fields",
        type: "bytes1",
        internalType: "bytes1",
      },
      {
        name: "name",
        type: "string",
        internalType: "string",
      },
      {
        name: "version",
        type: "string",
        internalType: "string",
      },
      {
        name: "chainId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "verifyingContract",
        type: "address",
        internalType: "address",
      },
      {
        name: "salt",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "extensions",
        type: "uint256[]",
        internalType: "uint256[]",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "emergencyUninstallHook",
    inputs: [
      {
        name: "data",
        type: "tuple",
        internalType: "struct EmergencyUninstall",
        components: [
          {
            name: "hook",
            type: "address",
            internalType: "address",
          },
          {
            name: "hookType",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "deInitData",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "nonce",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
      {
        name: "signature",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "entryPoint",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "execute",
    inputs: [
      {
        name: "mode",
        type: "bytes32",
        internalType: "ExecutionMode",
      },
      {
        name: "executionCalldata",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "executeComposable",
    inputs: [
      {
        name: "executions",
        type: "tuple[]",
        internalType: "struct ComposableExecution[]",
        components: [
          {
            name: "functionSig",
            type: "bytes4",
            internalType: "bytes4",
          },
          {
            name: "inputParams",
            type: "tuple[]",
            internalType: "struct InputParam[]",
            components: [
              {
                name: "paramType",
                type: "uint8",
                internalType: "enum InputParamType",
              },
              {
                name: "fetcherType",
                type: "uint8",
                internalType: "enum InputParamFetcherType",
              },
              {
                name: "paramData",
                type: "bytes",
                internalType: "bytes",
              },
              {
                name: "constraints",
                type: "tuple[]",
                internalType: "struct Constraint[]",
                components: [
                  {
                    name: "constraintType",
                    type: "uint8",
                    internalType: "enum ConstraintType",
                  },
                  {
                    name: "referenceData",
                    type: "bytes",
                    internalType: "bytes",
                  },
                ],
              },
            ],
          },
          {
            name: "outputParams",
            type: "tuple[]",
            internalType: "struct OutputParam[]",
            components: [
              {
                name: "fetcherType",
                type: "uint8",
                internalType: "enum OutputParamFetcherType",
              },
              {
                name: "paramData",
                type: "bytes",
                internalType: "bytes",
              },
            ],
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "executeFromExecutor",
    inputs: [
      {
        name: "mode",
        type: "bytes32",
        internalType: "ExecutionMode",
      },
      {
        name: "executionCalldata",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "bytes[]",
        internalType: "bytes[]",
      },
    ],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "executeUserOp",
    inputs: [
      {
        name: "userOp",
        type: "tuple",
        internalType: "struct PackedUserOperation",
        components: [
          {
            name: "sender",
            type: "address",
            internalType: "address",
          },
          {
            name: "nonce",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "initCode",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "callData",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "accountGasLimits",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "preVerificationGas",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "gasFees",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "paymasterAndData",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "signature",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "getActiveHook",
    inputs: [],
    outputs: [
      {
        name: "hook",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getDeposit",
    inputs: [],
    outputs: [
      {
        name: "result",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getExecutorsPaginated",
    inputs: [
      {
        name: "cursor",
        type: "address",
        internalType: "address",
      },
      {
        name: "size",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "array",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "next",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getFallbackHandlerBySelector",
    inputs: [
      {
        name: "selector",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes1",
        internalType: "CallType",
      },
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getImplementation",
    inputs: [],
    outputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRegistry",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC7484",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getValidatorsPaginated",
    inputs: [
      {
        name: "cursor",
        type: "address",
        internalType: "address",
      },
      {
        name: "size",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "array",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "next",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "initializeAccount",
    inputs: [
      {
        name: "initData",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "installModule",
    inputs: [
      {
        name: "moduleTypeId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "module",
        type: "address",
        internalType: "address",
      },
      {
        name: "initData",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "isInitialized",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isModuleInstalled",
    inputs: [
      {
        name: "moduleTypeId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "module",
        type: "address",
        internalType: "address",
      },
      {
        name: "additionalContext",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isValidSignature",
    inputs: [
      {
        name: "hash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "signature",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nonce",
    inputs: [
      {
        name: "key",
        type: "uint192",
        internalType: "uint192",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "proxiableUUID",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setRegistry",
    inputs: [
      {
        name: "newRegistry",
        type: "address",
        internalType: "contract IERC7484",
      },
      {
        name: "attesters",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "threshold",
        type: "uint8",
        internalType: "uint8",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "supportsExecutionMode",
    inputs: [
      {
        name: "mode",
        type: "bytes32",
        internalType: "ExecutionMode",
      },
    ],
    outputs: [
      {
        name: "isSupported",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "supportsModule",
    inputs: [
      {
        name: "moduleTypeId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "uninstallModule",
    inputs: [
      {
        name: "moduleTypeId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "module",
        type: "address",
        internalType: "address",
      },
      {
        name: "deInitData",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "upgradeToAndCall",
    inputs: [
      {
        name: "newImplementation",
        type: "address",
        internalType: "address",
      },
      {
        name: "data",
        type: "bytes",
        internalType: "bytes",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "validateUserOp",
    inputs: [
      {
        name: "op",
        type: "tuple",
        internalType: "struct PackedUserOperation",
        components: [
          {
            name: "sender",
            type: "address",
            internalType: "address",
          },
          {
            name: "nonce",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "initCode",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "callData",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "accountGasLimits",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "preVerificationGas",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "gasFees",
            type: "bytes32",
            internalType: "bytes32",
          },
          {
            name: "paymasterAndData",
            type: "bytes",
            internalType: "bytes",
          },
          {
            name: "signature",
            type: "bytes",
            internalType: "bytes",
          },
        ],
      },
      {
        name: "userOpHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "missingAccountFunds",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
      {
        name: "validationData",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawDepositTo",
    inputs: [
      {
        name: "to",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "event",
    name: "ERC7484RegistryConfigured",
    inputs: [
      {
        name: "registry",
        type: "address",
        indexed: true,
        internalType: "contract IERC7484",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "EmergencyHookUninstallRequest",
    inputs: [
      {
        name: "hook",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "timestamp",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "EmergencyHookUninstallRequestReset",
    inputs: [
      {
        name: "hook",
        type: "address",
        indexed: false,
        internalType: "address",
      },
      {
        name: "timestamp",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ModuleInstalled",
    inputs: [
      {
        name: "moduleTypeId",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "module",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ModuleUninstalled",
    inputs: [
      {
        name: "moduleTypeId",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "module",
        type: "address",
        indexed: false,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "PREPInitialized",
    inputs: [
      {
        name: "r",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TryDelegateCallUnsuccessful",
    inputs: [
      {
        name: "callData",
        type: "bytes",
        indexed: false,
        internalType: "bytes",
      },
      {
        name: "result",
        type: "bytes",
        indexed: false,
        internalType: "bytes",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "TryExecuteUnsuccessful",
    inputs: [
      {
        name: "callData",
        type: "bytes",
        indexed: false,
        internalType: "bytes",
      },
      {
        name: "result",
        type: "bytes",
        indexed: false,
        internalType: "bytes",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Upgraded",
    inputs: [
      {
        name: "implementation",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AccountAccessUnauthorized",
    inputs: [],
  },
  {
    type: "error",
    name: "AccountAlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "AccountNotInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "CanNotRemoveLastValidator",
    inputs: [],
  },
  {
    type: "error",
    name: "ComposableExecutionFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "ConstraintNotMet",
    inputs: [
      {
        name: "constraintType",
        type: "uint8",
        internalType: "enum ConstraintType",
      },
    ],
  },
  {
    type: "error",
    name: "DefaultValidatorAlreadyInstalled",
    inputs: [],
  },
  {
    type: "error",
    name: "ERC7702AccountCannotBeUpgradedThisWay",
    inputs: [],
  },
  {
    type: "error",
    name: "EmergencyTimeLockNotExpired",
    inputs: [],
  },
  {
    type: "error",
    name: "EmergencyUninstallSigError",
    inputs: [],
  },
  {
    type: "error",
    name: "EnableModeSigError",
    inputs: [],
  },
  {
    type: "error",
    name: "EntryPointCanNotBeZero",
    inputs: [],
  },
  {
    type: "error",
    name: "ExecutionFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "FallbackAlreadyInstalledForSelector",
    inputs: [
      {
        name: "selector",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
  },
  {
    type: "error",
    name: "FallbackCallTypeInvalid",
    inputs: [],
  },
  {
    type: "error",
    name: "FallbackHandlerUninstallFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "FallbackNotInstalledForSelector",
    inputs: [
      {
        name: "selector",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
  },
  {
    type: "error",
    name: "FallbackSelectorForbidden",
    inputs: [],
  },
  {
    type: "error",
    name: "HookAlreadyInstalled",
    inputs: [
      {
        name: "currentHook",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "HookPostCheckFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "ImplementationIsNotAContract",
    inputs: [],
  },
  {
    type: "error",
    name: "InnerCallFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidConstraintType",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidImplementationAddress",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidInitData",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidInput",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidModule",
    inputs: [
      {
        name: "module",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "InvalidModuleTypeId",
    inputs: [
      {
        name: "moduleTypeId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "InvalidNonce",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidOutputParamFetcherType",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidPREP",
    inputs: [],
  },
  {
    type: "error",
    name: "InvalidParameterEncoding",
    inputs: [
      {
        name: "message",
        type: "string",
        internalType: "string",
      },
    ],
  },
  {
    type: "error",
    name: "LinkedList_AlreadyInitialized",
    inputs: [],
  },
  {
    type: "error",
    name: "LinkedList_EntryAlreadyInList",
    inputs: [
      {
        name: "entry",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "LinkedList_InvalidEntry",
    inputs: [
      {
        name: "entry",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "LinkedList_InvalidPage",
    inputs: [],
  },
  {
    type: "error",
    name: "MismatchModuleTypeId",
    inputs: [],
  },
  {
    type: "error",
    name: "MissingFallbackHandler",
    inputs: [
      {
        name: "selector",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
  },
  {
    type: "error",
    name: "ModuleAddressCanNotBeZero",
    inputs: [],
  },
  {
    type: "error",
    name: "ModuleAlreadyInstalled",
    inputs: [
      {
        name: "moduleTypeId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "module",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "ModuleNotInstalled",
    inputs: [
      {
        name: "moduleTypeId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "module",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "NexusInitializationFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "NoValidatorInstalled",
    inputs: [],
  },
  {
    type: "error",
    name: "Output_StaticCallFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "PrevalidationHookAlreadyInstalled",
    inputs: [
      {
        name: "currentPreValidationHook",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnauthorizedCallContext",
    inputs: [],
  },
  {
    type: "error",
    name: "UnauthorizedOperation",
    inputs: [
      {
        name: "operator",
        type: "address",
        internalType: "address",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedCallType",
    inputs: [
      {
        name: "callType",
        type: "bytes1",
        internalType: "CallType",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedExecType",
    inputs: [
      {
        name: "execType",
        type: "bytes1",
        internalType: "ExecType",
      },
    ],
  },
  {
    type: "error",
    name: "UnsupportedModuleType",
    inputs: [
      {
        name: "moduleTypeId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
  },
  {
    type: "error",
    name: "UpgradeFailed",
    inputs: [],
  },
  {
    type: "error",
    name: "ValidatorNotInstalled",
    inputs: [
      {
        name: "module",
        type: "address",
        internalType: "address",
      },
    ],
  },
];
