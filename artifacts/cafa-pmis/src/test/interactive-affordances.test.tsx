import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Accordion, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { Circle } from "lucide-react";

describe("shared interactive affordances", () => {
  it("marks enabled semantic controls as actionable and disabled controls as unavailable", () => {
    render(
      <div>
        <Button>Save</Button>
        <Button disabled>Unavailable</Button>
        <Tabs defaultValue="first"><TabsList><TabsTrigger value="first">First tab</TabsTrigger></TabsList></Tabs>
        <Toggle aria-label="Pin item">Pin</Toggle>
        <Select><SelectTrigger aria-label="Choose option"><SelectValue placeholder="Choose" /></SelectTrigger></Select>
        <Accordion type="single" collapsible><AccordionItem value="details"><AccordionTrigger>Details</AccordionTrigger></AccordionItem></Accordion>
      </div>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("cursor-pointer");
    expect(screen.getByRole("button", { name: "Unavailable" })).toHaveClass("disabled:cursor-not-allowed");
    expect(screen.getByRole("tab", { name: "First tab" })).toHaveClass("cursor-pointer");
    expect(screen.getByRole("button", { name: "Pin item" })).toHaveClass("cursor-pointer");
    expect(screen.getByRole("combobox", { name: "Choose option" })).toHaveClass("cursor-pointer");
    expect(screen.getByRole("button", { name: "Details" })).toHaveClass("cursor-pointer", "focus-visible:ring-2");
  });

  it("keeps static cards static while giving linked and clicked cards a visible focusable control", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <div>
        <StatCard icon={Circle} label="Static total" value={12} />
        <StatCard icon={Circle} label="Open records" value={4} onClick={onOpen} />
      </div>,
    );

    const interactiveCard = screen.getByRole("button", { name: "Open records" });
    expect(interactiveCard).toHaveClass("cursor-pointer", "focus-visible:ring-2");
    fireEvent.keyDown(interactiveCard, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(screen.getByText("Static total").closest("div")?.className).not.toContain("cursor-pointer");
  });
});