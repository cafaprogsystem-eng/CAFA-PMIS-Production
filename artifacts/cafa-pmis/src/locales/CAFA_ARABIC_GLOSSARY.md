# CAFA PMIS — Authoritative Arabic Terminology Glossary

**Version:** Phase 4 — quality-gate alignment updated 2026-08-22
**Status:** Approved for use in module translation and automated terminology checks
**Authority:** This document is the single source of truth. No module may invent an alternative Arabic translation for any term listed here.

---

## Arabic UI Writing Standard

### Register
- Modern Standard Arabic (MSA), professional humanitarian/NGO register
- Clear, concise, direct — no classical complexity, no vernacular
- Avoid word-for-word English sentence structure
- Avoid excessive punctuation
- Use established Arabic equivalents; avoid unnecessary English borrowings

### Capitalisation
| Context | English rule | Arabic rule |
|---|---|---|
| Primary headings | Title Case | Natural Arabic orthography — no Title Case |
| Labels & helper text | Sentence case | Natural Arabic orthography |
| Workflow statuses | Title Case | Natural Arabic orthography |
| Button labels | Sentence case | Natural Arabic orthography |

### Interpolation
Preserve `{{placeholder}}` tokens exactly. Construct natural Arabic sentences around them — do not split into fragments:
- ✅ `"تم حفظ {{code}} كمسودة."`
- ❌ `"{{code}}" + " " + "تم حفظه كمسودة"`

### Pluralisation
Use i18next Arabic plural forms (CLDR). Arabic has 6 plural categories (zero, one, two, few, many, other). Do not manually concatenate number + noun.

Example structure:
```json
"project_one": "مشروع واحد",
"project_two": "مشروعان",
"project_few": "{{count}} مشاريع",
"project_many": "{{count}} مشروعاً",
"project_other": "{{count}} مشروع"
```

### Date & Number Formatting
Translation strings are separate from numerical formatting. Currency codes (USD, EUR, SDG) remain as ISO codes. Financial values are not transformed by translation. Full locale formatting is deferred to a later phase.

---

## British English Source Standard

English is the canonical source language. All source copy uses British English:

| British ✅ | American ❌ |
|---|---|
| Programme | Program |
| Authorised | Authorized |
| Organisation | Organization |
| Geographical | Geographic |
| Colour | Color |

**Role name exception:** Internal role enums use `program_manager` etc. (American) for database compatibility. UI display labels use British English: "Programme Manager", "Senior Programme Coordinator", etc.

---

## Key Naming Convention

Use semantic dot-notation keys, not English sentence keys:

| ✅ Semantic | ❌ English sentence |
|---|---|
| `planning.registration.tabs.details` | `"Plan Details Tab"` |
| `common.status.draft` | `"Draft"` |
| `projects.approval.finalApprove` | `"Final Approval"` |

Namespaces own their module. Shared cross-module terms live in `common`. Do not duplicate `common` keys inside module namespaces.

---

## Mixed-Language / User-Content Policy

**Translate:** System-generated UI labels, navigation, status labels, button text, form labels, error messages, tooltips, workflow action labels.

**Do NOT translate (display as stored):**
- Project titles
- Plan titles
- Donor names
- Person names
- Activity descriptions
- Uploaded filenames
- User-composed messages

---

## Bidi / LTR-Token Policy

The following data values must retain LTR display in Arabic UI. They require `dir="ltr"` or `<bdi>` isolation in Phase 3+ implementation:

- Project codes (e.g. `CAFA-PROJ-2026-004`)
- Plan codes (e.g. `CAFA-PLAN-KRT-013`)
- Email addresses
- URLs
- Phone numbers
- Database IDs / UUIDs
- Currency codes (USD, EUR, SDG)
- Technical identifiers

---

## Label Maps Requiring Later Migration

These local dictionaries duplicate i18n terminology and must be migrated to `t()` calls in Phase 3+:

