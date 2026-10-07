// The route stack after Vera tried to build a plan. Pure (no React) so the rule is a plain test.
//
// Success replaces the thinking route with the plan. A refusal (the market is closed, the amount is
// under Binance's $6, a rate limit) goes back to the goal screen, and it must carry what the person
// typed: a fresh, empty GoalScreen threw away a long goal on exactly the all-closed weekend path
// judges are most likely to hit, and pushing a new goal route left two of them in the stack.
export interface RouteLike {
  screen: string;
  params: Record<string, unknown>;
}

export function routesAfterPlanAttempt<R extends RouteLike>(stack: readonly R[], planBuilt: boolean, goal: string, amount: number): R[] {
  const base = stack.filter((r) => r.screen !== "thinking");
  if (planBuilt) return [...base, { screen: "plan", params: {} } as unknown as R];
  const back = { screen: "goal", params: { goal, amt: String(amount) } } as unknown as R;
  const top = base[base.length - 1];
  // The goal route that started this attempt is already underneath: reuse it, don't stack a second one.
  return top?.screen === "goal" ? [...base.slice(0, -1), back] : [...base, back];
}
