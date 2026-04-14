import { type ChainClientDebugTraceCallReturnType } from "@/chains";

/**
 * TraceWithMetadata extends the base trace call result with additional metadata
 * for easier analysis and traversal.
 */
interface TraceWithMetadata
  extends Omit<ChainClientDebugTraceCallReturnType, "calls"> {
  _shouldIgnore?: boolean;
  _isHandledRevert?: boolean;
  _depth?: number;
  currentTraceIndex?: number;
  parentTraceIndex?: number;
}

/**
 * Flattens a nested trace call result into a flat array, annotates each trace
 * with depth, indices, and analyzes handled reverts.
 * @param callResult The root trace call result
 * @param depth The starting depth (default 0)
 * @returns Flat array of TraceWithMetadata
 */
export function flatTraceCallResult(
  callResult: ChainClientDebugTraceCallReturnType,
  depth = 0,
): TraceWithMetadata[] {
  // Flatten the nested call structure
  const flat = flattenCalls(callResult, depth);

  // Assign indices for easier parent/child traversal
  assignTraceIndices(flat);

  // Analyze and mark handled reverts
  return analyzeReverts(flat);
}

/**
 * Recursively flattens nested trace calls, annotating each with depth and default metadata.
 * @param callResult The current trace call result node
 * @param depth The current depth in the call tree
 * @returns Flat array of TraceWithMetadata
 */
function flattenCalls(
  callResult: ChainClientDebugTraceCallReturnType,
  depth = 0,
): TraceWithMetadata[] {
  const { calls, ...item } = callResult;
  const enhancedItem: TraceWithMetadata = {
    ...item,
    _depth: depth,
    _shouldIgnore: false,
    _isHandledRevert: false,
  };

  // Use array preallocation for performance if calls exist
  let result: TraceWithMetadata[];
  if (calls?.length) {
    // Preallocate for 1 (self) + all children
    result = new Array(1);
    result[0] = enhancedItem;
    for (const call of calls) {
      result.push(...flattenCalls(call, depth + 1));
    }
  } else {
    result = [enhancedItem];
  }
  return result;
}

/**
 * Assigns currentTraceIndex and parentTraceIndex to each trace for easy traversal.
 * @param traces Flat array of TraceWithMetadata
 */
function assignTraceIndices(traces: TraceWithMetadata[]) {
  // recentAtDepth[d] = most recent index at depth d
  const recentAtDepth: number[] = [];
  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i];
    trace.currentTraceIndex = i;
    const depth = trace._depth ?? 0;
    if (depth === 0) {
      trace.parentTraceIndex = -1;
    } else {
      // Parent is the most recent at depth-1
      const parentIndex = recentAtDepth[depth - 1];
      trace.parentTraceIndex = parentIndex !== undefined ? parentIndex : -1;
    }
    // Update the most recent at this depth
    recentAtDepth[depth] = i;
  }
}

/**
 * Analyzes the flat traces to mark handled reverts and those that should be ignored.
 * @param traces Flat array of TraceWithMetadata
 * @returns The same array, with _isHandledRevert/_shouldIgnore set as needed
 */
function analyzeReverts(traces: TraceWithMetadata[]): TraceWithMetadata[] {
  const { parentMap, childrenMap } = buildSequentialRelationships(traces);

  // Find all traces that are "innerHandleOp" calls (function selector 0x0042dc53)
  // We'll use this to block handled revert logic for their children
  const innerHandleOpSelector = "0x0042dc53";
  // Set of indices of traces that are innerHandleOp calls
  const innerHandleOpIndices = new Set<number>();
  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i];
    if (
      typeof trace.input === "string" &&
      trace.input.startsWith(innerHandleOpSelector)
    ) {
      innerHandleOpIndices.add(i);
    }
  }

  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i];
    // Only consider reverts that are not at the root
    if (trace.error?.includes("revert") && (trace._depth ?? 0) > 0) {
      // If the immediate parent is an innerHandleOp, do NOT mark as handled revert
      const parentIndex = trace.parentTraceIndex;
      if (parentIndex !== undefined && innerHandleOpIndices.has(parentIndex)) {
        // Special case: child revert under innerHandleOp should NOT be considered handled
        // See: 0x0042dc53 is innerHandleOp, which emits errors as events, not as reverts
        trace._isHandledRevert = false;
        trace._shouldIgnore = false;
        continue;
      }
      if (
        isRevertHandledByAncestor(
          i,
          traces,
          parentMap,
          childrenMap,
          innerHandleOpIndices,
        )
      ) {
        trace._isHandledRevert = true;
        trace._shouldIgnore = true;
      }
    }
  }

  return traces;
}

/**
 * Builds parent and children relationships for each trace in the flat array.
 * @param traces Flat array of TraceWithMetadata
 * @returns Object with parentMap and childrenMap
 */
function buildSequentialRelationships(traces: TraceWithMetadata[]) {
  const parentMap = new Map<number, number>();
  const childrenMap = new Map<number, number[]>();
  // recentParentAtDepth[d] = most recent index at depth d
  const recentParentAtDepth: number[] = [];

  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i];
    if (trace._depth === undefined)
      throw new Error("Call trace depth not found");
    const depth = trace._depth;
    // Trim the parent stack to current depth
    recentParentAtDepth.length = depth;

    if (depth > 0) {
      // Parent is the most recent at depth-1
      const parentDepth = depth - 1;
      const parentIndex = recentParentAtDepth[parentDepth];

      if (parentIndex !== undefined) {
        parentMap.set(i, parentIndex);

        if (!childrenMap.has(parentIndex)) {
          childrenMap.set(parentIndex, []);
        }
        childrenMap.get(parentIndex)?.push(i);
      }
    }

    // Update the most recent parent at this depth
    recentParentAtDepth[depth] = i;
  }

  return { parentMap, childrenMap };
}

