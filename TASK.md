# Clinic MVP — Frontend Build Tasks (Model-Dependency Order)

Build plan for the `medical-app` frontend against the **Clinic Management API**.
Tasks are ordered by **model dependency**: a task may only be started once every schema it
`$ref`s has already been modelled. The ordering below is a topological sort of the
`components.schemas` reference graph in the live OpenAPI document.

---

## 1. Context

| | |
|---|---|
| **Frontend stack** | React Router v8 (framework mode, SSR), React 19, Vite 8, Tailwind v4, shadcn + Base UI, lucide-react |
| **API base URL** | `https://clinic-mvp-backend.auxiliarynetwork.com/api/v1` |
| **Interactive docs** | `https://clinic-mvp-backend.auxiliarynetwork.com/docs` |
| **Spec** | `https://clinic-mvp-backend.auxiliarynetwork.com/openapi.json` |
| **Auth** | HTTP Bearer (JWT) from `POST /auth/login`; refresh via `POST /auth/refresh` |
| **Current app state** | Stock React Router template — one `home` route, one `button.tsx`. Everything below is greenfield. |

### API conventions (encode these once, in Phase 0)

- **Success envelope**: `{ data: ... }`, plus `{ meta: PageMeta }` on list responses.
- **Error envelope**: `{ error: { code, message, details[], data, requestId } }`.
- **Money**: integer **pesewas** (100 = GHS 1.00), always paired with a formatted display string. Never do float maths on these.
- **IDs**: 24-char hex ObjectId strings.
- **Timestamps**: ISO 8601 UTC. **Dates**: `YYYY-MM-DD`.

### Task notation

- `Defines:` schemas this task turns into TypeScript models.
- `Blocked by:` tasks that must land first (derived from `$ref` edges).
- `Endpoints:` API surface this task consumes.
- Each task is done when its models typecheck, its API functions are callable, and its UI renders real data from the deployed backend.

---

## 2. Model dependency layers

The `$ref` graph resolves into five layers. Nothing in layer *N* may be written before layer *N-1* exists.

```
L0  enums + leaf objects   Role, Station, PayerType, NhisExemptionCategory, MembershipStatus,
    (zero $refs)           Frequency, ObjectId, Money, PageMeta, ErrorDetail, PatientAge,
                           NextOfKin, Allergy, ChronicCondition, ProfessionalLicence,
                           ReferenceRange, VitalFlag, Diagnosis, Amendment, DispenseRecord,
                           ClaimLine, ClaimException, Icd10Entry, FacilitySettings,
                           StockValuation, Dhims2AgeRow, DailyTakings, ServiceLineRevenue,
                           MetricSummary, MetricResult, Dashboard, NoteMatch, Health, ...

L1  one hop from leaves    ErrorResponse, PayerProfile, PayerSnapshot, StationVisitRecord,
                           Staff, Analyte, ChargeItem, Charge, Invoice, Tariff, Product,
                           StockBatch, StockMovement, Supplier, LowStockItem, ExpiringBatch,
                           Payment, TillSession, Vitals, Consultation, Claim, ClaimBatch,
                           PrescriptionItem, LabOrderItem, Newborn, AncRecord, PostnatalVisit,
                           Immunization, Appointment, Referral, Facility, InsuranceScheme,
                           NoteSearchResult, AskResult, Dhims2Return

L2  composites             PatientSummary, Patient, Session→Staff, LabTest→Analyte,
                           LabOrder→LabOrderItem, Prescription→PrescriptionItem,
                           VisitBill→{Invoice,Charge}, Delivery→Newborn,
                           TillSummary→TillSession, TakePaymentResult→{Payment,Invoice},
                           PriceQuote→ChargeItem, DuplicateCandidate→PatientSummary

L3  patient-bearing        QueueEntry→PatientSummary, VisitSummary→PatientSummary,
                           Visit→{PatientSummary, StationVisitRecord, PayerSnapshot}

L4  worklists              StationQueue→QueueEntry
```

**Critical path**: `L0 primitives → Staff/Session → PatientSummary/Patient → Visit → QueueEntry → StationQueue`.
Everything else (lab, pharmacy, billing, claims, maternity, analytics) hangs off `Visit` and can be parallelised once Phase 3 lands.

