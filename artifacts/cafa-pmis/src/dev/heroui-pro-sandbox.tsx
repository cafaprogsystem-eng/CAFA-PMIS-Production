/**
 * HeroUI Pro evaluation page — development builds only (see App.tsx).
 *
 * Stage 0 of the Pro integration: renders KPI/KPIGroup and DataGrid with
 * representative CAFA data in Arabic and English so their RTL behaviour,
 * number formatting and theming can be checked before any real screen uses
 * them. Sample figures are illustrative, not live data; copy lives here
 * rather than in the locale files because this page never ships.
 */
import { useMemo, useState } from "react";
import { Chip, type Selection } from "@heroui/react";
import { KPI } from "@heroui-pro/react/kpi";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { NumberValue } from "@heroui-pro/react/number-value";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { FolderKanban, ShieldAlert, Users, Wallet } from "@/components/icons";
import { useLanguage } from "@/contexts/language-context";
import { useIsMobile } from "@/hooks/use-mobile";

type Lang = "ar" | "en";
const COPY = {
  title: { ar: "تجربة HeroUI Pro", en: "HeroUI Pro evaluation" },
  lede: {
    ar: "صفحة للمطورين فقط، لا تظهر في نسخة الإنتاج. الأرقام توضيحية.",
    en: "Developer-only page, not included in production builds. Figures are illustrative.",
  },
  kpiHeading: { ar: "مؤشرات الأداء (KPI Group)", en: "Key indicators (KPI Group)" },
  gridHeading: { ar: "المشاريع (Data Grid)", en: "Projects (Data Grid)" },
  activeProjects: { ar: "المشاريع النشطة", en: "Active projects" },
  beneficiaries: { ar: "المستفيدون الذين تم الوصول إليهم", en: "Beneficiaries reached" },
  budget: { ar: "نسبة صرف الميزانية", en: "Budget utilisation" },
  risks: { ar: "مخاطر مرتفعة مفتوحة", en: "Open high risks" },
  vsLastQuarter: { ar: "مقارنة بالربع السابق", en: "vs. last quarter" },
  ofEnvelope: { ar: "من الميزانية المعتمدة", en: "of approved envelope" },
  code: { ar: "الرمز", en: "Code" },
  project: { ar: "المشروع", en: "Project" },
  state: { ar: "الولاية", en: "State" },
  sector: { ar: "القطاع", en: "Sector" },
  status: { ar: "الحالة", en: "Status" },
  reached: { ar: "المستفيدون", en: "Beneficiaries" },
  spent: { ar: "الصرف", en: "Spent" },
  selected: { ar: "محدد", en: "selected" },
  gridLabel: { ar: "قائمة المشاريع", en: "Project list" },
} satisfies Record<string, Record<Lang, string>>;

type Status = "active" | "planning" | "completed" | "on_hold";
const STATUS_LABEL: Record<Status, Record<Lang, string>> = {
  active: { ar: "نشط", en: "Active" },
  planning: { ar: "تخطيط", en: "Planning" },
  completed: { ar: "مكتمل", en: "Completed" },
  on_hold: { ar: "متوقف", en: "On hold" },
};
const STATUS_COLOR: Record<Status, "success" | "accent" | "default" | "warning"> = {
  active: "success", planning: "accent", completed: "default", on_hold: "warning",
};