| File | Constant | Action |
|---|---|---|
| `src/pages/plan-detail.tsx` | `PLAN_TYPE_LABELS` | Migrate to `planning.planTypes.*` |
| `src/pages/dashboard.tsx` | `ROLE_LABELS` | Migrate to `users.roles.*` |
| `src/pages/manual-role-guide.tsx` | `ROLE_LABELS` | Migrate to `users.roles.*` |
| `src/pages/budget.tsx` | `STATUS_LABELS` | Migrate to `common.*` status keys |
| `src/pages/invite-accept.tsx` | `ERROR_COPY` | Migrate to `errors.*` |
| `src/lib/format.ts` | `formatStatusLabel` | Migrate to `common.*` + `t()` |
| `src/lib/format.ts` | `formatPlanType` | Migrate to `planning.planTypes.*` |
| `src/pages/messages.tsx` | `TYPE_META.label` | Migrate to `messages.types.*` |
| `src/pages/plans.tsx` | `PLAN_TYPES[].label` | Migrate to `planning.planTypes.*` |
| `src/pages/plans.tsx` | `PLAN_KANBAN_COLS` | Migrate to `common.*` status keys |
| `src/components/project-registration-form.tsx` | `CLASSIFICATIONS` | Migrate to `projects.classifications.*` |
| `src/components/project-registration-form.tsx` | `ACTIVITY_STATUSES` | Migrate to `common.*` / `planning.activity.*` |
| `src/components/project-registration-form.tsx` | `PERSONNEL_ROLES` | Migrate to `projects.personnelRoles.*` |

---

## Existing Terminology Conflicts (English)

These inconsistencies produce conflicting Arabic translation candidates. Resolve before translating those modules:

| Conflict | Location A | Location B | Recommended |
|---|---|---|---|
| `super_admin` display label | `dashboard.tsx` → "System Administrator" | `manual-role-guide.tsx` → "Super Admin" | Use "Super Admin" (matches CAFA official role naming); Arabic: مسؤول النظام |
| `state_office_manager` display label | `dashboard.tsx` → "State Manager" | `manual-role-guide.tsx` → "State Office Manager" | Use "State Office Manager"; Arabic: مدير مكتب الولاية |
| `emergency` plan type short label | `plans.tsx` PLAN_TYPES → "Emergency" | `plan-detail.tsx` PLAN_TYPE_LABELS → "Emergency Response" | Use "Emergency Response"; Arabic: استجابة للطوارئ |
| Missing statuses in `planning.json` | Has: draft, submitted, approved, active, closed | `projects.json` has: technically_approved, coordination_approved, rejected, returned | Add missing statuses to `planning.json` in Phase 3 |
| `returned` status | `formatStatusLabel` covers it | `planning.json status` omits it | Add `returned`, `technically_approved`, `coordination_approved`, `cancelled`, `in_progress`, `delayed`, `completed` to `planning.json status` in Phase 3 |
| "Programme" in role labels | dashboard.tsx ROLE_LABELS uses "Programme" ✅ | Role enums use `program_*` ✅ (internal only) | No change needed — British English in display, American in DB enum |

---

## A. Programme & Project Terminology