Proposed file layout:

```
app/
  models/        one file per domain, mirroring OpenAPI schema names
  lib/api/       client.ts (fetch + envelope + auth) and one module per tag
  routes/        route modules, loaders/actions calling app/lib/api
  components/    ui/ (shadcn) + domain components
```

---

## Phase 0 — Foundations (L0)

Nothing else can start until this phase is done.

### T0.1 — Primitive types and enums
- **Defines**: `ObjectId`, `Money`, `PageMeta`, `ErrorDetail`, `ErrorResponse`, `Role`, `Station`, `PayerType`, `NhisExemptionCategory`, `MembershipStatus`, `Frequency`, plus inline enums: `VisitType`, `Priority`, `Disposition`, `PaymentMethod`, `DosageForm`, `Route`, `SpecimenType`.
- **Blocked by**: —
- **Deliverable**: `app/models/primitives.ts`, `app/models/enums.ts`.
- **Note**: `Role` (admin, records, nurse, doctor, physician_assistant, midwife, lab, pharmacy, store, cashier, claims) and `Station` (records, vitals, consulting, lab, pharmacy, cashier, injection, anc, ward) drive navigation and permissions everywhere — model them as const objects + union types, not bare string enums.

### T0.2 — Money utilities
- **Blocked by**: T0.1
- **Deliverable**: `app/lib/money.ts` — `formatPesewas()`, `toPesewas()`, `sumPesewas()`. Integer-only arithmetic.
- **Done when**: a unit-tested round trip `GHS 12.35 ↔ 1235` holds, and no component formats money inline.

### T0.3 — API client
- **Blocked by**: T0.1
- **Deliverable**: `app/lib/api/client.ts` — typed `request<T>()` that unwraps `{data}`/`{meta}`, throws a typed `ApiError` carrying `code`/`message`/`details`/`requestId`, injects `Authorization: Bearer`, and takes a base URL from an env var (not hardcoded).
- **Done when**: `GET /health` returns a typed `Health` and a deliberate 4xx surfaces `ApiError.code`.

### T0.4 — App shell, theming, error boundary
- **Blocked by**: T0.3
- **Deliverable**: root layout, Tailwind theme, shadcn primitives beyond `button.tsx` (input, select, table, dialog, badge, card, toast), route `ErrorBoundary` rendering `ApiError` shape.

---

## Phase 1 — Identity & access (L1 → L2)

### T1.1 — Staff model
- **Defines**: `ProfessionalLicence` (L0), `Staff` → `ObjectId, Role, Station, ProfessionalLicence`.
- **Blocked by**: T0.1
- **Deliverable**: `app/models/staff.ts`.

### T1.2 — Session + auth flow
- **Defines**: `Session` → `Staff`, `LoginRequest`, `RefreshRequest`, `ChangePasswordRequest`.
- **Blocked by**: T1.1, T0.3
- **Endpoints**: `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`, `POST /auth/change-password`.
- **Deliverable**: login route, server-side session cookie holding the JWT pair, `requireStaff()` loader helper, silent refresh on `expiresIn`, logout.
- **Done when**: an unauthenticated loader redirects to `/login`, and an expired access token refreshes without bouncing the user.

### T1.3 — Role/station-aware navigation
- **Blocked by**: T1.2
- **Deliverable**: shell nav that shows only the modules a staff member's `roles[]`/`station` allow. Treat this as UX routing, not security — the API is the authority.

---

## Phase 2 — Patient (L2)

### T2.1 — Patient models
- **Defines**: `PatientAge`, `NextOfKin`, `Allergy`, `ChronicCondition` (L0); `PayerProfile`/`PayerProfileInput` → `PayerType, NhisExemptionCategory, MembershipStatus` (L1); `PatientSummary` → `ObjectId, PatientAge, PayerProfile`; `Patient` → `+ NextOfKin`.
- **Blocked by**: T0.1
- **Deliverable**: `app/models/patient.ts`.
- **Note**: `PatientAge` carries `{years, months, display, accuracy}` — estimated ages are normal here. Always render `display`; never recompute age from a DOB.

