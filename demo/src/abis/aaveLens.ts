export const aaveLensAbi = [
  {
    name: 'getSafeBorrowAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'assetDecimals', type: 'uint8' },
      { name: 'numerator', type: 'uint256' },
      { name: 'denominator', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getSafeWithdrawAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'assetDecimals', type: 'uint8' },
      { name: 'numerator', type: 'uint256' },
      { name: 'denominator', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getSafeWithdrawAmountWithOracle',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'assetDecimals', type: 'uint8' },
      { name: 'numerator', type: 'uint256' },
      { name: 'denominator', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getAssetPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'asset', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getHealthFactor',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const
