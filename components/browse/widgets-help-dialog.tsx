"use client";

import * as React from "react";
import { HelpCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { widgets, widgetIcons } from "@/lib/data/widgets";

const WIDGET_DESCRIPTIONS: Record<string, string> = {
  auto: "Automatically determine the best widget based on the database column type (default).",
  text: "Single-line text input field. Ideal for names, titles, and short descriptions.",
  textarea: "Multi-line text area. Best suited for comments, bios, and longer blocks of text.",
  number: "Numeric input field. Restricts typing to valid integer or decimal numbers.",
  toggle: "Checkbox/Switch. Perfect for boolean values like active/inactive, public/private.",
  date: "Date picker. Allows selecting a specific calendar date.",
  datetime: "Date and time picker. Useful for timestamps, scheduling, and events.",
  select: "Dropdown menu. Allows selecting a single value from a list of predefined options.",
  json: "Interactive JSON editor. Offers syntax highlighting and structural validation for JSON columns.",
  reference: "Foreign key reference selector. Enables search-and-pick row selection from related tables.",
  array: "Array value editor. Offers simple tag-based list management for array columns.",
  range: "Range selector. Ideal for columns holding numerical ranges.",
  network: "Network address format editor. Validates IP addresses, CIDR blocks, or MAC addresses.",
  interval: "Duration editor. Specifically handles time intervals (e.g. '3 days 4 hours').",
  uuid: "UUID editor. Validates values against standard UUID formats.",
  bytea: "Binary data handler. Represents bytea/blob columns.",
  html: "HTML editor and preview renderer. Offers raw source code views.",
  image: "Image uploader. Displays thumbnail previews and handles file uploads.",
  video: "Video player/uploader. Embeds native HTML5 video previews.",
  audio: "Audio player/uploader. Provides audio control controls for voice clips or sound tracks.",
  color: "Color picker. Renders a color palette picker in forms and a colored badge in the grid.",
  password: "Password input. Masks characters with bullets for tokens, secrets, or passwords.",
  url: "URL link. Renders a text input in forms and a clickable external link with icon in the grid.",
  email: "Email link. Renders a text input in forms and a clickable mailto: link with icon in the grid.",
  percent: "Percentage slider. Renders a slider + number box in forms and a visual progress bar in the grid.",
  rating: "Star rating. Renders an interactive 5-star picker in forms and filled/empty amber stars in the grid.",
  currency: "Currency text. Renders a numeric field with a '$' symbol prefix in forms and localized currency in the grid.",
  markdown: "Markdown editor. Renders styled markdown text via 'marked' library in cells and tabbed editor/preview in forms.",
  avatar: "User avatar. Renders a round profile image uploader/URL, or initials badge.",
  timezone: "Timezone picker. Renders local timezone list selection with active offsets.",
  tag: "Custom Tag. Renders dynamically colored tag pills in the grid, and autocompletes with existing database values in forms.",
};

export function WidgetsHelpDialog() {
  return (
    <Dialog>
      <DialogTrigger render={
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground shrink-0 animate-in fade-in-0 duration-200"
          title="Widget Guide"
        >
          <HelpCircle className="size-3.5" />
        </Button>
      } />
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Widget Guide</DialogTitle>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-4 mt-2">
          {widgets.map((w) => {
            const Icon = widgetIcons[w] || HelpCircle;
            return (
              <Card key={w} size="sm" className="p-3 gap-3 flex-row items-start">
                <div className="p-2 rounded bg-muted/60 text-muted-foreground shrink-0">
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm code capitalize mb-0.5">{w}</div>
                  <div className="text-[12px] text-muted-foreground leading-normal">
                    {WIDGET_DESCRIPTIONS[w] || "No description available."}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
