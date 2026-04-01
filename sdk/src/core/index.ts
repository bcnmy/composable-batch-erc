// Batch builder
export { composableBatch, BatchBuilder, approve, wrap, transfer } from './batch.js'

// Token and contract binding
export { token, native } from './token.js'
export { contract } from './contract.js'
export type { BoundToken } from './token.js'
export type { BoundContract, StepDescriptor, CallOptions } from './contract.js'

// Storage binding
export { storage, fromStorage } from './storage.js'
export type { BoundStorage, CaptureConfig } from './storage.js'

// Dynamic params
export { createDynamic } from './params.js'

// Encoding (advanced)
export { encodeStep, encodePredicate, isDynamic } from './encode.js'

// Types
export type {
  ComposableExecution,
  InputParam,
  OutputParam,
  Constraint,
  DynamicParam,
  ConstrainedParam,
  MaybeDynamic,
} from './types.js'
export {
  InputParamType,
  InputParamFetcherType,
  OutputParamFetcherType,
  ConstraintType,
} from './types.js'
