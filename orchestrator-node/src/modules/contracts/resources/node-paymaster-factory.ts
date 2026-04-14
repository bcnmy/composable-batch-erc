export const nodePaymasterFactoryAbi = [
  {
    inputs: [],
    name: "NodePMDeployFailed",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "entryPoint",
        type: "address",
      },
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        internalType: "address[]",
        name: "workerEOAs",
        type: "address[]",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
    ],
    name: "deployAndFundNodePaymaster",
    outputs: [
      {
        internalType: "address",
        name: "nodePaymaster",
        type: "address",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "entryPoint",
        type: "address",
      },
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        internalType: "address[]",
        name: "workerEOAs",
        type: "address[]",
      },
      {
        internalType: "uint256",
        name: "index",
        type: "uint256",
      },
    ],
    name: "getNodePaymasterAddress",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];