### T2.2 — Registration & folder
- **Defines**: `CreatePatient`, `UpdatePatient` → `NextOfKin, PayerProfileInput, Allergy, ChronicCondition`.
- **Blocked by**: T2.1, T1.2
- **Endpoints**: `POST /patients`, `GET /patients/{id}`, `PUT /patients/{id}`.
- **Deliverable**: registration form (demographics → payer → allergies/conditions → next of kin), patient folder view with allergy/chronic-condition banner.

### T2.3 — Duplicate detection & merge
- **Defines**: `DuplicateSearch`, `DuplicateCandidate` → `PatientSummary`, `MergePatients`.
- **Blocked by**: T2.1
- **Endpoints**: `POST /patients/search`, `POST /patients/merge`.
- **Deliverable**: search-before-register step in the registration flow; side-by-side merge confirmation. Merge is destructive — require explicit confirmation.

---

## Phase 3 — Visit (L3) — critical path

### T3.1 — Visit models
- **Defines**: `PayerSnapshot`, `StationVisitRecord` (L1); `VisitSummary`, `Visit` → `ObjectId, PatientSummary, Station, PayerSnapshot, StationVisitRecord`; `CheckIn`, `MoveStation`, `CloseVisit`.
- **Blocked by**: T2.1
- **Deliverable**: `app/models/visit.ts`.
- **Note**: `PayerSnapshot` is the payer *as at check-in* — do not substitute the patient's current `PayerProfile` when rendering a visit or its bill.

### T3.2 — Check-in and visit lifecycle
- **Blocked by**: T3.1
- **Endpoints**: `POST /visits`, `GET /visits/{id}`, `POST /visits/{id}/move-station`, `POST /visits/{id}/close`.
- **Deliverable**: check-in flow (patient → visit type → priority → payer), visit header component reused by every station screen, station-history timeline, close-visit dialog with `Disposition` (discharged, admitted, referred, absconded, died, dama).
- **Visit types**: opd, review, emergency, anc, postnatal, immunization, admission, walk_in_lab, walk_in_pharmacy.

---

## Phase 4 — Queues (L3 → L4)

### T4.1 — Queue models
- **Defines**: `QueueEntry` → `ObjectId, PatientSummary, Station`; `StationQueue` → `Station, QueueEntry`; `EnqueuePatient`, `QueueAction`.
- **Blocked by**: T3.1
- **Deliverable**: `app/models/queue.ts`.

### T4.2 — Station worklist screen
- **Blocked by**: T4.1
- **Endpoints**: `GET /queues/{station}`, `POST /queues/{station}/enqueue`, `POST /queues/{id}/call`, `POST /queues/{id}/complete`, `POST /queues/{id}/skip`.
- **Deliverable**: one reusable worklist component parameterised by `Station`, with the counters the API returns (waiting, inService, completedToday, longestWait, averageWait), priority sorting (emergency > urgent > routine), and call/complete/skip actions.
- **Done when**: every station module in Phases 5–7 mounts this component rather than rolling its own list.
- **Open**: no websocket in the spec — decide a polling interval (suggest revalidate every 15–30s).

---

## Phase 5 — Clinical capture (L1)

Parallelisable once Phase 3 lands.

### T5.1 — Vitals
- **Defines**: `VitalFlag` (L0), `Vitals` → `ObjectId`.
- **Blocked by**: T3.1, T4.2
- **Endpoints**: `POST /visits/{id}/vitals`, `GET /visits/{id}/vitals`.
- **Deliverable**: vitals entry form (BP, temp, pulse, resp rate, SpO2, weight, height, blood sugar) with `VitalFlag` severity highlighting on out-of-range readings.

### T5.2 — Consultation
- **Defines**: `Diagnosis`, `Amendment`, `Icd10Entry` (L0); `Consultation` → `ObjectId, Diagnosis, Amendment`; `WriteConsultation`, `DiagnosisInput`, `AmendConsultation`.
- **Blocked by**: T5.1
- **Endpoints**: `POST /consultations`, `GET /consultations/{id}`, `PUT /consultations/{id}`.
- **Deliverable**: SOAP-style note editor (presenting complaint → HPC → ROS → PMH → examination → assessment → plan), ICD-10 diagnosis picker with primary flag, follow-up date. Amending a **signed** note must go through the amendment path and show the audit trail — never silently overwrite.
- **Note**: `Diagnosis.notifiable` and `dhims2Group` feed Phase 13 reporting; surface the notifiable flag at entry time.

