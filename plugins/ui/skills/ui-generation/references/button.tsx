import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Button System — Few-Shot Example
// Demonstrates: variants, sizes, states, micro-interactions,
// accessibility, loading, icon support, hierarchy
// ============================================================

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      icon,
      iconPosition = "left",
      disabled,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={cn(
          // Base
          "inline-flex items-center justify-center gap-2 font-medium",
          "rounded-lg transition-all duration-150 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "disabled:opacity-50 disabled:cursor-not-allowed",

          // Micro-interactions (disabled when loading or disabled)
          !isDisabled && "hover:scale-[1.02] active:scale-[0.98]",

          // Sizes — all meet 44px min touch target
          {
            sm: "h-9 px-3 text-sm min-w-[44px]",
            md: "h-11 px-4 text-sm min-w-[44px]",
            lg: "h-12 px-6 text-base min-w-[44px]",
          }[size],

          // Variants — clear hierarchy: primary > secondary > ghost
          {
            primary: cn(
              "bg-blue-500 text-white shadow-sm",
              "hover:bg-blue-600",
              "focus-visible:ring-blue-500"
            ),
            secondary: cn(
              "border border-slate-200 bg-white text-slate-700 shadow-sm",
              "hover:bg-slate-50 hover:border-slate-300",
              "focus-visible:ring-slate-400"
            ),
            ghost: cn(
              "text-slate-500",
              "hover:bg-slate-100 hover:text-slate-700",
              "focus-visible:ring-slate-400"
            ),
            danger: cn(
              "bg-red-500 text-white shadow-sm",
              "hover:bg-red-600",
              "focus-visible:ring-red-500"
            ),
          }[variant],

          className
        )}
        {...props}
      >
        {/* Loading spinner replaces left icon */}
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          icon &&
          iconPosition === "left" && (
            <span className="shrink-0" aria-hidden="true">
              {icon}
            </span>
          )
        )}

        {children}

        {/* Right icon (not shown when loading) */}
        {!loading && icon && iconPosition === "right" && (
          <span className="shrink-0" aria-hidden="true">
            {icon}
          </span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

export { Button };
export type { ButtonProps };

// ============================================================
// Usage Examples — Hierarchy demonstration
// ============================================================
//
// <div className="flex items-center gap-3">
//   {/* PRIMARY action — most prominent */}
//   <Button variant="primary" icon={<Plus className="h-4 w-4" />}>
//     Create Project
//   </Button>
//
//   {/* SECONDARY action — visible but subordinate */}
//   <Button variant="secondary">
//     Import
//   </Button>
//
//   {/* TERTIARY action — minimal visual weight */}
//   <Button variant="ghost" size="sm">
//     Cancel
//   </Button>
// </div>
//
// {/* Loading state */}
// <Button loading>Saving...</Button>
//
// {/* Danger action */}
// <Button variant="danger" icon={<Trash2 className="h-4 w-4" />}>
//   Delete
// </Button>
