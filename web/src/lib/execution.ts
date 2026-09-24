// The direct execution path (ADR-0005): on BSC before the executor is deployed, the server
// returns the exact calls for one user operation instead of an executor plan. The client
// sends them as-is, batched and sponsored, through lib/aa.ts.
export interface ExecCall {
  to: `0x${string}`;
  data: `0x${string}`;
  /** Wei, as a decimal string, because bigint does not survive JSON. */
  value?: string;
}
