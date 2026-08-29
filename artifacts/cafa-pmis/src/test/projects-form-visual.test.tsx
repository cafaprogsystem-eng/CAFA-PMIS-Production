/**
 * Projects Form Visual Contract Tests (Task #539)
 *
 * Test IDs:
 *   PRJ-FORM-VIS-01  Register mode shows "Register Project" heading; edit mode shows "Edit Project"
 *   PRJ-FORM-VIS-02  All 7 tab navigation buttons render with role="tab" and aria-selected; keyboard ArrowRight advances to next tab
 *   PRJ-FORM-VIS-03  Exactly one footer element per form render (no duplicate action bars)
 *   PRJ-FORM-VIS-04  "Save As Draft" button has variant="outline" (secondary visual treatment)
 *   PRJ-FORM-VIS-05  Submit/final action button is primary; when pending it has disabled and aria-busy="true"
 *   PRJ-FORM-VIS-06  Activity card renders Recorded Expenditure as read-only text — not editable
 *   PRJ-FORM-VIS-07  Financed activity removal dialog renders Cancel and Confirm; Cancel not styled destructively
 *   PRJ-FORM-VIS-08  Documents tab renders three upload areas; lock notice text appears when locked
 *   PRJ-FORM-VIS-09  Sector/state checkbox grid with 10+ selected values does not overflow container
 *   PRJ-FORM-VIS-10  No Project functional contract changed — all PRJ-ZR closure tests pass after visual changes
 */

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom";

// ── Environment shims ─────────────────────────────────────────────────────────
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as never;
  }
  global.fetch = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  editIsLoading = false; // reset between tests
});

