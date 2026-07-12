export interface TimezoneOption {
  value: string;
  label: string;
}

export const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function getTimezoneOffset(tz: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    return tzPart ? tzPart.value : "";
  } catch {
    return "";
  }
}

export const tzOptions: TimezoneOption[] = TIMEZONES.map((tz) => {
  const offset = getTimezoneOffset(tz);
  const offsetStr = offset ? ` (${offset})` : "";
  return { value: tz, label: `${tz}${offsetStr}` };
});
