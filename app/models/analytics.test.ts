import { describe, expect, it } from "vitest";

import {
  describeAssistantStatus,
  groupMetricsByCategory,
  isAssistantUsable,
  isEmptyResult,
  type AssistantStatus,
  type MetricResult,
  type MetricSummary,
} from "./analytics";

/* -------------------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------------------- */

function metric(name: string, category: string): MetricSummary {
  return {
    name,
    title: name,
    description: "",
    category,
    visualization: "table",
    examples: [],
  };
}

function status(overrides: Partial<AssistantStatus> = {}): AssistantStatus {
  return {
    enabled: true,
    reachable: true,
    baseUrl: "https://provider.example/v1",
    authenticated: true,
    chatModel: "gpt-oss:120b",
    chatModelPresent: true,
    embeddingsAvailable: false,
    embedModel: "nomic-embed-text",
    availableModels: ["gpt-oss:120b"],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
   Catalogue
   ------------------------------------------------------------------------- */

describe("groupMetricsByCategory", () => {
  it("keeps categories in the order they first appear", () => {
    const groups = groupMetricsByCategory([
      metric("a", "revenue"),
      metric("b", "clinical"),
      metric("c", "revenue"),
    ]);

    expect(groups.map((group) => group.category)).toEqual(["revenue", "clinical"]);
  });

  it("keeps the API's ordering inside a category", () => {
    const groups = groupMetricsByCategory([
      metric("a", "revenue"),
      metric("b", "clinical"),
      metric("c", "revenue"),
    ]);

    expect(groups[0].metrics.map((m) => m.name)).toEqual(["a", "c"]);
  });

  it("handles an empty catalogue", () => {
    expect(groupMetricsByCategory([])).toEqual([]);
  });
});

describe("isEmptyResult", () => {
  const base: MetricResult = {
    metric: { name: "m", title: "M", visualization: "table", category: "c" },
    params: {},
    columns: [{ key: "n", label: "N", type: "number" }],
    rows: [],
  };

  it("treats no rows as empty", () => {
    expect(isEmptyResult(base)).toBe(true);
  });

  it("treats a row as not empty, even an all-zero one", () => {
    expect(isEmptyResult({ ...base, rows: [{ n: 0 }] })).toBe(false);
  });
});

/* -------------------------------------------------------------------------
   Assistant availability
   ------------------------------------------------------------------------- */

describe("isAssistantUsable", () => {
  it("accepts a provider that is on, reachable and serving the model", () => {
    expect(isAssistantUsable(status())).toBe(true);
  });

  it.each([
    ["switched off", { enabled: false }],
    ["unreachable", { reachable: false }],
    ["missing the configured model", { chatModelPresent: false }],
  ])("rejects one that is %s", (_, overrides) => {
    expect(isAssistantUsable(status(overrides))).toBe(false);
  });

  it("does not require embeddings — those belong to notes search", () => {
    expect(isAssistantUsable(status({ embeddingsAvailable: false }))).toBe(true);
  });
});

describe("describeAssistantStatus", () => {
  it("says nothing when the assistant is available", () => {
    expect(describeAssistantStatus(status())).toBeNull();
  });

  it("reports a missing key before an unreachable provider", () => {
    // No key is *why* it is unreachable; leading with the reachability would
    // send someone to check the network for a configuration problem.
    const message = describeAssistantStatus(
      status({ authenticated: false, reachable: false }),
    );
    expect(message).toMatch(/API key/);
  });

  it("names the model when the provider does not serve it", () => {
    const message = describeAssistantStatus(status({ chatModelPresent: false }));
    expect(message).toContain("gpt-oss:120b");
  });

  it("names the provider when it is not responding", () => {
    const message = describeAssistantStatus(status({ reachable: false }));
    expect(message).toContain("https://provider.example/v1");
  });
});