| English | Approved Arabic | Usage note |
|---|---|---|
| Programme | البرنامج | Humanitarian programme context — always definite with ال |
| Programme Management | إدارة البرنامج | Navigation group label |
| Programme Management Information System | نظام معلومات إدارة البرنامج | Full product name |
| Project | المشروع | Specific funded project — not to be confused with programme |
| Plan | الخطة | Operational plan document |
| Activity | النشاط | Individual planned action within a plan |
| Indicator | المؤشر | M&E performance indicator |
| Target | المستهدف | Planned/target value |
| Achievement | الإنجاز | Actual result against target |
| Output | المخرج | Immediate result of an activity |
| Outcome | النتيجة | Medium-term effect of outputs |
| Objective | الهدف | Strategic objective |
| Beneficiary / Beneficiaries | المستفيد / المستفيدون | Persons receiving programme benefits |
| Donor | الجهة المانحة | Funding entity |
| Funding Source | مصدر التمويل | Source of project funding |
| Sector | القطاع | Programme sector (Health, WASH, etc.) |
| State | الولاية | Sudanese administrative state |
| Locality | المحلية | Sub-state administrative unit |
| Geographical Coverage | النطاق الجغرافي | Geographic scope of a project/plan |
| Responsible Person | الشخص المسؤول | Focal point for an activity or plan |
| Programme Scope | نطاق البرنامج | Boundary of programme work |
| Project Scope | نطاق المشروع | Boundary of project work |
| Authorised Scope | النطاق المعتمد | Scope as approved by senior management |
| Project Code | رمز المشروع | System-generated identifier — value never translated |
| Project Title | عنوان المشروع | User-entered project name — value never translated |
| Project Status | حالة المشروع | Current workflow state |
| Project Details | تفاصيل المشروع | Detail view label |
| Project Registration | تسجيل المشروع | Registration form heading |

---

## B. Planning Terminology

| English | Approved Arabic | Usage note |
|---|---|---|
| Plan Code | رمز الخطة | System-generated identifier — value never translated |
| Plan Title | عنوان الخطة | User-entered plan name — value never translated |
| Plan Type | نوع الخطة | Dropdown label |
| Plan Status | حالة الخطة | Current workflow state |
| Plan Details | تفاصيل الخطة | Detail view label |
| Plan Registration | تسجيل الخطة | Registration form heading |
| Related Project | المشروع المرتبط | Link to parent project |
| Standalone Plan | خطة مستقلة | Plan not linked to a project |
| Link to Existing Project | ربط بمشروع موجود | Action label |
| Annual Plan | الخطة السنوية | plan type |
| Monthly Plan | الخطة الشهرية | plan type |
| Quarterly Plan | الخطة الربع سنوية | plan type |
| Action Plan | خطة العمل | plan type |
| Operational Plan | الخطة التشغيلية | plan type |
| Emergency Response Plan | خطة الاستجابة للطوارئ | plan type — full label |
| Emergency Response | استجابة للطوارئ | Short form for chips/badges |
| Custom Plan | خطة مخصصة | plan type |

---

## C. Workflow & Approvals Terminology

### Statuses

| English (enum) | Display English | Approved Arabic | Notes |
|---|---|---|---|
| `draft` | Draft | مسودة | Initial state |
| `submitted` | Submitted | مُقدَّم | After submission for approval |
| `returned` | Returned | مُعاد | Sent back for corrections |
| `technically_approved` | Technically Approved | موافقة تقنية | After TC approval |
| `coordination_approved` | Coordination Approved | موافقة التنسيق | After SPC approval |
| `approved` | Approved | مُعتمَد | Final approval state |
| `active` | Active | نشط | Plan/project is being executed |
| `in_progress` | In Progress | قيد التنفيذ | Activity status |
| `delayed` | Delayed | متأخر | Activity/plan behind schedule |
| `completed` | Completed | مكتمل | Successfully finished |
| `cancelled` | Cancelled | ملغى | Cancelled before completion |
| `archived` | Archived | مؤرشف | Removed from active list |
| `rejected` | Rejected | مرفوض | Hard rejection |
| `closed` | Closed | مُغلَق | Formally closed out |
| `pending` | Pending | قيد الانتظار | Awaiting action |
| `on_hold` | On Hold | موقوف مؤقتاً | Temporarily suspended |

### Workflow Actions

| English | Approved Arabic | Notes |
|---|---|---|
| Submit for Approval | تقديم للاعتماد | Primary submission action |
| Reopen for Editing | إعادة فتح للتعديل | Reopen after approval lock |
| Save as Draft | حفظ كمسودة | Persist without submitting |
| Save & Finish | حفظ وإنهاء | Final save action |
| Approve | اعتماد | Approve at any stage |
| Technical Approval | موافقة تقنية | TC stage action |
| Coordination Approval | موافقة التنسيق | SPC stage action |
| Final Approval | الموافقة النهائية | PM/ED stage action |
| Return | إعادة | Send back with comments |
| Request Revision | طلب مراجعة | Request corrections |
| Reject | رفض | Hard rejection |
| Cancel Plan | إلغاء الخطة | Cancel the plan |
| Delete Plan | حذف الخطة | Permanent deletion |

