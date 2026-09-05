import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  (
    {
      className,
      checked = false,
      onCheckedChange,
      onClick,
      disabled = false,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      onClick?.(e);
      onCheckedChange?.(!checked);
    };

    return (
      <button
        ref={ref}
        type={type}
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "h-4 w-4 rounded-xs border transition-all flex items-center justify-center font-mono cursor-pointer select-none focus:outline-none focus:ring-1 focus:ring-primary/50",
          checked
            ? "bg-primary border-primary text-primary-foreground shadow-xs"
            : "border-muted-foreground/50 bg-background/90 hover:border-foreground/80 dark:bg-card",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
        {...props}
      >
        {checked && <Check className="h-3 w-3 stroke-[3]" />}
      </button>
    );
  },
);
Checkbox.displayName = "Checkbox";
