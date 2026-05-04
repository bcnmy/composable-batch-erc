import { traceOperation } from "./tracing";

/**
 * Higher-order function to wrap standalone functions or methods with tracing
 * Pure functional approach - no service injection needed
 *
 * @example Wrap a standalone utility function
 * const result = await withTrace(
 *   'util.operation',
 *   () => someUtilFunction(args)
 * );
 *
 * @example Create a traced version of a function
 * const tracedGetBalance = withTrace(
 *   'rpc.getBalance',
 *   getBalance,
 *   args => ({ address: args[0], chainId: args[1] })
 * );
 *
 * @example Wrap a method in constructor (if needed)
 * this.tracedMethod = withTrace(
 *   'service.method',
 *   this.method.bind(this),
 *   args => ({ customTag: args[0].field })
 * );
 */
// biome-ignore lint/suspicious/noExplicitAny: allow any for this variable
export const withTrace = <T extends (...args: any[]) => any>(
  operationName: string,
  fn: T,
  tags?: Record<string, string | number | boolean>,
): T => {
  return ((...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    return traceOperation(
      operationName,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      () => fn(...args),
      tags,
    ) as unknown as Promise<Awaited<ReturnType<T>>>;
  }) as T;
};