### T5.3 — Clinical note search
- **Defines**: `NoteMatch` (L0), `NoteSearchResult` → `NoteMatch`, `NoteIndexResult`.
- **Blocked by**: T5.2
- **Endpoints**: `POST /consultations/search`.
- **Deliverable**: similar-notes panel. `NoteSearchResult.available` can be false (index not built) — design the empty state first.

---

## Phase 6 — Lab (L2)

### T6.1 — Lab catalogue models
- **Defines**: `ReferenceRange` (L0), `Analyte` → `ReferenceRange`, `LabTest` → `ObjectId, Analyte`.
- **Blocked by**: T0.1
- **Endpoints**: `GET /lab/tests`.

### T6.2 — Lab order lifecycle
- **Defines**: `LabResultValue` (L0), `LabOrderItem` → `ObjectId, LabResultValue`, `LabOrder` → `ObjectId, LabOrderItem`; `CreateLabOrder`, `CollectSpecimen`, `EnterResults`, `RejectSpecimen`.
- **Blocked by**: T6.1, T3.1, T4.2
- **Endpoints**: `POST /lab/orders`, `GET /lab/orders/{id}`, `POST /lab/orders/{id}/collect`, `POST /lab/orders/{id}/results`, `POST /lab/orders/{id}/verify`.
- **Deliverable**: order-from-consultation, specimen collection screen (specimen types: blood_edta, blood_serum, blood_fluoride, whole_blood, urine, stool, swab, sputum, none), result entry with per-analyte reference ranges resolved **by sex and age**, verify step gated to lab role, accession number on every worklist row.

---

## Phase 7 — Pharmacy & inventory (L1 → L2)

`Product` is shared by both — model it once, in T7.1.

### T7.1 — Product & stock models
- **Defines**: `Product`, `StockBatch`, `StockMovement`, `Supplier`, `LowStockItem`, `ExpiringBatch`, `StockValuation`.
- **Blocked by**: T0.1
- **Endpoints**: `GET /products`.

### T7.2 — Prescribing & dispensing
- **Defines**: `DispenseRecord` (L0), `PrescriptionItem` → `ObjectId`, `Prescription` → `ObjectId, PrescriptionItem`; `PrescriptionItemInput`, `CreatePrescription`, `DispenseItem`, `SubstituteItem`.
- **Blocked by**: T7.1, T5.2, T4.2
- **Endpoints**: `POST /prescriptions`, `GET /prescriptions/{id}`, `POST /prescriptions/{id}/dispense`, `POST /prescriptions/{id}/substitute`.
- **Deliverable**: prescribing form (drug → dose → `Frequency` → duration → `Route`, with live `stockOnHand`), pharmacy dispense screen supporting **partial** dispense (`quantityPrescribed` vs `quantityDispensed`), substitution with reason. Allergy check against `Patient.allergies` before submit.

### T7.3 — Store / inventory screens
- **Blocked by**: T7.1
- **Endpoints**: `POST /stock-batches`, `GET /stock-movements`, `GET /inventory/valuation`, `GET /inventory/low-stock`, `GET /inventory/expiring`.
- **Deliverable**: goods-receipt form, stock ledger (append-only — read-only UI, no edit affordance), valuation report with expired value split out, low-stock and expiring-batch alert lists.

---

## Phase 8 — Billing (L2)

### T8.1 — Charge & invoice models
- **Defines**: `ChargeItem`, `Charge`, `Invoice`, `Tariff` (all → `ObjectId, PayerType`); `VisitBill` → `Invoice, Charge`; `PriceQuote` → `ChargeItem`; `CreateChargeItem`, `UpdateChargeItem`, `CreateTariff`, `AddCharge`, `WaiveCharge`.
- **Blocked by**: T3.1, T0.2
- **Endpoints**: `GET /charge-items`, `GET /tariffs`, `POST /charges/{id}/quote`, `POST /visits/{id}/charges`, `POST /charges/{id}/waive`, `GET /visits/{id}/bill`.
- **Deliverable**: visit bill view showing the **payer/patient split** per charge line, price-quote widget surfaced *before* ordering (patient cost transparency), waive action gated by role.
- **Note**: `Tariff` is per-payer with an effective date range — display which tariff was applied, never assume the current one.