---

## D. Reporting Terminology

| English | Approved Arabic | Usage note |
|---|---|---|
| Report | التقرير | Generic — with ال |
| Project Report | تقرير المشروع | Report tied to a project |
| State Programme Report | تقرير برنامج الولاية | State-level programme report |
| HQ Sector Report | تقرير قطاع المقر | Headquarters sector report |
| Monthly Report | التقرير الشهري | By period |
| Quarterly Report | التقرير الربع سنوي | By period |
| Ad Hoc Report | تقرير استثنائي | Non-scheduled report |
| Reporting Period | فترة التقرير | The period a report covers |
| Submission Date | تاريخ التقديم | When submitted |
| Submitted By | مُقدَّم بواسطة | Who submitted |
| Approval Status | حالة الاعتماد | Report approval state |
| Reports Awaiting Approval | تقارير في انتظار الاعتماد | Dashboard widget label |
| Returned Report | تقرير مُعاد | Report sent back for revision |
| Reporting Compliance | الالتزام بالإبلاغ | Compliance metric label |

---

## E. Risk Terminology

| English | Approved Arabic | Usage note |
|---|---|---|
| Risk | المخاطرة | Singular — do not use مخاطر (plural) for the concept |
| Risks | المخاطر | Plural |
| Risk Level | مستوى المخاطرة | Computed severity tier |
| Severity | الخطورة | Risk severity dimension |
| Low | منخفض | Severity level |
| Medium | متوسط | Severity level |
| High | مرتفع | Severity level |
| Critical | حرج | Severity level — distinct from project status |
| Mitigation | التخفيف | Risk mitigation concept |
| Mitigation Action | إجراء التخفيف | Specific mitigation step |
| Mitigation Plan | خطة التخفيف | Overall plan to mitigate |
| Risk Owner | مالك المخاطرة | Person responsible |
| Risk Status | حالة المخاطرة | Active/resolved etc. |
| Active Risk | مخاطرة نشطة | Risk not yet resolved |
| Critical Risk | مخاطرة حرجة | High-severity active risk |
| Overdue Mitigation | تخفيف متأخر | Mitigation past due date |
| Risks & Follow-Up | المخاطر والمتابعة | Navigation / section label |
| Projects Requiring Follow-Up | المشاريع التي تحتاج متابعة | Dashboard widget label |

---

## F. Budget & Finance Terminology

| English | Approved Arabic | Usage note |
|---|---|---|
| Budget | الميزانية | General budget concept |
| Allocated Budget | الميزانية المخصصة | Budget formally allocated |
| Project-Level Budget | ميزانية المشروع | Budget at project level |
| State Allocation | تخصيص الولاية | Budget slice per state |
| Planned Budget | الميزانية المخططة | Budget as planned |
| Actual Budget | الميزانية الفعلية | Actual spend |
| Expenditure | الإنفاق | Total spend concept |
| Spent | المُنفَق | Amount already spent |
| Remaining Balance | الرصيد المتبقي | Unspent balance |
| Utilisation Rate | معدل الاستهلاك | % of budget used |
| Burn Rate | معدل الصرف | Spending velocity |
| Currency | العملة | Currency label |
| Funding Source | مصدر التمويل | Same as in project terminology |
| Donor Portfolio | محفظة الجهات المانحة | Multi-donor overview |
| Project Budget Performance | أداء ميزانية المشروع | Budget KPI |

**Currency codes are never translated:** USD · EUR · SDG remain as-is.

---

## G. Beneficiary Terminology