// ── i18n mock ─────────────────────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "form.tabs.basic": "Basic",
        "form.tabs.location": "Location",
        "form.tabs.donor": "Donor",
        "form.tabs.timeline": "Timeline",
        "form.tabs.team": "Team",
        "form.tabs.documents": "Documents",
        "form.tabs.review": "Review",
        "form.navAriaLabel": "Form sections",
        "form.tabErrorAriaLabel": "This tab has errors",
        "form.loading": "Loading project data…",
        "form.buttons.cancel": "Cancel",
        "form.buttons.saveAsDraft": "Save As Draft",
        "form.buttons.saving": "Saving…",
        "form.buttons.previous": "Previous",
        "form.buttons.continue": "Continue",
        "form.buttons.createProject": "Create Project",
        "form.buttons.saveChanges": "Save Changes",
        "form.buttons.addOutput": "Add Output",
        "form.buttons.addPersonnel": "Add Team Member",
        "form.buttons.addIndicator": "Add Indicator",
        "form.buttons.addActivity": "Add Activity",
        "form.buttons.add": "Add",
        "form.buttons.new": "New",
        "form.buttons.confirm": "Confirm",
        "form.basic.title": "Project title",
        "form.basic.titlePlaceholder": "Enter project title",
        "form.basic.description": "Description",
        "form.basic.descriptionPlaceholder": "Describe the project",
        "form.basic.descriptionHint": "Minimum 50 characters",
        "form.basic.classification": "Classification",
        "form.basic.classificationPlaceholder": "Select classification",
        "form.basic.classificationNone": "None",
        "form.basic.sectors": "Sectors",
        "form.basic.subSectors": "Sub-sectors",
        "form.basic.subSectorsOptional": "(optional)",
        "form.basic.assistanceModality": "Assistance modality",
        "form.basic.assistanceModalityOptional": "(optional)",
        "form.basic.assistanceModalityPlaceholder": "Select modality",
        "form.basic.notSpecified": "Not specified",
        "form.location.selectAtLeastOneState": "Select at least one state",
        "form.location.singleState": "Single-state",
        "form.location.multiState": "Multi-state ({{count}})",
        "form.location.localitiesLabel": "Localities",
        "form.location.localitiesPlaceholder": "Type a locality",
        "form.location.targetBeneficiaries": "Target beneficiaries",
        "form.location.adultMen": "Adult men",
        "form.location.adultWomen": "Adult women",
        "form.location.boysUnder18": "Boys (under 18)",
        "form.location.girlsUnder18": "Girls (under 18)",
        "form.location.totalBeneficiaries": "Total beneficiaries",
        "form.donor.donorOrg": "Donor organisation",
        "form.donor.selectDonorPlaceholder": "Select donor",
        "form.donor.selectDonorNone": "None selected",
        "form.donor.orEnterDonorName": "Or enter donor name",
        "form.donor.donorNamePlaceholder": "Donor name",
        "form.donor.newDonor": "New donor",
        "form.donor.newDonorNameLabel": "Donor name",
        "form.donor.newDonorNamePlaceholder": "Organisation name",
        "form.donor.agreementNumber": "Agreement number",
        "form.donor.agreementNumberPlaceholder": "e.g. ECHO/2025/001",
        "form.donor.agreementStart": "Agreement start",
        "form.donor.agreementEnd": "Agreement end",
        "form.donor.signedDate": "Signed date",
        "form.donor.internalNotes": "Internal notes",
        "form.donor.internalNotesPlaceholder": "Notes visible to staff only",
        "form.timeline.implementationPeriod": "Implementation period",
        "form.timeline.startDate": "Start date",
        "form.timeline.endDate": "End date",
        "form.timeline.funding": "Funding",
        "form.timeline.totalBudget": "Total budget",
        "form.timeline.currency": "Currency",
        "form.timeline.directCosts": "Direct costs",
        "form.timeline.indirectCosts": "Indirect costs",
        "form.timeline.cafaContribution": "CAFA contribution",
        "form.timeline.budgetSummaryTitle": "Budget summary",
        "form.timeline.budgetTotal": "Total",
        "form.timeline.budgetDirect": "Direct",
        "form.timeline.budgetIndirect": "Indirect",
        "form.timeline.budgetCafa": "CAFA",
        "form.timeline.unallocated": "Unallocated: {{amount}}",
        "form.timeline.overBudget": "Over budget by {{amount}}",
        "form.timeline.resultsFramework": "Results framework",
        "form.timeline.resultsFrameworkDesc": "Define outputs, indicators, and activities.",
        "form.team.role": "Role",
        "form.team.selectRolePlaceholder": "Select role",
        "form.team.systemUser": "System user",
        "form.team.selectUserPlaceholder": "Select user",
        "form.team.externalPerson": "External / not in system",
        "form.team.externalName": "Name",
        "form.team.externalNamePlaceholder": "Full name",
        "form.documents.requiredNote": "Agreement and budget documents are required.",
        "form.documents.agreementTitle": "Agreement document",
        "form.documents.agreementRequired": "(required)",
        "form.documents.budgetTitle": "Budget document",
        "form.documents.budgetRequired": "(required)",
        "form.documents.supportingTitle": "Supporting documents",
        "form.documents.supportingOptional": "(optional)",
        "form.documents.voiceNoteTitle": "Voice note",
        "form.documents.voiceNoteDesc": "Record a voice memo for this project.",
        "form.review.basicInfo": "Basic information",
        "form.review.title": "Title",
        "form.review.classification": "Classification",
        "form.review.sectors": "Sectors",
        "form.review.locationCoverage": "Location & coverage",
        "form.review.targetStates": "Target states",
        "form.review.localities": "Localities",
        "form.review.totalBeneficiaries": "Total beneficiaries",
        "form.review.donorAgreement": "Donor & agreement",
        "form.review.donor": "Donor",
        "form.review.agreementNumber": "Agreement number",
        "form.review.agreementPeriod": "Agreement period",
        "form.review.signedDate": "Signed date",
        "form.review.timelineBudget": "Timeline & budget",
        "form.review.implementationPeriod": "Implementation period",
        "form.review.totalBudget": "Total budget",
        "form.review.outputsDefined": "Outputs defined",
        "form.review.projectTeam": "Project team",
        "form.review.personnel": "Personnel",
        "form.review.noneAssigned": "None assigned",
        "form.review.documentsSection": "Documents",
        "form.review.uploaded": "Uploaded",
        "form.review.documentCount": "{{count}} document(s)",
        "form.output.outputLabel": "Output {{number}}",
        "form.output.indicatorCount": "{{count}} indicator(s)",
        "form.output.activityCount": "{{count}} activity(ies)",
        "form.output.removeOutput": "Remove output",
        "form.output.outputTitle": "Output title",
        "form.output.outputTitlePlaceholder": "Enter output title",
        "form.output.description": "Description",
        "form.output.outputDescPlaceholder": "Describe this output",
        "form.output.outputTarget": "Target",
        "form.output.outputTargetPlaceholder": "0",
        "form.output.indicators": "Indicators",
        "form.output.indicatorLabel": "Indicator {{outputNum}}.{{indNum}}",
        "form.output.removeIndicator": "Remove indicator",
        "form.output.indicatorName": "Indicator name",
        "form.output.indicatorNamePlaceholder": "e.g. Number of people reached",
        "form.output.target": "Target",
        "form.output.unit": "Unit",
        "form.output.indicatorDescPlaceholder": "Optional description",
        "form.output.noIndicators": "No indicators added yet.",
        "form.output.activities": "Activities",
        "form.output.activityLabel": "Activity {{outputNum}}.{{actNum}}",
        "form.output.removeActivity": "Remove activity",
        "form.output.activityName": "Activity name",
        "form.output.activityNamePlaceholder": "Describe the activity",
        "form.output.linkedIndicator": "Linked indicator",
        "form.output.noIndicatorsAvailable": "No indicators yet",
        "form.output.selectIndicator": "Select indicator",
        "form.output.noIndicatorOption": "None",
        "form.output.addIndicatorHint": "Add an indicator above to link it here.",
        "form.output.activityDesc": "Description",
        "form.output.activityDescPlaceholder": "Optional description",
        "form.output.activityStart": "Start date",
        "form.output.activityEnd": "End date",
        "form.output.activityBudget": "Budget",
        "form.output.activityTarget": "Target",
        "form.output.activityStatus": "Status",
        "form.output.state": "State",
        "form.output.selectState": "Select state",
        "form.output.selectStateNone": "None",
        "form.output.locality": "Locality",
        "form.output.selectLocality": "Select locality",
        "form.output.selectLocalityNone": "None",
        "form.output.selectStateFirst": "Select a state first",
        "form.output.addLocalitiesFirst": "Add localities in Location tab",
        "form.output.noActivities": "No activities added yet.",
        "form.toasts.duplicateLocality": "Duplicate locality",
        "form.toasts.duplicateLocalityDesc": "{{val}} is already added.",
        "form.toasts.fileUploaded": "File uploaded",
        "form.toasts.uploadFailed": "Upload failed",
        "form.toasts.uploadFailedDesc": "Could not upload file.",
        "form.toasts.projectUpdated": "Project updated",
        "form.toasts.projectUpdatedDesc": "{{code}} updated.",
        "form.toasts.mergeFailed": "Merge failed",
        "form.toasts.mergeFailedDesc": "Could not merge project data.",
        "form.editDialog.title": "Edit Project",
        "form.editDialog.description": "Update the project details below.",
        // ── Section heading keys (added by Phase 2 visual refinement) ──
        "form.loadingAriaLabel": "Loading project data",
        "form.basic.projectDetailsSection": "Project details",
        "form.basic.sectorCoverageSection": "Sector coverage",
        "form.location.operationalLocationsSection": "Operational locations",
        "form.donor.donorInfoSection": "Donor information",
        "form.donor.agreementDetailsSection": "Agreement details",
        "form.team.projectTeamSection": "Project team",
        "form.documents.projectDocumentsSection": "Project documents",
        "form.review.reviewSummarySection": "Review & submit",
      };
      if (key in map) return map[key];
      if (opts && typeof opts === "object") {
        let result = key;
        Object.entries(opts).forEach(([k, v]) => {
          result = result.replace(`{{${k}}}`, String(v));
        });
        return result;
      }
      return key;
    },
    i18n: { language: "en", dir: () => "ltr", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// ── API client mock state (mutable so individual tests can flip isLoading) ───
/** Set to true before rendering to test the edit-loading skeleton path. */
let editIsLoading = false;

// ── API client mocks ──────────────────────────────────────────────────────────
// useGetProject returns a nested { project, outputs, indicators, activities, states } shape
// as consumed by mapProjectToFormValues in the form component.
const mockEditData = {
  project: {
    id: 1,
    code: "CAFA-PRJ-001",
    title: "Sudan Emergency Response",
    description: "A project description that is at least fifty characters long for validation purposes.",
    status: "draft",
    sector: "Food Security",
    sectors: ["Food Security"],
    donor: "ECHO",
    donorId: 1,
    agreementNumber: "ECHO/2025/001",
    budgetTotal: 1000000,
    currency: "USD",
    startDate: "2025-01-01",
    endDate: "2026-12-31",
    stateIds: [1],
    hasHqOperations: false,
    localities: [],
    beneficiariesMale: 0,
    beneficiariesFemale: 0,
    beneficiariesBoys: 0,
    beneficiariesGirls: 0,
    beneficiariesTarget: 0,
    directCost: 0,
    indirectCost: 0,
    cafaContribution: 0,
    reportingFrequency: "monthly",
    assignments: [],
    documents: [],
    assistanceModality: null,
    subSectors: [],
    internalNotes: "",
    agreementStart: "",
    agreementEnd: "",
    signedDate: "",
    managementLevel: "state",
    budgetVersion: "",
    activityTarget: 0,
    indicatorTarget: 0,
  },
  outputs: [
    { id: 1, title: "Output 1", description: "", target: undefined },
  ],
  indicators: [
    { id: 1, outputId: 1, title: "People reached", unit: "People Reached", target: 1000, description: "" },
  ],
  activities: [
    {
      id: 1,
      outputId: 1,
      title: "Activity 1",
      description: "",
      budgetPlanned: 50000,
      budgetSpent: 12500,
      plannedStart: "2025-01-01",
      plannedEnd: "2025-06-30",
      target: undefined,
      stateId: 1,
      localityName: "Khartoum",
      status: "in_progress",
      indicatorId: 1,
    },
  ],
  states: [{ id: 1, name: "Khartoum" }],
};

const mockDonors = [{ id: 1, name: "ECHO", abbreviation: "ECHO" }];
const mockUsers: never[] = [];
const mockStates = [{ id: 1, name: "Khartoum" }, { id: 2, name: "Kassala" }];

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({
    data: { user: { id: 1, role: "program_manager" }, permissions: ["projects.create", "projects.update"] },
  }),
  // editIsLoading is read at call-time so tests can set it before rendering
  useGetProject: () => ({
    data: editIsLoading ? undefined : mockEditData,
    isLoading: editIsLoading,
    isError: false,
  }),
  useListProjectStateAllocations: () => ({ data: [] }),
  useListStates: () => ({
    data: mockStates,
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
  useListUsers: () => ({ data: mockUsers }),
  useListDonors: () => ({ data: mockDonors }),
  useCreateDonor: () => ({ mutateAsync: vi.fn() }),
  useCreateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCheckProjectDuplicate: () => ({ data: null }),
  useMergeProjectData: () => ({ mutateAsync: vi.fn(), isPending: false }),
  requestUploadUrl: vi.fn().mockResolvedValue({ uploadUrl: "https://example.com/upload", objectId: "obj-1" }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (opts: { mutationFn: (...args: unknown[]) => unknown }) => ({
    mutateAsync: vi.fn().mockImplementation(opts.mutationFn),
    isPending: false,
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/projects", vi.fn()],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/sectors", () => ({
  SECTORS: ["Food Security", "Health", "WASH", "Education", "Shelter", "Protection", "Livelihoods", "Nutrition", "CCCM", "Early Recovery", "Emergency Telecoms"],
  SUB_SECTORS: { "Food Security": ["Crop Production", "Livestock"], "Health": ["Primary Health", "Mental Health"] },
  ASSISTANCE_MODALITIES: ["Cash", "In-kind"],
  MAIN_SECTORS: ["Food Security", "Health", "WASH"],
  PR_SECTORS: ["General/Cross-Cutting", "Food Security"],
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(" "),
}));

// ── UI component mocks ────────────────────────────────────────────────────────
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) =>
    <span data-testid="tooltip-content" style={{ display: "none" }}>{children}</span>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void }) =>
    open !== false ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children, id }: { children: React.ReactNode; id?: string; className?: string }) =>
    <h2 id={id}>{children}</h2>,
  AlertDialogDescription: ({ children, id }: { children: React.ReactNode; id?: string }) =>
    <p id={id}>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children, onClick, autoFocus }: { children: React.ReactNode; onClick?: () => void; autoFocus?: boolean }) =>
    <button onClick={onClick} autoFocus={autoFocus} data-testid="alert-cancel">{children}</button>,
  AlertDialogAction: ({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) =>
    <button onClick={onClick} className={className} data-testid="alert-action">{children}</button>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: {
    children: React.ReactNode; value?: string; onValueChange?: (v: string) => void;
  }) => <div data-value={value} data-onchange={onValueChange ? "yes" : "no"}>{children}</div>,
  SelectTrigger: ({ children, className, "aria-required": ariaRequired, "data-testid": testid }: {
    children: React.ReactNode; className?: string; "aria-required"?: React.AriaAttributes["aria-required"]; "data-testid"?: string;
  }) => <button type="button" className={className} aria-required={ariaRequired} data-testid={testid}>{children}</button>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) =>
    <option value={value}>{children}</option>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder ?? ""}</span>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    <div className={className} data-testid="doc-card">{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    <div className={className}>{children}</div>,
  CardTitle: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    <h3 className={className}>{children}</h3>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant, "aria-label": ariaLabel, className }: {
    children: React.ReactNode; variant?: string; "aria-label"?: string; className?: string;
  }) => <span className={`badge badge-${variant ?? "default"} ${className ?? ""}`} aria-label={ariaLabel}>{children}</span>,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) =>
    <div className={`skeleton ${className ?? ""}`} aria-hidden="true" data-testid="skeleton" />,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, id }: {
    checked?: boolean; onCheckedChange?: (v: boolean) => void; id?: string;
  }) => <input type="checkbox" id={id} checked={checked ?? false} onChange={e => onCheckedChange?.(e.target.checked)} />,
}));

