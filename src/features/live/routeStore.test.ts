import { beforeEach, describe, expect, it } from "vitest";
import { MAX_SAVED_ROUTES, useRouteStore } from "./routeStore";

const saved = () => useRouteStore.getState().saved;

describe("saved routes", () => {
  beforeEach(() => useRouteStore.setState({ saved: ["E1", "39A", "16"] }));

  it("starts with the demo routes", () => expect(saved()).toEqual(["E1", "39A", "16"]));

  it("adds a route once, at the end", () => {
    useRouteStore.getState().add("46A");
    useRouteStore.getState().add("46A");
    expect(saved()).toEqual(["E1", "39A", "16", "46A"]);
  });

  it("stops adding at the limit", () => {
    for (let i = 0; i < MAX_SAVED_ROUTES + 2; i++) useRouteStore.getState().add(`X${i}`);
    expect(saved()).toHaveLength(MAX_SAVED_ROUTES);
  });

  it("removes a route", () => {
    useRouteStore.getState().remove("39A");
    expect(saved()).toEqual(["E1", "16"]);
  });

  it("moves a route left or right, but not past the ends", () => {
    useRouteStore.getState().move("16", -1);
    expect(saved()).toEqual(["E1", "16", "39A"]);
    useRouteStore.getState().move("E1", -1);
    useRouteStore.getState().move("39A", 1);
    expect(saved()).toEqual(["E1", "16", "39A"]);
  });
});