| English | Approved Arabic | Usage note |
|---|---|---|
| Beneficiaries | المستفيدون | Persons receiving benefits |
| Total Beneficiaries | إجمالي المستفيدين | Aggregate count |
| Men | الرجال | Adult male beneficiaries |
| Women | النساء | Adult female beneficiaries |
| Boys | الأولاد | Male child beneficiaries |
| Girls | البنات | Female child beneficiaries |
| Target Beneficiaries | المستفيدون المستهدفون | Planned beneficiary count |
| Reached Beneficiaries | المستفيدون الفعليون | Actual beneficiaries served |

**Note:** Only use "Reached Beneficiaries" / "المستفيدون الفعليون" where the underlying data represents actually served beneficiaries, not targets.

---

## H. User & Role Terminology

| Role (enum) | Display English | Approved Arabic | Notes |
|---|---|---|---|
| `super_admin` | Super Admin | مسؤول النظام | Official CAFA role name |
| `executive_director` | Executive Director | المدير التنفيذي | — |
| `program_manager` | Programme Manager | مدير البرنامج | British "Programme" in display |
| `senior_program_coordinator` | Senior Programme Coordinator | منسق البرنامج الأول | — |
| `technical_coordinator` | Technical Coordinator | المنسق التقني | — |
| `state_office_manager` | State Office Manager | مدير مكتب الولاية | Use full "Office Manager", not "Manager" |
| `state_program_officer` | State Programme Officer | ضابط برنامج الولاية | — |
| `project_officer` | Project Officer | ضابط المشروع | — |
| `program_assistant` | Programme Assistant | مساعد البرنامج | British "Programme" in display |
| `viewer` | Viewer | مشاهد | Read-only access role |

**Rule:** The hierarchical order must be preserved in Arabic. Do not use titles that imply equal or higher seniority than the English source.

---

## I. System Navigation Terminology

| English | Approved Arabic | Notes |
|---|---|---|
| Dashboard | لوحة التحكم | Main overview screen |
| Planning | التخطيط | Module name |
| Budget | الميزانية | Module name |
| Reports | التقارير | Module name |
| Risks | المخاطر | Module name |
| Notifications | الإشعارات | Module name |
| Communication Centre | مركز التواصل | Module name |
| SOPs & Resources | اللوائح والموارد | Knowledge section |
| Document Repository | مستودع الوثائق | File storage section |
| System Manual | دليل النظام | Help documentation |
| AI Assistant | المساعد الذكي | AI chat feature |
| Users | المستخدمون | User management |
| States | الولايات | Administrative states |
| Audit Log | سجل المراجعة | Audit trail |
| AI Settings | إعدادات الذكاء الاصطناعي | AI configuration |
| Overview | نظرة عامة | Navigation group |
| Programme Management | إدارة البرنامج | Navigation group |
| Communication | التواصل | Navigation group |
| Administration | الإدارة | Navigation group |

---

## J. Common Actions Terminology

| English | Approved Arabic | Notes |
|---|---|---|
| Search | بحث | Input placeholder / button |
| Filter | تصفية | Filter control |
| Sort | ترتيب | Sort control |
| View | عرض | Open in read mode |
| Edit | تعديل | Open in edit mode |
| Delete | حذف | Permanent removal |
| Archive | أرشفة | Move to archive |
| Restore | استعادة | Restore from archive |
| Download | تنزيل | Download file |
| Upload | رفع | Upload file |
| Save | حفظ | Save changes |
| Save Changes | حفظ التغييرات | Explicit save-changes button |
| Save as Draft | حفظ كمسودة | Workflow action |
| Cancel | إلغاء | Dismiss / cancel action |
| Close | إغلاق | Close dialog/panel |
| Previous | السابق | Pagination / stepper |
| Next | التالي | Pagination / stepper |
| Back | رجوع | Navigation back |
| Continue | متابعة | Proceed to next step |
| Create | إنشاء | Create new record |
| New | جديد | New item button prefix |
| Add | إضافة | Add item to list |
| Remove | إزالة | Remove from list (not delete) |
| Retry | إعادة المحاولة | Retry failed action |
| Refresh | تحديث | Reload data |
| Submit | تقديم | Submit form |
| Confirm | تأكيد | Confirm dialog action |
| Export | تصدير | Export data |
| Import | استيراد | Import data |
| Print | طباعة | Print |
| Share | مشاركة | Share link |
| Copy | نسخ | Copy to clipboard |
| Expand | توسيع | Expand section |
| Collapse | طي | Collapse section |
| Select All | تحديد الكل | Select all rows |
| Clear All | مسح الكل | Clear all selections/filters |

