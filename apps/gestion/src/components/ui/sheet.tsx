'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';

import { cn } from '@/lib/utils';

const Sheet = DialogPrimitive.Root;
const SheetClose = DialogPrimitive.Close;

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-foreground/25 transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <DialogPrimitive.Popup
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-[min(19rem,calc(100vw-3rem))] border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl outline-none transition-transform duration-200 data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

const SheetTitle = DialogPrimitive.Title;

export { Sheet, SheetClose, SheetContent, SheetTitle };
