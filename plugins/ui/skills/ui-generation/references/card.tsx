import * as React from "react";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Card System — Few-Shot Example
// Demonstrates: hierarchy (3 levels), spacing rhythm, hover
// elevation, responsive behavior, content variants
// ============================================================

interface CardProps {
  title: string;
  description?: string;
  metadata?: string;
  badge?: { label: string; variant: "default" | "success" | "warning" | "error" };
  actions?: React.ReactNode;
  href?: string;
  className?: string;
  children?: React.ReactNode;
}

function Card({
  title,
  description,
  metadata,
  badge,
  actions,
  href,
  className,
  children,
}: CardProps) {
  const Wrapper = href ? "a" : "div";
  const wrapperProps = href
    ? { href, className: "block", target: "_blank", rel: "noopener noreferrer" }
    : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={cn(
        // Surface styling
        "rounded-xl border border-slate-100 bg-white",
        "shadow-sm",

        // Spacing — 24px padding, consistent with design tokens
        "p-6",

        // Hover elevation — cards lift on hover
        "transition-all duration-200 ease-in-out",
        href && "hover:shadow-md hover:-translate-y-0.5 hover:border-slate-200 cursor-pointer",

        // Focus for keyboard navigation
        href && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",

        className
      )}
    >
      {/* Header zone — PRIMARY hierarchy level */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* PRIMARY: Title — largest, boldest */}
          <h3 className="text-base font-medium text-slate-900 truncate">
            {title}
          </h3>

          {/* SECONDARY: Description — standard size, muted */}
          {description && (
            <p className="mt-1 text-sm text-slate-500 line-clamp-2">
              {description}
            </p>
          )}
        </div>

        {/* Badge or actions — SECONDARY */}
        <div className="flex items-center gap-2 shrink-0">
          {badge && (
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                {
                  default: "bg-slate-100 text-slate-600",
                  success: "bg-green-50 text-green-700",
                  warning: "bg-amber-50 text-amber-700",
                  error: "bg-red-50 text-red-700",
                }[badge.variant]
              )}
            >
              {badge.label}
            </span>
          )}

          {actions && (
            <div className="flex items-center gap-1">{actions}</div>
          )}

          {href && (
            <ExternalLink
              className="h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {/* Content zone — custom content slot */}
      {children && <div className="mt-4">{children}</div>}

      {/* Footer zone — TERTIARY hierarchy level */}
      {metadata && (
        <p className="mt-4 text-xs text-slate-400">
          {metadata}
        </p>
      )}
    </Wrapper>
  );
}

// ============================================================
// Card Skeleton — Loading state
// ============================================================

function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-100 bg-white p-6",
        "animate-pulse",
        className
      )}
      aria-hidden="true"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/5 bg-slate-200 rounded" />
          <div className="h-3 w-4/5 bg-slate-100 rounded" />
        </div>
        <div className="h-5 w-16 bg-slate-100 rounded-full" />
      </div>
      <div className="mt-4 space-y-2">
        <div className="h-3 w-full bg-slate-100 rounded" />
        <div className="h-3 w-2/3 bg-slate-100 rounded" />
      </div>
      <div className="mt-4 h-3 w-1/4 bg-slate-100 rounded" />
    </div>
  );
}

export { Card, CardSkeleton };
export type { CardProps };

// ============================================================
// Usage Examples
// ============================================================
//
// {/* Basic card with hierarchy */}
// <Card
//   title="Q4 Revenue Report"
//   description="Quarterly financial analysis with year-over-year comparison"
//   metadata="Updated 2 hours ago"
//   badge={{ label: "Published", variant: "success" }}
// />
//
// {/* Clickable card */}
// <Card
//   title="Documentation"
//   description="API reference and integration guides"
//   href="https://docs.example.com"
// />
//
// {/* Card grid — responsive */}
// <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
//   {items.map(item => <Card key={item.id} {...item} />)}
// </div>
//
// {/* Loading state */}
// <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
//   {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
// </div>
