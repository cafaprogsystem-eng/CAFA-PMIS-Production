/**
 * HeroUI Pro reference page — development only, never built.
 *
 * Renders the documentation examples for AppLayout (with its Navbar and
 * Sidebar), Segment and Stepper verbatim on a stock HeroUI Pro setup, so the
 * CAFA versions can be compared against the original look, with the same
 * Gravity UI icons the docs use.
 *
 *   /pro-reference.html?c=app|groups|segment|stepper[&dir=rtl]
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "react-aria-components";
import { Avatar, Breadcrumbs, Button, Chip, Dropdown, Label, Separator } from "@heroui/react";
import { AppLayout } from "@heroui-pro/react/app-layout";
import { Navbar } from "@heroui-pro/react/navbar";
import { Sidebar } from "@heroui-pro/react/sidebar";
import { Segment } from "@heroui-pro/react/segment";
import { Stepper } from "@heroui-pro/react/stepper";
import ArrowRightFromSquare from "@gravity-ui/icons/ArrowRightFromSquare";
import Bell from "@gravity-ui/icons/Bell";
import ChartColumn from "@gravity-ui/icons/ChartColumn";
import CircleQuestion from "@gravity-ui/icons/CircleQuestion";
import Gear from "@gravity-ui/icons/Gear";
import House from "@gravity-ui/icons/House";
import LayoutList from "@gravity-ui/icons/LayoutList";
import ListCheck from "@gravity-ui/icons/ListCheck";
import Magnifier from "@gravity-ui/icons/Magnifier";
import Person from "@gravity-ui/icons/Person";
import Persons from "@gravity-ui/icons/Persons";
import Receipt from "@gravity-ui/icons/Receipt";
import "./ref.css";

const params = new URLSearchParams(location.search);
const which = params.get("c") ?? "app";
const rtl = params.get("dir") === "rtl";
document.documentElement.dir = rtl ? "rtl" : "ltr";
document.documentElement.lang = rtl ? "ar" : "en";

/* ── AppLayout › Usage (Default) ─────────────────────────────────────── */
const BreadcrumbItems = [{ icon: <House className="size-4" />, label: "Dashboard" }];
const navItems = [
  { icon: House, label: "Dashboard" },
  { icon: ChartColumn, items: ["Overview", "Reports", "Conversions"], label: "Analytics" },
  { badge: "New", icon: ListCheck, label: "Tracker" },
  { icon: Gear, items: ["General", "Team", "Notifications"], label: "Settings" },
];

function NavTree({ mobile = false }: { mobile?: boolean }) {
  return (
    <Sidebar.Menu aria-label="Navigation" defaultExpandedKeys={["Analytics"]}>
      {navItems.map((item) => (
        <Sidebar.MenuItem
          key={item.label}
          href={item.items ? undefined : "#"}
          id={item.label}
          isCurrent={!mobile && item.label === "Dashboard"}
          textValue={item.label}
        >
          <Sidebar.MenuIcon><item.icon className="size-4" /></Sidebar.MenuIcon>
          <Sidebar.MenuLabel>
            {item.label}
            {item.items ? <Sidebar.MenuTrigger><Sidebar.MenuIndicator /></Sidebar.MenuTrigger> : null}
          </Sidebar.MenuLabel>
          {item.badge ? (
            <Sidebar.MenuChip><Chip color="success" size="sm" variant="soft">{item.badge}</Chip></Sidebar.MenuChip>
          ) : null}
          {item.items ? (
            <Sidebar.Submenu>
              {item.items.map((subitem) => (
                <Sidebar.MenuItem key={subitem} href="#" id={`${item.label}-${subitem}`} textValue={subitem}>
                  <Sidebar.MenuLabel>{subitem}</Sidebar.MenuLabel>
                </Sidebar.MenuItem>
              ))}
            </Sidebar.Submenu>
          ) : null}
        </Sidebar.MenuItem>
      ))}
    </Sidebar.Menu>
  );
}

function Brand({ label = true }: { label?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <div className="bg-accent flex size-6 shrink-0 items-center justify-center rounded-md">
        <span className="text-sm font-bold text-white">H</span>
      </div>
      <span className="text-foreground text-sm font-semibold" {...(label ? { "data-sidebar": "label" } : {})}>HeroUI</span>
    </div>
  );
}

