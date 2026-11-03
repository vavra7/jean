import { describe, expect, it } from "vitest";
import { renderPlaceholders } from "./system-prompt.js";

describe("renderPlaceholders", () => {
  const date = "2026-11-03";

  it("replaces {{display_name}} and {{date}}", () => {
    expect(
      renderPlaceholders("Hi {{display_name}}, today is {{date}}.", {
        displayName: "Alex",
        date,
      }),
    ).toBe("Hi Alex, today is 2026-11-03.");
  });

  it("falls back to 'there' when displayName is null", () => {
    expect(
      renderPlaceholders("Hello {{display_name}}!", { displayName: null, date }),
    ).toBe("Hello there!");
  });

  it("replaces all occurrences of each placeholder", () => {
    expect(
      renderPlaceholders(
        "{{display_name}} knows {{display_name}} is {{date}}.",
        { displayName: "Sam", date },
      ),
    ).toBe("Sam knows Sam is 2026-11-03.");
  });

  it("leaves unknown placeholders intact rather than blanking them", () => {
    expect(
      renderPlaceholders("See {{unknown}} and {{display_name}}.", {
        displayName: "Alex",
        date,
      }),
    ).toBe("See {{unknown}} and Alex.");
  });

  it("does not touch braces that are not placeholders", () => {
    expect(
      renderPlaceholders("{display_name} {{date}} {date}", {
        displayName: "Alex",
        date,
      }),
    ).toBe("{display_name} 2026-11-03 {date}");
  });
});