---

## Phase 9 — Payments & till (L2)

### T9.1 — Payment models
- **Defines**: `Payment`, `TillSession`; `TillSummary` → `TillSession`; `TakePaymentResult` → `Payment, Invoice`.
- **Blocked by**: T8.1
- **Endpoints**: `POST /payments`, `GET /payments`, `POST /till-sessions`, `POST /till-sessions/{id}/close`.
- **Deliverable**: cashier screen (cash, momo, card, bank_transfer, insurance, waiver), receipt view keyed on `receiptNumber`, MoMo sub-state handling from `Payment.momo`, open-till with float, close-till with counted cash and **variance** on the Z-report.
- **Done when**: taking a payment updates the visit bill balance in the same round trip (`TakePaymentResult` carries the updated `Invoice`).

---

## Phase 10 — NHIS claims (L1)

### T10.1 — Claim models & vetting
- **Defines**: `ClaimLine`, `ClaimException` (L0); `Claim` → `ObjectId, ClaimLine, ClaimException`; `ClaimBatch`, `ClaimGenerationSummary`.
- **Blocked by**: T8.1, T5.2 (diagnoses), T7.2 (medicine lines)
- **Endpoints**: `POST /claims/generate`, `GET /claims/{id}`, `POST /claims/{id}/vet`, `POST /claims/batches`, `GET /claims/batches/{id}`.
- **Deliverable**: period generation screen with `ClaimGenerationSummary` (exception counts, held value), claim detail with service vs medicine lines, exception list separating **blocking** from **warning**, `readyToSubmit` gate on batching, batch status tracking (submitted → paid, with shortfall).

---

## Phase 11 — Maternity & immunization (L1 → L2)

### T11.1 — ANC
- **Defines**: `AncRecord` → `ObjectId`.
- **Blocked by**: T3.1, T5.1
- **Endpoints**: `POST /anc`, `GET /patients/{id}/anc`.
- **Deliverable**: ANC contact form (gravida/para, LMP → EDD, gestational age, risk factors), ANC history timeline on the patient folder.

### T11.2 — Delivery & newborn
- **Defines**: `Newborn` → `ObjectId`; `Delivery` → `ObjectId, Newborn`.
- **Blocked by**: T11.1
- **Endpoints**: `POST /deliveries`.
- **Deliverable**: delivery record (mode, labour duration, placenta complete, EBL, complications) with a repeatable newborn block (sex, birth weight + low-birth-weight flag, Apgar, outcome). Multiple births are a normal case.

### T11.3 — Postnatal
- **Defines**: `PostnatalVisit` → `ObjectId`.
- **Blocked by**: T11.2
- **Endpoints**: `POST /postnatal`.
- **Deliverable**: postnatal contact form incl. family-planning counselling and contraceptive method.

### T11.4 — Immunization
- **Defines**: `Immunization` → `ObjectId`.
- **Blocked by**: T2.1
- **Endpoints**: `POST /immunizations`, `GET /patients/{id}/immunizations`.
- **Deliverable**: due/given schedule view on the child's folder, record-given form.

---

## Phase 12 — Appointments & referrals (L1)

### T12.1
- **Defines**: `Appointment`, `Referral`, `NoShowRate` (all → `ObjectId`).
- **Blocked by**: T2.1
- **Endpoints**: `POST /appointments`, `GET /appointments`, `PUT /appointments/{id}`, `GET /patients/{id}/appointments`, `GET /patients/{id}/referrals`.
- **Deliverable**: booking dialog (reachable from consultation follow-up date), day/list view, status updates, referral list on the folder.

---

## Phase 13 — Reports & analytics (L1)

### T13.1 — DHIMS2 return
- **Defines**: `Dhims2AgeRow` (L0), `Dhims2Return` → `Dhims2AgeRow`.
- **Blocked by**: T5.2, T11.x
- **Endpoints**: `GET /reports/dhims2`.
- **Deliverable**: monthly return grouped by attendance / morbidity / maternal / child health / inpatient / notifiable, printable and exportable.

