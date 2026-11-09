const APPS: [RegExp, string][] = [
  [/LinkedInApp/i, "LinkedIn"],
  [/FBAN|FBAV|FB_IAB|FBIOS/, "Facebook"],
  [/Instagram/, "Instagram"],
  [/musical_ly|BytedanceWebview|TikTok/i, "TikTok"],
  [/Snapchat/, "Snapchat"],
  [/Twitter/i, "X"],
];

/**
 * Name of the app whose built-in browser is showing the page, or null in a normal browser.
 * Google blocks sign-in and Google Pay inside these web views.
 */
export function inAppBrowserName(ua: string): string | null {
  for (const [re, name] of APPS) if (re.test(ua)) return name;
  if (/; wv\)/.test(ua)) return "this app";
  return null;
}
