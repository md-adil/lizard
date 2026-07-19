import { Fragment } from "react";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export interface BreadcrumbsProps {
  items: { label: string; link?: string }[];
  className?: string;
}

// Every page's trail roots at "Home" (/) — established by the existing
// app/browse/** pages, none of which ever root at a section name like
// "Browse". The last item renders as the current (unlinked) page regardless
// of whether it has a link, matching that same convention.
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <Fragment key={i}>
              <BreadcrumbItem>
                {!isLast && item.link ? (
                  <BreadcrumbLink render={<Link href={item.link} />}>{item.label}</BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
