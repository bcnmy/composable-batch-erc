import {
  type Abi,
  type AbiParameter,
  type Address,
  type Hex,
  encodeAbiParameters,
  toFunctionSelector,
} from 'viem'
import {
  type ComposableExecution,
  type InputParam,
  type OutputParam,
  type Constraint,
  type ConstraintDescriptor,
  type DynamicParam,
  type ConstrainedParam,
  InputParamType,
  InputParamFetcherType,
  ConstraintType,
  DYNAMIC,
} from './types.js'

// ────────────────────────────────────────────────────────────
// Type guards
// ────────────────────────────────────────────────────────────

export function isDynamic(value: unknown): value is DynamicParam {
  return (
    typeof value === 'object' &&
    value !== null &&
    DYNAMIC in value
  )
}

// ────────────────────────────────────────────────────────────
// Constraint encoding
// ────────────────────────────────────────────────────────────

function encodeConstraint(desc: ConstraintDescriptor): Constraint {
  return {
    constraintType: desc.type,
    referenceData: desc.referenceData,
  }
}

// ────────────────────────────────────────────────────────────
// Single value → InputParam
// ────────────────────────────────────────────────────────────

function dynamicToInputParam(
  value: DynamicParam,
  paramType: InputParamType,
): InputParam {
  return {
    paramType,
    fetcherType:
      value.__kind === 'balance'
        ? InputParamFetcherType.BALANCE
        : InputParamFetcherType.STATIC_CALL,
    paramData: value.__fetcherData,
    constraints: value.__constraints.map(encodeConstraint),
  }
}

function staticToInputParam(
  value: unknown,
  abiType: AbiParameter,
  paramType: InputParamType,
): InputParam {
  return {
    paramType,
    fetcherType: InputParamFetcherType.RAW_BYTES,
    paramData: encodeAbiParameters([abiType], [value]),
    constraints: [],
  }
}

// ────────────────────────────────────────────────────────────
// Argument flattening (handles structs with dynamic fields)
// ────────────────────────────────────────────────────────────

/**
 * Walk an ABI argument. If it's a tuple (struct) and the user passed
 * an object, flatten each field into a separate InputParam.
 * This produces the same calldata as ABI-encoding the struct fields
 * sequentially (valid for structs with only static-width fields).
 */
function flattenArg(
  value: unknown,
  abiType: AbiParameter,
): InputParam[] {
  // Struct/tuple: flatten into individual fields
  if (
    abiType.type === 'tuple' &&
    'components' in abiType &&
    abiType.components &&
    typeof value === 'object' &&
    value !== null &&
    !isDynamic(value)
  ) {
    const obj = value as Record<string, unknown>
    const params: InputParam[] = []
    for (const component of abiType.components) {
      const fieldName = component.name
      if (!fieldName) continue
      const fieldValue = obj[fieldName]
      params.push(...flattenArg(fieldValue, component))
    }
    return params
  }

  // Dynamic param (balance or staticCall)
  if (isDynamic(value)) {
    return [dynamicToInputParam(value, InputParamType.CALL_DATA)]
  }

  // Static scalar
  return [staticToInputParam(value, abiType, InputParamType.CALL_DATA)]
}

// ────────────────────────────────────────────────────────────
// Step → ComposableExecution
// ────────────────────────────────────────────────────────────

export type EncodeStepParams = {
  to: Address | DynamicParam<Address>
  abi: Abi
  functionName: string
  args: readonly unknown[]
  value?: bigint | DynamicParam<bigint>
  outputParams?: OutputParam[]
}

export function encodeStep(params: EncodeStepParams): ComposableExecution {
  const { to, abi, functionName, args, value, outputParams = [] } = params
  const inputParams: InputParam[] = []

  // ── TARGET ─────────────────────────────────────────────
  if (isDynamic(to)) {
    inputParams.push(dynamicToInputParam(to, InputParamType.TARGET))
  } else {
    inputParams.push({
      paramType: InputParamType.TARGET,
      fetcherType: InputParamFetcherType.RAW_BYTES,
      paramData: encodeAbiParameters([{ type: 'address' }], [to]),
      constraints: [],
    })
  }

  // ── VALUE ──────────────────────────────────────────────
  if (value !== undefined) {
    if (isDynamic(value)) {
      inputParams.push(dynamicToInputParam(value, InputParamType.VALUE))
    } else {
      inputParams.push({
        paramType: InputParamType.VALUE,
        fetcherType: InputParamFetcherType.RAW_BYTES,
        paramData: encodeAbiParameters([{ type: 'uint256' }], [value]),
        constraints: [],
      })
    }
  }

  // ── CALL_DATA (function args) ──────────────────────────
  // Find the ABI function to get parameter types
  const abiFunction = (abi as readonly AbiParameter[]).find(
    (item: any) => item.type === 'function' && item.name === functionName,
  ) as AbiFunction | undefined

  if (!abiFunction) {
    throw new Error(`Function "${functionName}" not found in ABI`)
  }

  const abiInputs = abiFunction.inputs
  for (let i = 0; i < args.length; i++) {
    const abiType = abiInputs[i]
    const argValue = args[i]
    inputParams.push(...flattenArg(argValue, abiType))
  }

  // ── Function selector ──────────────────────────────────
  const functionSig = toFunctionSelector(abiFunction) as Hex

  return {
    functionSig,
    inputParams,
    outputParams,
  }
}

// ────────────────────────────────────────────────────────────
// Predicate → ComposableExecution
// ────────────────────────────────────────────────────────────

export function encodePredicate(
  conditions: ConstrainedParam[],
): ComposableExecution {
  return {
    functionSig: '0x00000000',
    inputParams: conditions.map((c) =>
      dynamicToInputParam(c, InputParamType.CALL_DATA),
    ),
    outputParams: [],
  }
}