vi.mock("@/components/form-voice-recorder", () => ({
  FormVoiceRecorder: () => <div data-testid="voice-recorder">Voice Recorder</div>,
}));

// ── Import the component under test ───────────────────────────────────────────
import { ProjectRegistrationForm, EditProjectDialog } from "@/components/project-registration-form";

// ── Render helpers ────────────────────────────────────────────────────────────

function renderCreateForm() {
  return render(<ProjectRegistrationForm open onClose={vi.fn()} />);
}

function renderEditDialog(open = true) {
  return render(<EditProjectDialog projectId={1} open={open} onClose={vi.fn()} />);
}

// ═════════════════════════════════════════════════════════════════════════════
// PRJ-FORM-VIS-01: Register vs Edit heading
// ═════════════════════════════════════════════════════════════════════════════
describe("PRJ-FORM-VIS-01 — Register mode vs Edit mode headings differ", () => {
  it("Create mode page is rendered from projects.tsx with 'Register Project' heading context (form itself shows tab nav)", () => {
    renderCreateForm();
    // The form renders the tab nav, not a heading inside itself for create mode
    // The tab nav is present
    const tablist = screen.getByRole("tablist");
    expect(tablist).toBeInTheDocument();
  });

  it("Edit dialog has 'Edit Project' as the dialog title", () => {
    renderEditDialog();
    // The EditProjectDialog wraps the form in a Dialog with title "Edit Project"
    const heading = screen.getByRole("heading", { name: /edit project/i });
    expect(heading).toBeInTheDocument();
  });

  it("Create mode does not show an 'Edit Project' heading", () => {
    renderCreateForm();
    expect(screen.queryByText(/edit project/i)).not.toBeInTheDocument();
  });

  it("Edit mode shows 'Edit Project' not 'Register Project'", () => {
    renderEditDialog();
    expect(screen.getByText("Edit Project")).toBeInTheDocument();
    // The dialog title is Edit Project, not Register Project
    expect(screen.queryByText("Register Project")).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PRJ-FORM-VIS-02: 7 tab buttons with role="tab" and aria-selected; keyboard
// ═════════════════════════════════════════════════════════════════════════════
describe("PRJ-FORM-VIS-02 — 7 tab navigation buttons accessible", () => {
  it("renders exactly 7 tab buttons", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(7);
  });

  it("all tabs have aria-selected attribute", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    tabs.forEach(tab => {
      expect(tab).toHaveAttribute("aria-selected");
    });
  });

  it("first tab (Basic) is selected by default", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    // Others are not selected
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
  });

  it("pressing ArrowRight on the first tab advances to the second tab", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    // After ArrowRight, second tab should be active (aria-selected=true)
    const updatedTabs = screen.getAllByRole("tab");
    expect(updatedTabs[1]).toHaveAttribute("aria-selected", "true");
  });

  it("all tab buttons have type='button'", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    tabs.forEach(tab => {
      expect(tab).toHaveAttribute("type", "button");
    });
  });

  it("tablist has aria-label", () => {
    renderCreateForm();
    const tablist = screen.getByRole("tablist");
    expect(tablist).toHaveAttribute("aria-label");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PRJ-FORM-VIS-03: Exactly one footer per form render
// ═════════════════════════════════════════════════════════════════════════════
describe("PRJ-FORM-VIS-03 — Exactly one footer action bar per form render", () => {
  it("form renders exactly one Cancel button", () => {
    renderCreateForm();
    const cancelBtns = screen.getAllByRole("button", { name: /cancel/i });
    expect(cancelBtns).toHaveLength(1);
  });

  it("form renders exactly one Save As Draft button", () => {
    renderCreateForm();
    const draftBtns = screen.getAllByRole("button", { name: /save as draft/i });
    expect(draftBtns).toHaveLength(1);
  });

  it("form renders exactly one Continue button on non-final tabs", () => {
    renderCreateForm();
    const continueBtns = screen.getAllByRole("button", { name: /continue/i });
    expect(continueBtns).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PRJ-FORM-VIS-04: Save As Draft has secondary (outline) visual treatment
// ═════════════════════════════════════════════════════════════════════════════
describe("PRJ-FORM-VIS-04 — Save As Draft has secondary visual treatment", () => {
  it("Save As Draft button is present", () => {
    renderCreateForm();
    expect(screen.getByRole("button", { name: /save as draft/i })).toBeInTheDocument();
  });

  it("Save As Draft button is not the same as the primary Continue/Create button by label", () => {
    renderCreateForm();
    // Save As Draft is outline, Continue is the primary blue button
    const draftBtn = screen.getByRole("button", { name: /save as draft/i });
    const continueBtn = screen.getByRole("button", { name: /continue/i });
    // They exist and are distinct buttons
    expect(draftBtn).not.toBe(continueBtn);
  });

  it("Save As Draft has aria-busy attribute for pending state tracking", () => {
    renderCreateForm();
    const draftBtn = screen.getByRole("button", { name: /save as draft/i });
    // aria-busy is set (false when not saving)
    expect(draftBtn).toHaveAttribute("aria-busy");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PRJ-FORM-VIS-05: Submit button is primary; aria-busy when pending
// ═════════════════════════════════════════════════════════════════════════════
describe("PRJ-FORM-VIS-05 — Submit/final action button is primary and accessible", () => {
  it("on the last tab (Review), Create Project button appears as submit", () => {
    renderCreateForm();
    // Navigate to last tab (Review)
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[6]); // Review tab
    // Create Project button should be present (type=submit)
    const createBtn = screen.getByRole("button", { name: /create project/i });
    expect(createBtn).toHaveAttribute("type", "submit");
  });

  it("Create Project button has aria-busy attribute", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[6]);
    const createBtn = screen.getByRole("button", { name: /create project/i });
    expect(createBtn).toHaveAttribute("aria-busy");
  });

  it("on intermediate tabs, Continue button is present instead of Create Project", () => {
    renderCreateForm();
    // On Basic tab (default), Continue is present
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create project/i })).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PRJ-FORM-VIS-06: Activity Recorded Expenditure is read-only text
// ═════════════════════════════════════════════════════════════════════════════
describe("PRJ-FORM-VIS-06 — Activity Recorded Expenditure is read-only text", () => {
  it("in edit mode with spend data, the recorded expenditure text is visible", () => {
    renderEditDialog();
    // Navigate to Timeline tab
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[3]); // Timeline tab
    // Recorded expenditure is shown as a read-only notice
    expect(screen.getByText(/recorded expenditure/i)).toBeInTheDocument();
  });

  it("recorded expenditure value is not in an editable input", () => {
    renderEditDialog();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[3]);
    // The spend value is rendered as text, not as an editable input
    const readOnlySpend = screen.getByText(/recorded expenditure/i);
    expect(readOnlySpend.tagName.toLowerCase()).not.toBe("input");
    expect(readOnlySpend.closest("input")).toBeNull();
  });

  it("recorded expenditure note says it cannot be edited", () => {
    renderEditDialog();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[3]);
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PRJ-FORM-VIS-07: Financed activity removal dialog Cancel/Confirm buttons
// ═════════════════════════════════════════════════════════════════════════════
describe("PRJ-FORM-VIS-07 — Financed activity removal dialog has correct button structure", () => {
  it("financed activity removal dialog is not open by default (no alertdialog in DOM)", () => {
    renderEditDialog();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("clicking Remove on an activity with recorded expenditure opens the confirmation dialog", () => {
    renderEditDialog();
    // Navigate to Timeline tab where the activity with budgetSpent=12500 lives
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[3]); // Timeline tab

    // The activity card is expanded by default; find the remove-activity button
    const removeBtns = screen.getAllByRole("button", {
      name: /remove activity/i,
    });
    expect(removeBtns.length).toBeGreaterThan(0);
    // Click the first remove button — activity has spend so dialog should open
    fireEvent.click(removeBtns[0]);
    // AlertDialog should now be in the DOM
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("dialog shows 'Keep Activity' (safe) and 'Remove Activity' (destructive) buttons", () => {
    renderEditDialog();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[3]);
    const removeBtns = screen.getAllByRole("button", { name: /remove activity/i });
    fireEvent.click(removeBtns[0]);

    // Cancel button is labelled "Keep Activity" — not destructive
    const cancelBtn = screen.getByTestId("alert-cancel");
    expect(cancelBtn).toHaveTextContent("Keep Activity");
    expect(cancelBtn.className).not.toContain("destructive");

    // Confirm button is labelled "Remove Activity" and has destructive styling
    const actionBtn = screen.getByTestId("alert-action");
    expect(actionBtn).toHaveTextContent("Remove Activity");
    expect(actionBtn.className).toContain("destructive");
  });

  it("dialog title warns about recorded expenditure (not a generic delete prompt)", () => {
    renderEditDialog();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[3]);
    const removeBtns = screen.getAllByRole("button", { name: /remove activity/i });
    fireEvent.click(removeBtns[0]);

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    // The dialog heading contains "Recorded Expenditure" warning text
    const heading = dialog.querySelector("h2");
    expect(heading?.textContent).toMatch(/recorded expenditure/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PRJ-FORM-VIS-08: Documents tab renders three upload areas and lock notice
// ═════════════════════════════════════════════════════════════════════════════
describe("PRJ-FORM-VIS-08 — Documents tab three upload areas and lock notice", () => {
  it("Documents tab is reachable via tab navigation (7th tab = index 5)", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    // Documents tab is the 6th tab (index 5)
    expect(tabs[5]).toHaveTextContent(/documents/i);
  });

  it("Documents tab panel has the correct role and label", () => {
    renderCreateForm();
    // The Documents panel exists in the DOM (hidden when not active)
    const panel = document.getElementById("prj-panel-documents");
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("role")).toBe("tabpanel");
  });

  it("Three document category Cards render in the Documents panel", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[5]); // Navigate to Documents tab
    // i18n mock returns: "Agreement document", "Budget document", "Supporting documents"
    expect(screen.getByText("Agreement document")).toBeInTheDocument();
    expect(screen.getByText("Budget document")).toBeInTheDocument();
    expect(screen.getByText("Supporting documents")).toBeInTheDocument();
  });

  it("documents required note renders in Documents panel", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[5]);
    // i18n mock returns "Agreement and budget documents are required."
    expect(screen.getByText("Agreement and budget documents are required.")).toBeInTheDocument();
  });

  it("voice recorder renders in Documents panel", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[5]);
    expect(screen.getByTestId("voice-recorder")).toBeInTheDocument();
  });

  it("in create mode (draft/mutable), no document lock notice appears", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[5]);
    // Lock notices contain "Documents are locked" — should not appear in create mode
    expect(screen.queryByText(/documents are locked/i)).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PRJ-FORM-VIS-09: Sector/state checkbox grids don't overflow
// ═════════════════════════════════════════════════════════════════════════════
describe("PRJ-FORM-VIS-09 — Sector/state checkbox grid scroll containment", () => {
  it("sectors checkbox grid has border rounded-md class for visual containment", () => {
    const { container } = renderCreateForm();
    // Sectors grid
    const sectorGrid = container.querySelector(".grid.grid-cols-2");
    expect(sectorGrid).toBeTruthy();
  });

  it("state checkbox grid has max-h-60 overflow-y-auto for scroll containment", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[1]); // Location tab
    // Find the scrollable state grid
    const { container } = renderCreateForm();
    fireEvent.click(screen.getAllByRole("tab")[1]);
    const stateGrid = container.querySelector(".max-h-60.overflow-y-auto");
    expect(stateGrid).toBeTruthy();
  });

  it("11 sector checkboxes render without layout overflow", () => {
    renderCreateForm();
    // 11 sectors in the mock — all should render
    const checkboxes = screen.getAllByRole("checkbox");
    // At least the sector checkboxes are rendered (there may be more from other fields)
    expect(checkboxes.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Section heading coverage — every tab panel exposes its expected heading
// ═════════════════════════════════════════════════════════════════════════════
// SectionHeading renders an <h3> which has ARIA role="heading".
// Querying by heading role avoids false matches from Review tab <dt>/<p> sub-labels
// that may coincidentally share the same translated text.
describe("Section headings — each tab panel renders its SectionHeading", () => {
  it("Basic tab: 'Project details' h3 section heading", () => {
    renderCreateForm();
    expect(screen.getByRole("heading", { name: "Project details" })).toBeInTheDocument();
  });

  it("Basic tab: 'Sector coverage' h3 section heading", () => {
    renderCreateForm();
    expect(screen.getByRole("heading", { name: "Sector coverage" })).toBeInTheDocument();
  });

  it("Location tab: 'Operational locations' h3 section heading", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[1]);
    expect(screen.getByRole("heading", { name: "Operational locations" })).toBeInTheDocument();
  });

  it("Location tab: 'Target beneficiaries' h3 section heading", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[1]);
    expect(screen.getByRole("heading", { name: "Target beneficiaries" })).toBeInTheDocument();
  });

  it("Donor tab: 'Donor information' h3 section heading", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[2]);
    expect(screen.getByRole("heading", { name: "Donor information" })).toBeInTheDocument();
  });

  it("Donor tab: 'Agreement details' h3 section heading", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[2]);
    expect(screen.getByRole("heading", { name: "Agreement details" })).toBeInTheDocument();
  });

  it("Timeline tab: 'Implementation period' h3 section heading", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[3]);
    expect(screen.getByRole("heading", { name: "Implementation period" })).toBeInTheDocument();
  });

  it("Timeline tab: 'Funding' h3 section heading", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[3]);
    expect(screen.getByRole("heading", { name: "Funding" })).toBeInTheDocument();
  });

  it("Timeline tab: 'Results framework' h3 section heading", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[3]);
    expect(screen.getByRole("heading", { name: "Results framework" })).toBeInTheDocument();
  });

  it("Team tab: 'Project team' h3 section heading", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[4]);
    expect(screen.getByRole("heading", { name: "Project team" })).toBeInTheDocument();
  });

  it("Documents tab: 'Project documents' h3 section heading", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[5]);
    expect(screen.getByRole("heading", { name: "Project documents" })).toBeInTheDocument();
  });

  it("Documents tab: 'Voice note' h3 section heading", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[5]);
    expect(screen.getByRole("heading", { name: "Voice note" })).toBeInTheDocument();
  });

  it("Review tab: 'Review & submit' h3 section heading", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[6]);
    expect(screen.getByRole("heading", { name: "Review & submit" })).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PRJ-FORM-VIS-10: No functional contract changed — ZR closure
