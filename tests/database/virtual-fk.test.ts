import { describe, it, expect } from "vitest";
import { vfkSummary } from "@/lib/introspect/virtual-fk";
import type { VirtualFk } from "@/lib/types";

describe("Virtual FK summary and formatting", () => {
  it("renders summary with both source and target constraints", () => {
    const vfk: VirtualFk = {
      id: "test-vfk",
      fromConnection: "local",
      fromSchema: "public",
      fromTable: "comments",
      toConnection: "local",
      toSchema: "public",
      toTable: "posts",
      pairs: [
        { from: "commentable_id", to: "id", transform: "none" }
      ],
      constants: [
        { toColumn: "commentable_type", value: "App\\Models\\Post", side: "source" },
        { toColumn: "status", value: "published", side: "target" }
      ],
      label: "Post Comments",
      joinHint: null
    };

    const summary = vfkSummary(vfk);
    expect(summary).toContain("comments.commentable_type='App\\Models\\Post'");
    expect(summary).toContain("posts.status='published'");
    expect(summary).toContain("local.public.posts ON commentable_id = id");
  });
});