function DemoSidebar() {
  return (
    <>
      <Sidebar>
        <Sidebar.Header><Brand /></Sidebar.Header>
        <Sidebar.Content><Sidebar.Group><NavTree /></Sidebar.Group></Sidebar.Content>
        <Sidebar.Footer>
          <Sidebar.Menu aria-label="Footer actions">
            <Sidebar.MenuItem href="#" id="help" textValue="Help & Information">
              <Sidebar.MenuIcon><CircleQuestion className="size-4" /></Sidebar.MenuIcon>
              <Sidebar.MenuLabel>Help & Information</Sidebar.MenuLabel>
            </Sidebar.MenuItem>
            <Sidebar.MenuItem href="#" id="logout" textValue="Log out">
              <Sidebar.MenuIcon><ArrowRightFromSquare className="size-4" /></Sidebar.MenuIcon>
              <Sidebar.MenuLabel>Log out</Sidebar.MenuLabel>
            </Sidebar.MenuItem>
          </Sidebar.Menu>
        </Sidebar.Footer>
        <Sidebar.Rail />
      </Sidebar>
      <Sidebar.Mobile>
        <Sidebar.Header><Brand label={false} /></Sidebar.Header>
        <Sidebar.Content><Sidebar.Group><NavTree mobile /></Sidebar.Group></Sidebar.Content>
      </Sidebar.Mobile>
    </>
  );
}

function DemoNavbar() {
  return (
    <Navbar maxWidth="full">
      <Navbar.Header>
        <AppLayout.MenuToggle />
        <Sidebar.Trigger />
        <Breadcrumbs className="min-w-0">
          {BreadcrumbItems.map((item, index) => (
            <Breadcrumbs.Item key={`${item.label}-${index}`} className="min-w-0 font-semibold">
              <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                {item.icon}
                <span className="truncate">{item.label}</span>
              </span>
            </Breadcrumbs.Item>
          ))}
        </Breadcrumbs>
        <Navbar.Spacer />
        <Navbar.Content>
          <Navbar.Item aria-label="Search"><Magnifier className="size-4" /></Navbar.Item>
          <Navbar.Item aria-label="Notifications"><Bell className="size-4" /></Navbar.Item>
          <Navbar.Separator />
          <Dropdown>
            <Button isIconOnly aria-label="Account menu" variant="ghost">
              <Avatar className="size-6" color="success" variant="soft">
                <Avatar.Fallback className="text-xs font-semibold">JG</Avatar.Fallback>
              </Avatar>
            </Button>
            <Dropdown.Popover className="min-w-[200px]" placement="bottom end">
              <Dropdown.Menu>
                <Dropdown.Item id="account" textValue="Account"><Person className="text-muted size-4" /><Label>Account</Label></Dropdown.Item>
                <Dropdown.Item id="settings" textValue="Settings"><Gear className="text-muted size-4" /><Label>Settings</Label></Dropdown.Item>
                <Separator />
                <Dropdown.Item id="sign-out" textValue="Log out"><ArrowRightFromSquare className="text-muted size-4" /><Label>Log out</Label></Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </Navbar.Content>
      </Navbar.Header>
    </Navbar>
  );
}

function AppLayoutDefault() {
  return (
    <AppLayout navbar={<DemoNavbar />} sidebar={<DemoSidebar />} sidebarSide={rtl ? "right" : "left"}>
      <div className="p-6">
        <h1 className="text-foreground text-xl font-semibold">Dashboard</h1>
        <p className="text-muted mt-2 text-sm">
          The sidebar fills the full viewport height while the navbar and main content live in the
          right column. Resize to mobile to see the sidebar collapse into a sheet.
        </p>
      </div>
    </AppLayout>
  );
}