/**
 * Determines if a revert at revertIndex is handled by any ancestor.
 * @param revertIndex Index of the revert trace
 * @param traces Flat array of TraceWithMetadata
 * @param parentMap Map of child index to parent index
 * @param childrenMap Map of parent index to array of child indices
 * @param innerHandleOpIndices Set of indices of traces that are innerHandleOp calls
 * @returns True if the revert is handled by an ancestor, false otherwise
 */
function isRevertHandledByAncestor(
  revertIndex: number,
  traces: TraceWithMetadata[],
  parentMap: Map<number, number>,
  childrenMap: Map<number, number[]>,
  innerHandleOpIndices?: Set<number>,
): boolean {
  if (traces[revertIndex]._depth === undefined)
    throw new Error("Call trace depth not found");
  const revertDepth = traces[revertIndex]._depth;

  // Check each ancestor level from immediate parent up to root
  for (let depth = revertDepth - 1; depth >= 0; depth--) {
    const ancestorIndex = findAncestorAtDepth(
      revertIndex,
      depth,
      parentMap,
      traces,
    );

    if (ancestorIndex !== undefined) {
      // If this ancestor is an innerHandleOp, skip it for handled revert logic
      if (innerHandleOpIndices?.has(ancestorIndex)) {
        // Do not consider this ancestor as a handler for the revert
        continue;
      }
      const ancestor = traces[ancestorIndex];

      // If ancestor succeeded, check if it continued execution (handled the revert)
      if (!ancestor.error) {
        if (
          checkContinuationAfterRevert(
            ancestorIndex,
            revertIndex,
            traces,
            parentMap,
            childrenMap,
          )
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Finds the ancestor of a trace at a specific depth.
 * @param childIndex Index of the child trace
 * @param targetDepth The depth to find the ancestor at
 * @param parentMap Map of child index to parent index
 * @param traces Flat array of TraceWithMetadata
 * @returns Index of the ancestor at targetDepth, or undefined if not found
 */
function findAncestorAtDepth(
  childIndex: number,
  targetDepth: number,
  parentMap: Map<number, number>,
  traces: TraceWithMetadata[],
): number | undefined {
  let current = childIndex;

  // Walk up the parent chain until we reach target depth
  while (parentMap.has(current)) {
    const parentIndex = parentMap.get(current);
    if (parentIndex === undefined)
      throw new Error("Failed to get call trace parent index");
    if (traces[parentIndex]._depth === targetDepth) {
      return parentIndex;
    }
    current = parentIndex;
  }

  return undefined;
}

/**
 * Checks if an ancestor continued execution after a revert, indicating the revert was handled.
 * @param ancestorIndex Index of the ancestor trace
 * @param revertIndex Index of the revert trace
 * @param traces Flat array of TraceWithMetadata
 * @param parentMap Map of child index to parent index
 * @param childrenMap Map of parent index to array of child indices
 * @returns True if ancestor continued execution after revert, false otherwise
 */
function checkContinuationAfterRevert(
  ancestorIndex: number,
  revertIndex: number,
  traces: TraceWithMetadata[],
  parentMap: Map<number, number>,
  childrenMap: Map<number, number[]>,
): boolean {
  if (traces[ancestorIndex]._depth === undefined)
    throw new Error("Call trace depth not found");

  const ancestorDepth = traces[ancestorIndex]._depth;

  // 1. Check for successful siblings after ancestor at the same level
  const ancestorParent = parentMap.get(ancestorIndex);
  if (ancestorParent !== undefined) {
    const siblings = childrenMap.get(ancestorParent) || [];
    const ancestorPos = siblings.indexOf(ancestorIndex);

    if (ancestorPos !== -1 && ancestorPos < siblings.length - 1) {
      // Only check siblings after the ancestor
      for (let j = ancestorPos + 1; j < siblings.length; j++) {
        if (!traces[siblings[j]].error) return true;
      }
    }
  }

  // 2. For top-level ancestors, check subsequent top-level calls
  if (ancestorDepth === 0) {
    // Cache top-level indices for performance
    const topLevelIndices: number[] = [];
    for (let idx = 0; idx < traces.length; idx++) {
      if ((traces[idx]._depth ?? 0) === 0) topLevelIndices.push(idx);
    }
    const ancestorPos = topLevelIndices.indexOf(ancestorIndex);
    if (ancestorPos !== -1 && ancestorPos < topLevelIndices.length - 1) {
      for (let j = ancestorPos + 1; j < topLevelIndices.length; j++) {
        if (!traces[topLevelIndices[j]].error) return true;
      }
    }
  }

  // 3. Check ancestor's children that execute after the revert and succeed
  const ancestorChildren = childrenMap.get(ancestorIndex) || [];
  for (let j = 0; j < ancestorChildren.length; j++) {
    const childIdx = ancestorChildren[j];
    if (childIdx > revertIndex && !traces[childIdx].error) {
      return true;
    }
  }

  return false;
}