type ProjectRow = {
  id: number; code: string; title: Record<Lang, string>; state: Record<Lang, string>;
  sector: Record<Lang, string>; status: Status; reached: number; spent: number;
};
const PROJECTS: ProjectRow[] = [
  { id: 31, code: "CAFA-KS-014", title: { ar: "مياه وإصحاح لمواقع النازحين", en: "Emergency WASH for IDP sites" }, state: { ar: "كسلا", en: "Kassala" }, sector: { ar: "المياه والإصحاح", en: "WASH" }, status: "active", reached: 18420, spent: 0.72 },
  { id: 32, code: "CAFA-KS-019", title: { ar: "حماية الطفل المجتمعية", en: "Community-based child protection" }, state: { ar: "كسلا", en: "Kassala" }, sector: { ar: "الحماية", en: "Protection" }, status: "active", reached: 6310, spent: 0.48 },
  { id: 12, code: "CAFA-GZ-007", title: { ar: "الأمن الغذائي وسبل العيش", en: "Food security and livelihoods" }, state: { ar: "الجزيرة", en: "Gezira" }, sector: { ar: "الأمن الغذائي", en: "Food security" }, status: "active", reached: 24115, spent: 0.81 },
  { id: 22, code: "CAFA-GD-011", title: { ar: "توزيع البذور والأدوات", en: "Seed and tools distribution" }, state: { ar: "القضارف", en: "Gedaref" }, sector: { ar: "الزراعة", en: "Agriculture" }, status: "completed", reached: 9850, spent: 0.99 },
  { id: 33, code: "CAFA-KS-022", title: { ar: "عيادات صحية متنقلة", en: "Mobile health clinics" }, state: { ar: "كسلا", en: "Kassala" }, sector: { ar: "الصحة", en: "Health" }, status: "planning", reached: 0, spent: 0.05 },
  { id: 41, code: "CAFA-RS-003", title: { ar: "إعادة تأهيل المدارس", en: "School rehabilitation" }, state: { ar: "البحر الأحمر", en: "Red Sea" }, sector: { ar: "التعليم", en: "Education" }, status: "on_hold", reached: 2140, spent: 0.33 },
  { id: 3, code: "CAFA-KH-003", title: { ar: "الدعم النفسي والاجتماعي", en: "Psychosocial support" }, state: { ar: "الخرطوم", en: "Khartoum" }, sector: { ar: "الحماية", en: "Protection" }, status: "active", reached: 11980, spent: 0.57 },
];

const TREND = [
  { m: "Apr", v: 31 }, { m: "May", v: 33 }, { m: "Jun", v: 34 }, { m: "Jul", v: 37 }, { m: "Aug", v: 39 }, { m: "Sep", v: 42 },
];
const REACH = [
  { m: "Apr", v: 81000 }, { m: "May", v: 88500 }, { m: "Jun", v: 97200 }, { m: "Jul", v: 104300 }, { m: "Aug", v: 114100 }, { m: "Sep", v: 128450 },
];