/* ── Sidebar › With Groups ───────────────────────────────────────────── */
function SidebarWithGroups() {
  const item = (id: string, label: string, Icon: typeof House) => (
    <Sidebar.MenuItem id={id} textValue={label}>
      <Sidebar.MenuIcon><Icon className="size-4" /></Sidebar.MenuIcon>
      <Sidebar.MenuLabel>{label}</Sidebar.MenuLabel>
    </Sidebar.MenuItem>
  );
  return (
    <Sidebar.Provider side={rtl ? "right" : "left"}>
      <Sidebar>
        <Sidebar.Header><Brand /></Sidebar.Header>
        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.GroupLabel>Platform</Sidebar.GroupLabel>
            <Sidebar.Menu aria-label="Platform">
              {item("dashboard", "Dashboard", House)}
              {item("analytics", "Analytics", ChartColumn)}
              {item("orders", "Orders", Receipt)}
            </Sidebar.Menu>
          </Sidebar.Group>
          <Sidebar.Separator />
          <Sidebar.Group>
            <Sidebar.GroupLabel>Settings</Sidebar.GroupLabel>
            <Sidebar.Menu aria-label="Settings">
              {item("general", "General", Gear)}
              {item("team", "Team", Persons)}
              {item("notifications", "Notifications", Bell)}
            </Sidebar.Menu>
          </Sidebar.Group>
        </Sidebar.Content>
      </Sidebar>
      <Sidebar.Main><div className="p-6"><p className="text-muted">Main content area</p></div></Sidebar.Main>
    </Sidebar.Provider>
  );
}

/* ── Segment › Usage, With Icons, Sizes ──────────────────────────────── */
const tabs = [
  { id: "dashboard", label: "Dashboard" }, { id: "analytics", label: "Analytics" },
  { id: "reports", label: "Reports" }, { id: "settings", label: "Settings" },
];
const iconTabs = [
  { icon: <LayoutList />, id: "dashboard", label: "Dashboard" },
  { icon: <ChartColumn />, id: "analytics", label: "Analytics" },
  { icon: <Person />, id: "team", label: "Team" },
  { icon: <Gear />, id: "settings", label: "Settings" },
];
function SegmentExamples() {
  return (
    <div className="flex flex-col items-start gap-8 p-8" data-ref="segment">
      <section data-example="default">
        <Segment defaultSelectedKey="dashboard">
          {tabs.map((tab) => <Segment.Item key={tab.id} id={tab.id}>{tab.label}</Segment.Item>)}
        </Segment>
      </section>
      <section data-example="icons">
        <Segment defaultSelectedKey="dashboard">
          {iconTabs.map((tab) => <Segment.Item key={tab.id} id={tab.id}>{tab.icon}{tab.label}</Segment.Item>)}
        </Segment>
      </section>
      <section data-example="sizes" className="flex flex-col items-start gap-6">
        {(["sm", "md", "lg"] as const).map((size) => (
          <div key={size} className="flex flex-col gap-2">
            <span className="text-muted text-xs">{size}</span>
            <Segment defaultSelectedKey="dashboard" size={size}>
              {tabs.map((tab) => <Segment.Item key={tab.id} id={tab.id}>{tab.label}</Segment.Item>)}
            </Segment>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ── Stepper › Usage, With Descriptions ──────────────────────────────── */
const steps = [{ title: "Cart" }, { title: "Shipping" }, { title: "Payment" }, { title: "Confirmation" }];
const described = [
  { description: "Create your account", title: "Account" },
  { description: "Set up your profile", title: "Profile" },
  { description: "Configure preferences", title: "Settings" },
  { description: "Review and confirm", title: "Review" },
];
function StepperExamples() {
  const [step, setStep] = useState(1);
  const [step2, setStep2] = useState(1);
  return (
    <div className="flex flex-col gap-10 p-8" data-ref="stepper">
      <div className="w-[500px]" data-example="default">
        <Stepper currentStep={step} onStepChange={setStep}>
          {steps.map((s) => (
            <Stepper.Step key={s.title}>
              <Stepper.Indicator />
              <Stepper.Content><Stepper.Title>{s.title}</Stepper.Title></Stepper.Content>
              <Stepper.Separator />
            </Stepper.Step>
          ))}
        </Stepper>
      </div>
      <div className="w-[600px]" data-example="descriptions">
        <Stepper currentStep={step2} onStepChange={setStep2}>
          {described.map((s) => (
            <Stepper.Step key={s.title}>
              <Stepper.Indicator />
              <Stepper.Content>
                <Stepper.Title>{s.title}</Stepper.Title>
                <Stepper.Description>{s.description}</Stepper.Description>
              </Stepper.Content>
              <Stepper.Separator />
            </Stepper.Step>
          ))}
        </Stepper>
      </div>
    </div>
  );
}

const View = which === "groups" ? SidebarWithGroups : which === "segment" ? SegmentExamples : which === "stepper" ? StepperExamples : AppLayoutDefault;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider locale={rtl ? "ar-u-nu-latn" : "en-US"}>
      <View />
    </I18nProvider>
  </StrictMode>,
);
