import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { showDefaultClose?: boolean }
>(({ className, children, showDefaultClose = true, ...props }, ref) => {
  const { t } = useTranslation("common")
  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Centred positioning: left-[50%] + translate-x-[-50%] work symmetrically
        // in both LTR and RTL — no logical replacement needed for the centering.
        "fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-1.5rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4",
        "max-h-[calc(100dvh-1.5rem)] overflow-y-auto",
        "border border-card-border bg-card p-4 sm:p-6 shadow-xl rounded-xl",
        "duration-200",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
        "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
        className
      )}
      {...props}
    >
      {children}
      {/* end-3: logical-end positioning — right in LTR, left in RTL */}
      {showDefaultClose && (
        <DialogPrimitive.Close
          aria-label={t("close")}
          className="absolute end-3 top-3 flex h-8 w-8 items-center justify-center rounded-md opacity-60 ring-offset-background transition-all hover:opacity-100 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:text-muted-foreground"
        >
          <X className="h-[15px] w-[15px]" />
          <span className="sr-only">{t("close")}</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // text-start: logical — left-aligned in LTR, right-aligned in RTL
      "flex flex-col space-y-1.5 text-start",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // sm:justify-end keeps primary action at the logical end in both directions
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-foreground",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground leading-relaxed", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
