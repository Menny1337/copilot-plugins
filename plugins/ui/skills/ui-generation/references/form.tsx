import * as React from "react";
import { AlertCircle, Check, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Form System — Few-Shot Example
// Demonstrates: validation states, error feedback, accessibility,
// label association, touch targets, inline validation
// ============================================================

// --- Input Component ---

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  success?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, success, className, id, ...props }, ref) => {
    const inputId = id || `input-${label.toLowerCase().replace(/\s+/g, "-")}`;
    const errorId = error ? `${inputId}-error` : undefined;
    const hintId = hint ? `${inputId}-hint` : undefined;

    return (
      <div className="space-y-1.5">
        {/* Label — always associated with input */}
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-slate-700"
        >
          {label}
          {props.required && (
            <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>
          )}
        </label>

        {/* Input — 44px min height for touch targets */}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            aria-invalid={!!error}
            aria-describedby={
              [errorId, hintId].filter(Boolean).join(" ") || undefined
            }
            className={cn(
              // Base
              "w-full px-3 py-2 min-h-[44px] rounded-lg border",
              "text-sm text-slate-900 placeholder:text-slate-400",
              "transition-colors duration-150",

              // Focus
              "focus:outline-none focus:ring-2 focus:ring-offset-0",

              // States
              error
                ? "border-red-500 focus:ring-red-500/20 focus:border-red-500"
                : success
                  ? "border-green-500 focus:ring-green-500/20 focus:border-green-500"
                  : "border-slate-200 focus:ring-blue-500/20 focus:border-blue-500",

              // Disabled
              "disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed",

              className
            )}
            {...props}
          />

          {/* State indicator icon */}
          {(error || success) && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {error ? (
                <AlertCircle className="h-4 w-4 text-red-500" aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4 text-green-500" aria-hidden="true" />
              )}
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <p id={errorId} className="text-sm text-red-500 flex items-center gap-1" role="alert">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        {/* Hint text */}
        {hint && !error && (
          <p id={hintId} className="text-xs text-slate-400">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

// --- Password Input (with toggle) ---

const PasswordInput = React.forwardRef<HTMLInputElement, Omit<InputProps, "type">>(
  (props, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="relative">
        <Input ref={ref} type={visible ? "text" : "password"} {...props} />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className={cn(
            "absolute right-3 top-[38px] -translate-y-1/2",
            "p-1 rounded text-slate-400 hover:text-slate-600",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          )}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    );
  }
);

PasswordInput.displayName = "PasswordInput";

// --- Select Component ---

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, id, ...props }, ref) => {
    const selectId = id || `select-${label.toLowerCase().replace(/\s+/g, "-")}`;
    const errorId = error ? `${selectId}-error` : undefined;

    return (
      <div className="space-y-1.5">
        <label htmlFor={selectId} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
        <select
          ref={ref}
          id={selectId}
          aria-invalid={!!error}
          aria-describedby={errorId}
          className={cn(
            "w-full px-3 py-2 min-h-[44px] rounded-lg border",
            "text-sm text-slate-900 bg-white",
            "transition-colors duration-150",
            "focus:outline-none focus:ring-2 focus:ring-offset-0",
            error
              ? "border-red-500 focus:ring-red-500/20"
              : "border-slate-200 focus:ring-blue-500/20 focus:border-blue-500",
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={errorId} className="text-sm text-red-500 flex items-center gap-1" role="alert">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";

// --- Form Layout Example ---

interface FormExampleProps {
  onSubmit: (data: FormData) => Promise<void>;
}

function SettingsForm({ onSubmit }: FormExampleProps) {
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const formData = new FormData(e.currentTarget);
    await onSubmit(formData);
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>
      {/* Section — grouped with tight spacing inside, loose between sections */}
      <fieldset className="space-y-4">
        <legend className="text-lg font-medium text-slate-900 mb-2">
          Profile Information
        </legend>

        {/* 2-column grid on desktop, stack on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="First Name"
            name="firstName"
            placeholder="Enter your first name"
            error={errors.firstName}
            required
          />
          <Input
            label="Last Name"
            name="lastName"
            placeholder="Enter your last name"
            error={errors.lastName}
            required
          />
        </div>

        <Input
          label="Email Address"
          name="email"
          type="email"
          placeholder="you@company.com"
          error={errors.email}
          hint="We'll use this for account notifications"
          required
        />

        <Select
          label="Role"
          name="role"
          placeholder="Select your role"
          error={errors.role}
          options={[
            { value: "engineer", label: "Engineer" },
            { value: "designer", label: "Designer" },
            { value: "manager", label: "Manager" },
            { value: "other", label: "Other" },
          ]}
        />
      </fieldset>

      {/* Divider between sections */}
      <hr className="border-slate-100" />

      <fieldset className="space-y-4">
        <legend className="text-lg font-medium text-slate-900 mb-2">
          Security
        </legend>
        <PasswordInput
          label="Current Password"
          name="currentPassword"
          error={errors.currentPassword}
        />
        <PasswordInput
          label="New Password"
          name="newPassword"
          hint="Minimum 12 characters with uppercase, lowercase, and number"
          error={errors.newPassword}
        />
      </fieldset>

      {/* Action bar — sticky footer with clear hierarchy */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button
          type="button"
          className={cn(
            "px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium",
            "text-slate-500 hover:text-slate-700 hover:bg-slate-100",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          )}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className={cn(
            "px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium",
            "bg-blue-500 text-white shadow-sm",
            "hover:bg-blue-600 hover:scale-[1.02]",
            "active:scale-[0.98]",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100",
            "transition-all duration-150 ease-out",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          )}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

export { Input, PasswordInput, Select, SettingsForm };
export type { InputProps, SelectProps };
