import type { LucideIcon } from "lucide-react";
import {
  FileJson,
  Type,
  AlignLeft,
  Hash,
  ToggleLeft,
  Calendar,
  CalendarClock,
  List,
  Link,
  Braces,
  SlidersHorizontal,
  Network,
  Clock3,
  Fingerprint,
  Binary,
  CodeXml,
  Image,
  Video,
  AudioLines,
  Palette,
  KeyRound,
  Globe,
  Mail,
  Percent,
  Star,
  DollarSign,
  BookOpen,
  UserCircle,
  Tag,
  Search,
} from "lucide-react";

export const widgets = [
  "auto",
  "text",
  "textarea",
  "number",
  "toggle",
  "date",
  "datetime",
  "select",
  "json",
  "reference",
  "array",
  "range",
  "network",
  "interval",
  "uuid",
  "bytea",
  "html",
  "image",
  "video",
  "audio",
  "color",
  "password",
  "url",
  "email",
  "percent",
  "rating",
  "currency",
  "markdown",
  "avatar",
  "timezone",
  "tag",
  "autocomplete",
] as const;

export type Widget = (typeof widgets)[number];

// MySQL's tinyint(1) (normalized to the "toggle" widget) comes back from the
// driver as a raw 0/1 number, not a real JS boolean — recognize the known
// truthy representations rather than trusting the runtime type.
export function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function getLocalCurrency(): string {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "USD";
  }
  try {
    const locale = navigator.language || "en-US";
    const localeToCurrency: Record<string, string> = {
      "en-US": "USD",
      "en-GB": "GBP",
      "en-CA": "CAD",
      "en-AU": "AUD",
      "en-IN": "INR",
      "hi-IN": "INR",
      "de-DE": "EUR",
      "fr-FR": "EUR",
      "it-IT": "EUR",
      "es-ES": "EUR",
      "ja-JP": "JPY",
      "zh-CN": "CNY",
      "pt-BR": "BRL",
      "ru-RU": "RUB",
    };
    return localeToCurrency[locale] || localeToCurrency[locale.split("-")[0]] || "USD";
  } catch {
    return "USD";
  }
}

export function getCurrencySymbol(currencyCode: string): string {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "$";
  }
  try {
    const formatter = new Intl.NumberFormat(navigator.language || "en-US", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return formatter.format(0).replace(/[0-9\s.,-]/g, "") || "$";
  } catch {
    return "$";
  }
}

export const widgetIcons: Record<Widget, LucideIcon> = {
  auto: Type,
  text: Type,
  textarea: AlignLeft,
  number: Hash,
  toggle: ToggleLeft,
  date: Calendar,
  datetime: CalendarClock,
  select: List,
  json: FileJson,
  reference: Link,
  array: Braces,
  range: SlidersHorizontal,
  network: Network,
  interval: Clock3,
  uuid: Fingerprint,
  bytea: Binary,
  html: CodeXml,
  image: Image,
  video: Video,
  audio: AudioLines,
  color: Palette,
  password: KeyRound,
  url: Globe,
  email: Mail,
  percent: Percent,
  rating: Star,
  currency: DollarSign,
  markdown: BookOpen,
  avatar: UserCircle,
  timezone: Globe,
  tag: Tag,
  autocomplete: Search,
};
