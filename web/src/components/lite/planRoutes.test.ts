import { describe, expect, it } from "vitest";
import { routesAfterPlanAttempt, type RouteLike } from "./planRoutes";

const home: RouteLike = { screen: "home", params: {} };
const goalRoute: RouteLike = { screen: "goal", params: {} };
const thinking: RouteLike = { screen: "thinking", params: {} };

describe("routesAfterPlanAttempt", () => {
  it("swaps the thinking route for the plan when a plan was built", () => {
    expect(routesAfterPlanAttempt([home, goalRoute, thinking], true, "grow", 50).map((r) => r.screen)).toEqual(["home", "goal", "plan"]);
  });

  it("goes back to the goal with what the person typed when the plan was refused", () => {
    const out = routesAfterPlanAttempt([home, goalRoute, thinking], false, "a long goal about big tech", 30);
    expect(out.map((r) => r.screen)).toEqual(["home", "goal"]);
    expect(out[1].params).toEqual({ goal: "a long goal about big tech", amt: "30" });
  });

  it("never leaves two goal routes in the stack", () => {
    const out = routesAfterPlanAttempt([home, goalRoute, thinking], false, "x", 10);
    expect(out.filter((r) => r.screen === "goal")).toHaveLength(1);
  });

  it("still gets the person back to a goal screen when it was reached some other way", () => {
    const out = routesAfterPlanAttempt([home, thinking], false, "x", 10);
    expect(out.map((r) => r.screen)).toEqual(["home", "goal"]);
  });
});
