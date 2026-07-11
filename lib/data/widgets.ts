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
] as const;

export type Widget = (typeof widgets)[number];

// MySQL's tinyint(1) (normalized to the "toggle" widget) comes back from the
// driver as a raw 0/1 number, not a real JS boolean — recognize the known
// truthy representations rather than trusting the runtime type.
export function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
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
};