export default function HeroUIProSandbox() {
  const { lang } = useLanguage();
  const L = (key: keyof typeof COPY) => COPY[key][lang];
  const [selected, setSelected] = useState<Selection>(new Set());
  // KPIGroup has no responsive orientation of its own; four cards do not fit
  // side by side on a phone.
  const isMobile = useIsMobile();

  const columns = useMemo<DataGridColumn<ProjectRow>[]>(() => [
    { id: "code", header: L("code"), cell: (p) => <span className="font-mono text-xs">{p.code}</span>, width: 140, allowsSorting: true, sortFn: (a, b) => a.code.localeCompare(b.code) },
    { id: "title", header: L("project"), isRowHeader: true, cell: (p) => <span className="font-medium">{p.title[lang]}</span>, minWidth: 220, allowsSorting: true, sortFn: (a, b) => a.title[lang].localeCompare(b.title[lang], lang) },
    { id: "state", header: L("state"), cell: (p) => p.state[lang], width: 130 },
    { id: "sector", header: L("sector"), cell: (p) => p.sector[lang], width: 150 },
    { id: "status", header: L("status"), cell: (p) => <Chip size="sm" variant="soft" color={STATUS_COLOR[p.status]}>{STATUS_LABEL[p.status][lang]}</Chip>, width: 120 },
    { id: "reached", header: L("reached"), align: "end", allowsSorting: true, sortFn: (a, b) => a.reached - b.reached, cell: (p) => <span className="tabular-nums">{p.reached.toLocaleString(lang === "ar" ? "ar-u-nu-latn" : "en-GB")}</span>, width: 140 },
    { id: "spent", header: L("spent"), align: "end", allowsSorting: true, sortFn: (a, b) => a.spent - b.spent, cell: (p) => <span className="tabular-nums">{Math.round(p.spent * 100)}%</span>, width: 100 },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- L only depends on lang
  ], [lang]);

  const selectedCount = selected === "all" ? PROJECTS.length : selected.size;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{L("title")}</h1>
        <p className="text-sm text-muted-foreground">{L("lede")}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">{L("kpiHeading")}</h2>
        <KPIGroup orientation={isMobile ? "vertical" : "horizontal"}>
          <KPI>
            <KPI.Header>
              <KPI.Icon><FolderKanban className="h-4 w-4" aria-hidden /></KPI.Icon>
              <KPI.Title>{L("activeProjects")}</KPI.Title>
            </KPI.Header>
            <KPI.Content>
              <KPI.Value value={42} />
              <KPI.Trend trend="up"><NumberValue value={0.08} style="percent" signDisplay="always" /></KPI.Trend>
            </KPI.Content>
            <KPI.Chart data={TREND} dataKey="v" height={40} color="var(--accent)" />
            <KPI.Footer><span className="text-xs text-muted-foreground">{L("vsLastQuarter")}</span></KPI.Footer>
          </KPI>
          <KPIGroup.Separator />
          <KPI>
            <KPI.Header>
              <KPI.Icon status="success"><Users className="h-4 w-4" aria-hidden /></KPI.Icon>
              <KPI.Title>{L("beneficiaries")}</KPI.Title>
            </KPI.Header>
            <KPI.Content>
              <KPI.Value value={128450} notation="compact" maximumFractionDigits={1} />
              <KPI.Trend trend="up"><NumberValue value={0.124} style="percent" maximumFractionDigits={1} signDisplay="always" /></KPI.Trend>
            </KPI.Content>
            <KPI.Chart data={REACH} dataKey="v" height={40} color="var(--success)" />
            <KPI.Footer><span className="text-xs text-muted-foreground">{L("vsLastQuarter")}</span></KPI.Footer>
          </KPI>
          <KPIGroup.Separator />
          <KPI>
            <KPI.Header>
              <KPI.Icon status="warning"><Wallet className="h-4 w-4" aria-hidden /></KPI.Icon>
              <KPI.Title>{L("budget")}</KPI.Title>
            </KPI.Header>
            <KPI.Content>
              <KPI.Value value={0.67} style="percent" />
            </KPI.Content>
            <KPI.Progress value={67} status="warning" />
            <KPI.Footer><span className="text-xs text-muted-foreground">{L("ofEnvelope")}</span></KPI.Footer>
          </KPI>
          <KPIGroup.Separator />
          <KPI>
            <KPI.Header>
              <KPI.Icon status="danger"><ShieldAlert className="h-4 w-4" aria-hidden /></KPI.Icon>
              <KPI.Title>{L("risks")}</KPI.Title>
            </KPI.Header>
            <KPI.Content>
              <KPI.Value value={5} />
              <KPI.Trend trend="down"><NumberValue value={-2} signDisplay="always" /></KPI.Trend>
            </KPI.Content>
            <KPI.Footer><span className="text-xs text-muted-foreground">{L("vsLastQuarter")}</span></KPI.Footer>
          </KPI>
        </KPIGroup>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">{L("gridHeading")}</h2>
          {selectedCount > 0 && <span className="text-xs text-muted-foreground">{selectedCount} {L("selected")}</span>}
        </div>
        <DataGrid
          aria-label={L("gridLabel")}
          data={PROJECTS}
          columns={columns}
          getRowId={(p) => p.id}
          selectionMode="multiple"
          showSelectionCheckboxes
          selectedKeys={selected}
          onSelectionChange={setSelected}
          defaultSortDescriptor={{ column: "reached", direction: "descending" }}
        />
      </section>
    </div>
  );
}
