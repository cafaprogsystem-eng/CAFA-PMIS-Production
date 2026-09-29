"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Not "toast": HeroUI's own .toast styles hide the content of any element
      // with that class that isn't its frontmost toast, leaving Sonner toasts blank.
      toastOptions={{
        classNames: {
          toast:
            "group app-toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.app-toast]:text-muted-foreground",
          actionButton:
            "group-[.app-toast]:bg-primary group-[.app-toast]:text-primary-foreground",
          cancelButton:
            "group-[.app-toast]:bg-muted group-[.app-toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
