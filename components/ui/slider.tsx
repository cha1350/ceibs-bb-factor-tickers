"use client";
import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";
export function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn(
        "relative flex w-full touch-none select-none items-center h-5",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[var(--border)]">
        <SliderPrimitive.Range className="absolute h-full bg-teal-400" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        className="block size-3.5 rounded-full border-2 border-teal-400 bg-[var(--panel)] shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
      />
    </SliderPrimitive.Root>
  );
}