### T13.2 — Metrics & dashboard
- **Defines**: `MetricSummary`, `MetricResult`, `Dashboard`, `DailyTakings`, `ServiceLineRevenue`, `StationCount`.
- **Blocked by**: T9.1, T8.1
- **Endpoints**: `GET /analytics/metrics`, `POST /analytics/query`, `GET /analytics/dashboard`.
- **Deliverable**: executive dashboard (today/month, top diagnosis, bed occupancy, low-stock count, outstanding, NHIS shortfall) + generic metric renderer driven by `MetricResult.visualization` — one chart component per visualization type, not one per metric.

### T13.3 — Natural-language query
- **Defines**: `AskResult` → `MetricResult`; `AssistantStatus`.
- **Blocked by**: T13.2
- **Endpoints**: `POST /analytics/ask`.
- **Deliverable**: ask box rendering narrative + resulting chart + suggested follow-ups. Gate on `AssistantStatus`; degrade cleanly when unavailable.

---

## Phase 14 — Administration (L1 → L2)

### T14.1 — Staff admin
- **Defines**: `CreateStaff`, `UpdateStaff`.
- **Blocked by**: T1.1
- **Endpoints**: `POST /staff`, `GET /staff`, `PUT /staff/{id}`.

### T14.2 — Facility & insurance schemes
- **Defines**: `FacilitySettings` (L0), `Facility` → `ObjectId, FacilitySettings`, `UpdateFacility`, `InsuranceScheme` → `ObjectId, PayerType`, `CreateInsuranceScheme`, `UpdateInsuranceScheme`.
- **Blocked by**: T0.1
- **Endpoints**: `GET /facility`, `PUT /facility`, `GET /insurance-schemes`, `POST /insurance-schemes`.
- **Deliverable**: clinic profile + settings. **`FacilitySettings` feature flags (`hasWard`, `hasMaternity`, `hasLab`, `hasPharmacy`) must gate navigation** — load the facility in the root loader so Phases 6, 7 and 11 can hide themselves.
- **Note**: this is a late *screen* but an early *dependency*. Fetch `GET /facility` in the root loader as part of T1.2 even though the admin UI ships here.

### T14.3 — Platform / health
- **Defines**: `Health`, `ResetResult`.
- **Endpoints**: `GET /health`, `POST /platform/reset`.
- **Deliverable**: health indicator; demo-reset button behind an explicit confirm, only when the endpoint is enabled.

---

## 3. Cross-cutting (run alongside, not after)

- [x] **Codegen decision** — **hand-write** `app/models/*`, per phase, from the spec. Generators emit bare string unions and cannot produce the const-object + label shape T0.1 calls for, and the spec inlines duplicate `$defs` under nearly every path (`PatientSummary` appears ~14 times), which generators expand into a schema per endpoint. Drift is contained by writing each model only when its phase needs it, straight from `openapi.json`.
- [ ] **Pagination** — one `PageMeta`-driven list component reused by every index route.
- [ ] **Error surface** — map `ErrorResponse.code` to user-facing copy in one place; always show `requestId` in the detail view for support.
- [ ] **Offline/latency** — clinic network is likely poor; decide optimistic-UI policy for queue actions and vitals entry.
- [ ] **Print** — receipts, Z-report, DHIMS2 return and claim batches all need a print stylesheet.
- [ ] **Accessibility & touch targets** — these are triage-desk and ward screens; assume gloves and shared tablets.

## 4. Open questions for the backend

1. No realtime channel in the spec — is polling the intended model for `GET /queues/{station}`?
2. `POST /patients/merge` — is it reversible? The UI copy depends on the answer.
3. Ward endpoints are tagged (`Wards`) but no paths appeared in the spec dump — is admission/bed management in scope for MVP? `Dashboard.bedOccupancyPercent` implies it exists somewhere.
4. Is `Referral` write-capable, or read-only (`GET /patients/{id}/referrals` is the only path seen)?
5. Rate limits / token TTL on `expiresIn` — needed to tune the silent-refresh window.
