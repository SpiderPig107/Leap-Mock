import { describe, expect, it } from "vitest";
import { inAppBrowserName } from "./inAppBrowser";

const android = (extra: string) =>
  `Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 ${extra}`;

describe("inAppBrowserName", () => {
  it("detects LinkedIn on iOS and Android", () => {
    expect(
      inAppBrowserName(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.8",
      ),
    ).toBe("LinkedIn");
    expect(inAppBrowserName(android("[LinkedInApp]/4.1.9"))).toBe("LinkedIn");
  });

  it("detects Facebook and Instagram", () => {
    expect(inAppBrowserName(android("[FB_IAB/FB4A;FBAV/480.0.0.0;]"))).toBe("Facebook");
    expect(inAppBrowserName(android("Instagram 345.0.0.0 Android"))).toBe("Instagram");
  });

  it("falls back to a generic name for other Android web views", () => {
    expect(inAppBrowserName(android(""))).toBe("this app");
  });

  it("returns null for normal browsers", () => {
    expect(
      inAppBrowserName(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
      ),
    ).toBeNull();
    expect(
      inAppBrowserName(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBeNull();
    expect(
      inAppBrowserName(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBeNull();
  });
});