---

## K. Validation & Error Terminology

| English | Approved Arabic | Notes |
|---|---|---|
| Required | مطلوب | Field validation label |
| This field is required | هذا الحقل مطلوب | Inline validation message |
| No data available | لا توجد بيانات | Empty state |
| No results found | لا توجد نتائج | Empty search result |
| Try again | حاول مجدداً | Retry prompt |
| Loading… | جارٍ التحميل… | Loading state |
| Saving… | جارٍ الحفظ… | Save in progress |
| Saved successfully | تم الحفظ بنجاح | Success feedback |
| Created successfully | تم الإنشاء بنجاح | Success feedback |
| Updated successfully | تم التحديث بنجاح | Success feedback |
| Deleted successfully | تم الحذف بنجاح | Success feedback |
| Something went wrong | حدث خطأ ما | Generic error |
| Unable to load | تعذّر التحميل | Load failure |
| Unable to save | تعذّر الحفظ | Save failure |
| Unable to delete | تعذّر الحذف | Delete failure |
| Permission denied | غير مسموح | RBAC block |
| You are not authorised | غير مصرح لك | Auth error |
| Session expired | انتهت الجلسة | Auth error |
| Network error | خطأ في الشبكة | Connectivity error |
| This action is not available offline | هذا الإجراء غير متاح في وضع عدم الاتصال | Offline block |
| Action queued — will sync when back online | تمت إضافة الإجراء إلى قائمة الانتظار — ستتم المزامنة عند الاتصال | Offline queue |
| This action cannot be undone | لا يمكن التراجع عن هذا الإجراء | Delete warning |
| You have unsaved changes | لديك تغييرات غير محفوظة | Unsaved state |

---

## L. View Modes & Filter Terminology

| English | Approved Arabic | Usage note |
|---|---|---|
| Table View | عرض الجدول | Data table presentation |
| List View | عرض القائمة | Compact record-list presentation |
| Board View | عرض اللوحة | Kanban / workflow board presentation |
| Card View | عرض البطاقات | Visual card-grid presentation |
| Calendar View | عرض التقويم | Calendar-based presentation |
| Grid View | عرض الشبكة | Grid-based presentation |
| All | الكل | Unrestricted filter option |
| All Statuses | كل الحالات | Status filter option |
| All Types | كل الأنواع | Type filter option |
| All States | كل الولايات | State filter option |
| All Sectors | كل القطاعات | Sector filter option |
| All Projects | كل المشاريع | Project filter option |
| All Activities | كل الأنشطة | Activity filter option |
| Date Range | النطاق الزمني | Start/end date filter |
| From Date | من تاريخ | Date-range lower bound |
| To Date | إلى تاريخ | Date-range upper bound |
| Filter by Status | تصفية حسب الحالة | Status filter label |
| Filter by Type | تصفية حسب النوع | Type filter label |
| Filter by State | تصفية حسب الولاية | State filter label |
| Filter by Sector | تصفية حسب القطاع | Sector filter label |
| Filter by Location | تصفية حسب الموقع | Location filter label |
| Filter by Date | تصفية حسب التاريخ | Date filter label |

**Rule:** Use the short labels in filter controls and the full “عرض …” labels only
when naming a selectable view mode. Do not create alternative translations for
these concepts in individual modules.