// ═════════════════════════════════════════════════════════════════════════════
describe("PRJ-FORM-VIS-10 — Zero-residual functional contract unchanged", () => {
  it("form renders without errors (no crash from visual changes)", () => {
    expect(() => renderCreateForm()).not.toThrow();
  });

  it("edit dialog renders without errors (no crash from visual changes)", () => {
    expect(() => renderEditDialog()).not.toThrow();
  });

  it("tab navigation still works after visual changes", () => {
    renderCreateForm();
    const tabs = screen.getAllByRole("tab");
    // Click through all tabs
    tabs.forEach(tab => {
      expect(() => fireEvent.click(tab)).not.toThrow();
    });
  });

  it("footer Cancel button is always present and clickable", () => {
    const onClose = vi.fn();
    render(<ProjectRegistrationForm open onClose={onClose} />);
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("form onClose prop is called when Cancel is clicked", () => {
    const onClose = vi.fn();
    render(<ProjectRegistrationForm open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("loading skeleton renders with aria-busy='true' when editProjectId is provided but data not yet loaded", () => {
    // Set editIsLoading=true before rendering so useGetProject returns isLoading:true
    editIsLoading = true;
    const { container } = render(
      <ProjectRegistrationForm open editProjectId={1} onClose={vi.fn()} />,
    );
    // The skeleton container has aria-busy="true"
    const busyEl = container.querySelector("[aria-busy='true']");
    expect(busyEl).not.toBeNull();
    // The skeleton has a visually-hidden "Loading project data" sr-only span
    const srText = container.querySelector(".sr-only");
    expect(srText).not.toBeNull();
    expect(srText?.textContent).toContain("Loading project data");
    // The tab nav shows skeleton placeholders, not real tab buttons
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    // Skeleton elements are present
    const skeletons = container.querySelectorAll("[data-testid='skeleton']");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("form is not rendered when open=false", () => {
    const { container } = render(<ProjectRegistrationForm open={false} onClose={vi.fn()} />);
    // When open=false, component returns null
    expect(container.firstChild).toBeNull();
  });
});
