# Clinic MVP — Frontend Build Tasks (Model-Dependency Order)

Build plan for the `medical-app` frontend against the **Clinic Management API**.
Tasks are ordered by **model dependency**: a task may only be started once every schema it
`$ref`s has already been modelled. The ordering below is a topological sort of the
`components.schemas` reference graph in the live OpenAPI document.

> **Spec synced 2026-08-12** against the deployed backend — 126 paths, 139 schemas, 22 tags.
> The backend has moved on since this plan was first written. See [§5 Spec changelog](#5--spec-changelog-2026-08-12)
> for what changed and which tasks it rewrites. Endpoint lists below are the *current* paths.

---

## 1. Context

| | |
|---|---|
| **Frontend stack** | React Router v8 (framework mode, SSR), React 19, Vite 8, Tailwind v4, shadcn + Base UI, lucide-react |
| **API base URL** | `https://clinic-mvp-backend.auxiliarynetwork.com/api/v1` |
| **Interactive docs** | `https://clinic-mvp-backend.auxiliarynetwork.com/docs` |
| **Spec** | `https://clinic-mvp-backend.auxiliarynetwork.com/openapi.json` (v0.1.0) |
| **Auth** | HTTP Bearer (JWT) from `POST /auth/login`; refresh via `POST /auth/refresh`; revoke via `POST /auth/logout` |
| **Realtime** | **Socket.io** — the API pushes queues, lab, payments, critical vitals and assistant tokens |

### API conventions (encoded in Phase 0)

- **Success envelope**: `{ data: ... }`, plus `{ meta: PageMeta }` on list responses. `PageMeta` is `{page, limit, total, totalPages}`.
- **Error envelope**: `{ error: { code, message, details[] } }`.
- **Money**: integer **pesewas** (100 = GHS 1.00), always paired with a formatted display string. Never do float maths on these.
- **IDs**: 24-char hex ObjectId strings.
- **Timestamps**: ISO 8601 UTC. **Dates**: `YYYY-MM-DD`. **Periods**: `YYYY-MM`.
- **Writes are `PATCH`, not `PUT`** — patients, staff, facility, charge-items, schemes, appointments.
- **List filters** are consistent: `page`, `limit`, `sort` (prefix `-` for descending), plus per-resource filters.
- **Every endpoint declares its required roles** in its description (`**Requires role:** …`, admin always implied). See [§4 Role gates](#4--role-gates-from-the-spec).

### Task notation

- `Defines:` schemas this task turns into TypeScript models.
- `Blocked by:` tasks that must land first (derived from `$ref` edges).
- `Endpoints:` API surface this task consumes.
- `Realtime:` socket events this task should subscribe to instead of polling.
- Each task is done when its models typecheck, its API functions are callable, and its UI renders real data from the deployed backend.

---

## 2. Model dependency layers

The `$ref` graph resolves into five layers. Nothing in layer *N* may be written before layer *N-1* exists.

```
L0  enums + leaf objects   Role, Station, PayerType, NhisExemptionCategory, MembershipStatus,
    (zero $refs)           Frequency, ObjectId, Money, PageMeta, ErrorDetail, PatientAge,
                           NextOfKin, Allergy, ChronicCondition, ProfessionalLicence,
                           ReferenceRange, VitalFlag, VitalsPreview, Diagnosis, DiagnosisInput,
                           Amendment, DispenseRecord, LabResultValue, ClaimLine, ClaimException,
                           ClaimGenerationSummary, Icd10Entry, FacilitySettings, StockValuation,
                           Dhims2AgeRow, DailyTakings, ServiceLineRevenue, MetricSummary,
                           MetricResult, Dashboard, NoteMatch, NoteIndexResult, NoShowRate,
                           SearchHit, SearchableEntities, CalendarSummary, Health, ...

L1  one hop from leaves    ErrorResponse, PayerProfile, PayerSnapshot, StationVisitRecord,
                           StationCount, Staff, Analyte, ChargeItem, Charge, Invoice, Tariff,
                           Product, StockBatch, StockMovement, Supplier, LowStockItem,
                           ExpiringBatch, Payment, TillSession, RecordVitals, Vitals,
                           Consultation, Claim, ClaimBatch, PrescriptionItem, LabOrderItem,
                           Newborn, AncRecord, PostnatalVisit, Immunization, Appointment,
                           Referral, Ward, Bed, Admission, WardNote, MedicationAdministration,
                           Facility, InsuranceScheme, SearchGroup, NoteSearchResult, AskResult,
                           Dhims2Return

L2  composites             PatientSummary, Patient, Session→Staff, LabTest→Analyte,
                           LabOrder→LabOrderItem, Prescription→PrescriptionItem,
                           VisitBill→{Invoice,Charge}, Delivery→Newborn,
                           TillSummary→TillSession, TakePaymentResult→{Payment,Invoice},
                           PriceQuote→ChargeItem, DuplicateCandidate→PatientSummary,
                           SearchResponse→SearchGroup, CalendarDay→Appointment

L3  patient-bearing        QueueEntry→PatientSummary, VisitSummary→PatientSummary,
                           Visit→{PatientSummary, StationVisitRecord, PayerSnapshot},
                           Calendar→CalendarDay

L4  worklists              StationQueue→QueueEntry
```

**Critical path**: `L0 primitives → Staff/Session → PatientSummary/Patient → Visit → QueueEntry → StationQueue`.
Everything else (lab, pharmacy, billing, claims, wards, maternity, analytics) hangs off `Visit` and can be parallelised once Phase 3 lands.

File layout:

```
app/
  models/        one file per domain, mirroring OpenAPI schema names
  lib/api/       client.ts (fetch + envelope + auth) and one module per tag
  routes/        route modules, loaders/actions calling app/lib/api
  components/    ui/ (shadcn) + domain components
```

---

## 3. Status snapshot

| Phase | State |
|---|---|
| Phase 0 — Foundations | **Done** — `primitives.ts`, `enums.ts`, `money.ts` (+tests), `lib/api/client.ts` (+integration test), root layout, ~35 shadcn primitives, `route-error.tsx` |
| Phase 1 — Identity | **T1.1/T1.2 done** (`models/staff.ts`, `models/auth.ts`, `lib/auth.server.ts`, login/logout routes). **T1.3 pending** — `NAV_GROUPS` in `app-shell.tsx` is unfiltered. **T1.4 (search) not started** — the topbar search box is a dumb `Input` |
| Phase 2 — Patient | **Done** — `models/patient.ts`, registration/folder/edit/merge routes, `patient-form.tsx`, `duplicate-candidates.tsx` |
| Phase 3 — Visit | **Done** — `models/visit.ts`, `lib/api/visits.ts`, `visit-header.tsx`, `station-timeline.tsx`, `visits.tsx`, `visit-new.tsx`, `visit-detail.tsx` with move/close/cancel |
| Phase 4 — Queues | **Done** — `models/queue.ts` (+tests), `lib/api/queues.ts`, `station-queue.tsx`, `opd.tsx`, `queue-actions.tsx`, polling hook |
| Phase 5 — Clinical capture | **Done** — `models/vitals.ts`, `models/consultation.ts`, `lib/api/{vitals,consultations,notes}.ts`, `vital-flags.tsx`, `icd10-picker.tsx`, `similar-notes.tsx`, `visit-vitals.tsx`, `visit-consultation.tsx`, and three `resources/*` routes |
| Phase 6 — Lab | **Done** — `models/lab.ts` (+tests), `lib/api/lab.ts`, `lab-results.tsx`, `lab-test-picker.tsx`, `laboratory.tsx` (bench + station queue tabs), `lab-order.tsx` (collect, per-item results/verify/reject), `visit-lab.tsx` (order-from-consultation, verified-results readback), `resources/lab-tests` |
| Phase 7 — Pharmacy & inventory | **Done** — `models/inventory.ts` + `models/pharmacy.ts` (both +tests), `lib/api/{inventory,pharmacy}.ts`, `dispensing.tsx`, `product-picker.tsx`, `stock-ledger.tsx`, `visit-prescription.tsx` (prescribing with allergy gate), `pharmacy.tsx` (counter + station queue tabs), `prescription.tsx` (per-item dispense/substitute/out-of-stock), `inventory.tsx` (stock, low-stock, expiring + valuation), `product-detail.tsx` (batches + adjust), `inventory-receive.tsx`, `inventory-suppliers.tsx`, `inventory-movements.tsx`, `resources/products` |
| Phase 14 — Admin | **T14.1 done out of order** (`staff.tsx`, `staff-drawer.tsx`, `lib/api/staff.ts`). **T14.2 partly** — `models/facility.ts` and `lib/api/facility.ts` exist; the root loader still does not fetch `GET /facility`, which Phases 6/7/11/15 need for feature gating. `lib/api/platform.ts` covers T14.3's health call |
| Phases 8–13, 15 | Not started |

`app/lib/api/*` already targets the current paths (`/patients/check-duplicates`, `/visits/open`, `/auth/logout`) — the code kept pace with the API; this plan is what had drifted.

**Pattern established in Phase 5, reusable from here on**: live lookups go through read-only `resources/*` routes rather than actions on the screen that needs them. The access token lives in an httpOnly cookie so the browser cannot call the API directly, and a `GET` `fetcher.load()` answers a keystroke *without* revalidating the calling route. Two of the five wrap an API `POST` that writes nothing (`/vitals/preview`, `/analytics/notes/search`) — exposing them as `GET` is what keeps them off the revalidation path. `resources/lab-tests` (T6.2) and `resources/products` (T7.1) followed; Phase 8's price quote is the next one.

---

## Phase 0 — Foundations (L0) ✅

### T0.1 — Primitive types and enums ✅
- **Defines**: `ObjectId`, `Money`, `PageMeta`, `ErrorDetail`, `ErrorResponse`, `Role`, `Station`, `PayerType`, `NhisExemptionCategory`, `MembershipStatus`, `Frequency`, plus inline enums.
- **Deliverable**: `app/models/primitives.ts`, `app/models/enums.ts`.
- **Note**: `Role` (admin, records, nurse, doctor, physician_assistant, midwife, lab, pharmacy, store, cashier, claims) and `Station` (records, vitals, consulting, lab, pharmacy, cashier, injection, anc, ward) drive navigation and permissions everywhere — modelled as const objects + union types via `defineEnum`, not bare string enums.

### T0.1b — Enum backfill (new work)
- **Blocked by**: T0.1
- **Deliverable**: extend `app/models/enums.ts` with the value sets the current spec added. Each is consumed by a later phase, so add them as that phase lands rather than all at once:

| Set | Values | Used by |
|---|---|---|
| `QueueStatuses` | waiting, in_service, done, skipped, left | T4.1 |
| `ChargeCategories` | consultation, lab, imaging, medication, procedure, bed, consumable, registration, other | T8.1 |
| `ChargeStatuses` | pending, billed, paid, waived, cancelled | T8.1 |
| `ChargeSources` | registration, consultation, lab_order, prescription, procedure, bed_day, manual | T8.1 |
| `InvoiceStatuses` | open, partly_paid, paid, void | T8.1 |
| `PaymentStatuses` | pending, successful, failed, reversed | T9.1 |
| `ClaimStatuses` | draft, vetted, batched, submitted, paid, part_paid, rejected, resubmitted | T10.1 |
| `ClaimBatchStatuses` | open, submitted, paid, part_paid, closed | T10.1 |
| `ExceptionSeverities` | blocking, warning, info | T10.1 |
| ~~`VitalFlagSeverities`~~ ✅ | info, warning, critical | T5.1 — **done** |
| ~~`DiagnosisTypes`~~ ✅ | provisional, final, differential | T5.2 — **done** |
| ~~`NoteSearchModes`~~ ✅ | semantic, lexical | T5.3 — **done** |
| ~~`LabOrderStatuses`~~ ✅ | ordered, collected, resulted, verified, rejected, **cancelled** (live spec adds it) | T6.2 — **done** |
| ~~`LabResultTypes`~~ ✅ | numeric, text, select | T6.2 — **done** |
| ~~`LabResultFlags`~~ ✅ | low, normal, high, critical_low, critical_high, abnormal | T6.2 — **done** |
| `PrescriptionItemStatuses` | pending, dispensed, partially_dispensed, out_of_stock, substituted | T7.2 |
| `ProductCategories` | drug, consumable, reagent, equipment | T7.1 |
| `StockMovementTypes` | receipt, dispense, adjustment, wastage, expiry, return, stock_take | T7.1 |
| `WardTypes` | general, maternity, observation, private, paediatric | T15.1 |
| `BedStatuses` | free, occupied, cleaning, blocked | T15.1 |
| `AdmissionStatuses` | admitted, discharged, transferred | T15.1 |
| `WardNoteTypes` | ward_round, nursing, progress, handover | T15.3 |
| `MedicationStatuses` | given, missed, refused, held | T15.3 |
| `DeliveryModes` | svd, assisted_breech, vacuum, forceps, caesarean | T11.2 |
| `Presentations` | cephalic, breech, transverse, oblique, unstable | T11.2 |
| `DeliveryComplications` | postpartum_haemorrhage, obstructed_labour, pre_eclampsia, eclampsia, retained_placenta, perineal_tear, cord_prolapse, sepsis, ruptured_uterus | T11.2 |
| `BirthOutcomes` | live_birth, fresh_stillbirth, macerated_stillbirth | T11.2 |
| `AppointmentStatuses` | scheduled, confirmed, arrived, completed, cancelled, no_show | T12.1 |
| `ReferralDirections` | out, in · `ReferralUrgencies` routine, urgent, emergency · `FacilityTypes` clinic, hospital, maternity_home, health_centre | T12.1 |
| `SearchEntities` | patient, visit, appointment, staff, invoice, payment, lab_order, claim, product, diagnosis | T1.4 |
| `MetricColumnTypes` | string, number, money, date, percent | T13.2 |

### T0.2 — Money utilities ✅
- **Deliverable**: `app/lib/money.ts` — `formatPesewas()`, `toPesewas()`, `sumPesewas()`. Integer-only arithmetic, unit-tested.

### T0.3 — API client ✅
- **Deliverable**: `app/lib/api/client.ts` — typed `request<T>()` unwrapping `{data}`/`{meta}`, typed `ApiError`, bearer injection, env-var base URL.

### T0.4 — App shell, theming, error boundary ✅
- **Deliverable**: root layout, Tailwind theme, shadcn primitives, route `ErrorBoundary` rendering `ApiError` shape.

### T0.5 — Socket.io client (new)
- **Blocked by**: T0.3, T1.2
- **Deliverable**: `app/lib/realtime.ts` — a browser-only Socket.io client authenticated with the access token, with a `useRealtime(event, handler)` hook and automatic reconnect. SSR-safe: connect in an effect, never during a loader.
- **Note**: `GET /health` reports `checks.realtime: up|down` and `checks.ai: enabled|disabled`. Treat the socket as an **accelerator, not a source of truth** — every screen must still work on loader data alone when `realtime` is down, degrading to `revalidate` on an interval.
- **Done when**: a second browser tab sees a queue change without a manual refresh, and killing the socket does not break the screen.

---

## Phase 1 — Identity & access (L1 → L2)

### T1.1 — Staff model ✅
- **Defines**: `ProfessionalLicence` (L0), `Staff` → `ObjectId, Role, Station, ProfessionalLicence`.
- **Deliverable**: `app/models/staff.ts`.

### T1.2 — Session + auth flow ✅
- **Defines**: `Session` → `Staff`, `LoginRequest`, `RefreshRequest`, `ChangePasswordRequest`.
- **Endpoints**: `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`.
- **Deliverable**: login route, server-side session cookie holding the JWT pair, `requireStaff()` loader helper, silent refresh on `expiresIn`, logout.

### T1.3 — Role/station-aware navigation
- **Blocked by**: T1.2, T14.2 (facility flags)
- **Deliverable**: filter `NAV_GROUPS` in `app-shell.tsx` by the signed-in staff member's `roles[]`/`station` **and** `FacilitySettings` feature flags. Treat this as UX routing, not security — the API is the authority.
- **Note**: the role sets are no longer guesswork — [§4](#4--role-gates-from-the-spec) is lifted from the spec. Encode them once as a `MODULE_ROLES` map so a nav entry and its route guard cannot disagree.

### T1.4 — Global search (new)
- **Defines**: `SearchHit`, `SearchableEntities` (L0); `SearchGroup` → `SearchHit`; `SearchResponse` → `SearchGroup`.
- **Blocked by**: T1.2
- **Endpoints**: `GET /search?q&type&from&to&status&page&limit`, `GET /search/entities`.
- **Deliverable**: wire the topbar search `Input` in `app-shell.tsx` to a command palette (⌘/Ctrl+K) over the existing `command.tsx` primitive. Render one section per `SearchGroup` using its `label` + `total`, a "view all" control when `hasMore`, and `SearchHit.title`/`subtitle`/`meta`/`badge` per row. Navigate with `SearchHit.href`; highlight `matchedOn`.
- **Notes**:
  - Under two characters the API returns an empty result — do not fire the request.
  - `GET /search/entities` says which groups *this user* may search; drive the type filter from it rather than hardcoding the ten entities.
  - `tookMs` is server time — use it to tune the debounce.
  - `href`/`viewAllHref` are *suggestions* from the backend. Remap from `entity` + `id` where our routes differ (they currently do for everything except patients).

---

## Phase 2 — Patient (L2) ✅

### T2.1 — Patient models ✅
- **Defines**: `PatientAge`, `NextOfKin`, `Allergy`, `ChronicCondition` (L0); `PayerProfile`/`PayerProfileInput` (L1); `PatientSummary`; `Patient`.
- **Deliverable**: `app/models/patient.ts`.
- **Note**: `PatientAge` carries `{years, months, display, accuracy}` — estimated ages are normal here. Always render `display`; never recompute age from a DOB.

### T2.2 — Registration & folder ✅
- **Defines**: `CreatePatient`, `UpdatePatient`.
- **Endpoints**: `GET /patients` (`q`, `payerType`, `sex`, `includeMerged`, `page`, `limit`, `sort`), `POST /patients`, `GET /patients/{id}`, **`PATCH /patients/{id}`**, `GET /patients/by-folder/{folderNumber}`.
- **Deliverable**: registration form, patient folder view with allergy/chronic-condition banner, directory.

### T2.3 — Duplicate detection & merge ✅
- **Defines**: `DuplicateSearch`, `DuplicateCandidate` → `PatientSummary`, `MergePatients`.
- **Endpoints**: **`POST /patients/check-duplicates`**, `POST /patients/merge`.
- **Note**: the endpoint is designed to be called *while the clerk types* — Ghana Card / NHIS / phone matches are decisive, names are fuzzy-matched because spellings and name order vary legitimately.

---

## Phase 3 — Visit (L3) — critical path

### T3.1 — Visit models ✅ (uncommitted)
- **Defines**: `PayerSnapshot`, `StationVisitRecord` (L1); `VisitSummary`, `Visit`; `CheckIn`, `MoveStation`, `CloseVisit`.
- **Deliverable**: `app/models/visit.ts`.
- **Note**: `PayerSnapshot` is the payer *as at check-in* — do not substitute the patient's current `PayerProfile` when rendering a visit or its bill.

### T3.2 — Check-in and visit lifecycle (in progress)
- **Blocked by**: T3.1
- **Endpoints**: `GET /visits`, `POST /visits`, **`GET /visits/open`**, `GET /visits/{id}`, **`POST /visits/{id}/move`**, `POST /visits/{id}/close`, **`POST /visits/{id}/cancel`**.
- **Deliverable**: check-in flow (patient → visit type → priority → payer), visit header component reused by every station screen, station-history timeline, close-visit dialog with `Disposition` (discharged, admitted, referred, absconded, died, dama).
- **Still to wire**: `move`, `close`, `cancel`.
- **Visit types**: opd, review, emergency, anc, postnatal, immunization, admission, walk_in_lab, walk_in_pharmacy.
- **Notes**:
  - `GET /visits/open` returns `null` — not a 404 — when the patient is not in the clinic. Check before offering "check in" on a folder.
  - `cancel` is not a failed `close`: the patient left before being seen, so there is no `Disposition` and nothing clinical was recorded. Only an `open` visit accepts work.

---

## Phase 4 — Queues (L3 → L4)

### T4.1 — Queue models
- **Defines**: `QueueEntry` → `ObjectId, PatientSummary, Station`; `StationQueue` → `Station, QueueEntry`; `StationCount` → `Station`; `EnqueuePatient`, `QueueAction`.
- **Blocked by**: T3.1
- **Deliverable**: `app/models/queue.ts`.

### T4.2 — Station worklist screen
- **Blocked by**: T4.1, T0.5
- **Endpoints**: `GET /queues` (counters for every station), `POST /queues` (enqueue), `GET /queues/{station}`, `POST /queues/{station}/call-next`, `POST /queues/entries/{id}/call`, `POST /queues/entries/{id}/complete`, `POST /queues/entries/{id}/skip`, **`POST /queues/entries/{id}/requeue`**.
- **Realtime**: emit `queue:subscribe`, then handle `queue:updated` (same payload as `GET /queues/{station}`) and `queue:counters` (same payload as `GET /queues`).
- **Deliverable**: one reusable worklist component parameterised by `Station`, with the counters the API returns (waiting, inService, completedToday, longestWait, averageWait), priority sorting (emergency > urgent > routine — use `comparePriority`, never a raw string sort), and call/call-next/complete/skip/requeue actions.
- **Notes**:
  - `POST /queues/{station}/call-next` returns `null` when nobody is waiting — render "queue empty", don't throw.
  - `call` vs `call-next`: `call-next` takes the top of the queue; `entries/{id}/call` pulls a specific patient out of turn. Both belong on the screen; the out-of-turn one should look deliberate.
  - `requeue` returns a skipped patient to the queue — the recovery path for "they came back".
  - Any signed-in staff member may *view* any queue (the front desk needs to see where the crowd is); acting on one is role-gated by the station's own module.
- **Done when**: every station module in Phases 5–7 and 15 mounts this component rather than rolling its own list.

---

## Phase 5 — Clinical capture (L1) ✅

Parallelisable once Phase 3 lands.

### T5.1 — Vitals ✅
- **Defines**: `VitalFlag`, `VitalsPreview` (L0); `RecordVitals`, `Vitals` → `ObjectId, VitalFlag`.
- **Blocked by**: T3.1, T4.2
- **Endpoints**: **`POST /vitals`** (body carries `visitId`), `GET /vitals`, `GET /vitals/{id}`, **`POST /vitals/preview`**.
- **Deliverable**: `app/models/vitals.ts`, `app/lib/api/vitals.ts`, `app/components/vital-flags.tsx`, `app/routes/visit-vitals.tsx`, and the `/resources/vitals-preview` resource route.
- **Fields**: temperature, systolic, diastolic, pulse, respiratoryRate, spo2, weightKg, heightCm, randomBloodSugar, fastingBloodSugar, **muacCm**, **painScore**, notes.
- **Notes**:
  - `POST /vitals/preview` returns `{bmi, flags}` **without saving** — debounced as the nurse types, so the flag appears while the cuff is still on the arm. There is deliberately **no client-side range table**: `VITAL_BOUNDS` in the model holds the API's own *input* limits (a temperature of 4 °C is a typo) and nothing about what is clinically normal.
  - **`ageYears` must be sent to the preview.** It has no `visitId`, so the API cannot look the patient up, and without an age it grades against **adult** ranges — silently under-flagging a child. `previewVitalsForAge()` makes the argument mandatory so it cannot be dropped.
  - `VitalFlag.severity` is **info / warning / critical**, with no `normal` member — a flag only exists for a reading worth mentioning, so an empty `flags[]` means "nothing to report", never "not checked". (The low/normal/high/critical_* set is `LabResultValue.flag`, T6.2.)
  - Vitals are posted to a top-level collection with `visitId` in the body, *not* nested under the visit, and are **never edited** — a recheck is a new set, so the screen lists every set on the visit rather than replacing one.
  - A critical reading is pushed to the ordering clinician over the socket. Until T0.5 lands, the screen says so itself on the saved set.

### T5.2 — Consultation ✅
- **Defines**: `Diagnosis`, `DiagnosisInput`, `Amendment`, `Icd10Entry` (L0); `Consultation`; `WriteConsultation`, `AmendConsultation`.
- **Blocked by**: T5.1
- **Endpoints**: `POST /consultations`, `GET /consultations`, `GET /consultations/{id}`, **`POST /consultations/{id}/amend`**, **`GET /consultations/icd10`** (search), **`GET /consultations/icd10/all`**.
- **Deliverable**: `app/models/consultation.ts`, `app/lib/api/consultations.ts`, `app/components/icd10-picker.tsx`, `app/routes/visit-consultation.tsx`, and the `/resources/icd10` typeahead route.
- **Notes**:
  - **`POST /consultations` is an upsert keyed on the visit** — one note per visit, and posting again replaces it *until it is signed*. So "save draft, come back after the lab result" is the same call as writing it, and the whole note must go up each time rather than the changed fields. Once signed it answers `409`.
  - Amending goes through **`POST /{id}/amend`** — there is no `PUT`. The screen shows **no edit affordance at all** on a signed note, not even a disabled one; the amendment trail (`Amendment[]`) is the record's defence and is always visible.
  - The ICD-10 subset has its own endpoints. `GET /consultations/icd10/all` is small enough to cache client-side for offline picking; `GET /consultations/icd10` is the typeahead behind the picker.
  - `Diagnosis.notifiable` and `dhims2Group` are resolved by the API from the catalogue and are **not** the clinician's to set — both are surfaced at the moment of coding, since the point of notifying the district is that it happens while the patient is still reachable.
  - `signingProblems()` in the model holds the rules that gate signing (assessment written, one diagnosis, exactly one primary, a differential can never be primary, no duplicate codes) so writing and amending cannot enforce different ones. A **draft is not validated** — a half-written note is a legitimate save when a patient is called away.

### T5.3 — Clinical note search ✅
- **Defines**: `NoteMatch` (L0), `NoteSearchResult` → `NoteMatch`, `NoteIndexResult`.
- **Blocked by**: T5.2
- **Endpoints**: **`POST /analytics/notes/search`**, **`POST /analytics/notes/index`**.
- **Deliverable**: `app/components/similar-notes.tsx` beside the note editor, and the `/resources/note-search` route.
- **Notes**:
  - these moved from `/consultations/*` to the Analytics tag. Search modes are `semantic` and `lexical`; semantic degrades to lexical when the AI service is disabled, and **the mode is always on screen** — an empty semantic result and an empty lexical one mean very different things.
  - `available: false` (index not built) renders as prose explaining why, never as an empty list — the empty state was built first for exactly this reason.
  - Searching is explicit rather than live: it reads other patients' records, so it should be an act the clinician chose. `403`, `404` and 5xx all degrade to a quiet message rather than interrupting a consultation.
  - `POST /analytics/notes/index` is admin-only and batched (`remaining > 0` means run again) — it belongs on an operations screen, not here.

---

## Phase 6 — Lab (L2) ✅

### T6.1 — Lab catalogue models ✅
- **Defines**: `ReferenceRange` (L0), `Analyte` → `ReferenceRange`, `LabTest` → `ObjectId, Analyte`.
- **Blocked by**: T0.1
- **Endpoints**: `GET /lab/tests`, **`GET /lab/tests/{id}`**.

### T6.2 — Lab order lifecycle ✅ (polling until T0.5)
- **Defines**: `LabResultValue` (L0), `LabOrderItem`, `LabOrder`; `CreateLabOrder`, `CollectSpecimen`, `EnterResults`, `RejectSpecimen`.
- **Blocked by**: T6.1, T3.1, T4.2, T0.5
- **Endpoints**: `POST /lab/orders`, `GET /lab/orders`, `GET /lab/orders/{id}`, `POST /lab/orders/{id}/collect`, **`GET /lab/worklist`**, and **per-item** actions:
  - `POST /lab/orders/{orderId}/items/{itemId}/results`
  - `POST /lab/orders/{orderId}/items/{itemId}/verify`
  - `POST /lab/orders/{orderId}/items/{itemId}/reject`
- **Realtime**: `lab:ordered`, `lab:updated` push the worklist payload.
- **Deliverable**: order-from-consultation, specimen collection screen (blood_edta, blood_serum, blood_fluoride, whole_blood, urine, stool, swab, sputum, none), result entry with per-analyte reference ranges resolved **by sex and age**, verify step gated to `lab`, accession number on every worklist row.
- **Note**: **results, verify and reject are per *item*, not per order.** A four-test panel can be part-resulted, and one specimen can be rejected while the rest run. Model the order as a container and drive every action off `LabOrderItem` — an order-level "enter results" button cannot express what the API does. `GET /lab/worklist` is the bench view (awaiting collection / result entry / verification, urgent first) and should mount T4.2's component.

---

## Phase 7 — Pharmacy & inventory (L1 → L2) ✅

`Product` is shared by both — model it once, in T7.1.

### T7.1 — Product & stock models ✅
- **Defines**: `Product`, `StockBatch`, `StockMovement`, `Supplier`, `LowStockItem`, `ExpiringBatch`, `StockValuation`.
- **Blocked by**: T0.1
- **Endpoints**: `GET /inventory/products`, `GET /inventory/products/{id}`, `GET /inventory/products/{id}/batches`.
- **Deliverable**: `app/models/inventory.ts` (+tests), `app/lib/api/inventory.ts`, `app/components/product-picker.tsx`, and the `/resources/products` lookup route.
- **Notes**:
  - `Product.label` is the pre-composed "generic, strength, brand" display string — use it rather than concatenating. `stockOnHand` and `belowReorderLevel` come live on the product.
  - `stockOnHand` is **optional** on the wire, so nothing treats a missing value as zero: "not looked up" and "none left" send a patient to two different places, and `StockLevel` renders them differently.
  - The four new closed sets (`ProductCategories`, `StockMovementTypes`, `PrescriptionStatuses`, `PrescriptionItemStatuses`) went into `models/enums.ts` with the rest, not beside their models.
  - `GET /inventory/products/{id}/batches` returns batches **in expiry order** — the order the pharmacy will dispense in — so `nextBatchOut()` is a find, not a sort, and the product page marks the box the counter should open next.

### T7.2 — Prescribing & dispensing ✅
- **Defines**: `DispenseRecord` (L0), `PrescriptionItem`, `Prescription`; `PrescriptionItemInput`, `CreatePrescription`, `DispenseItem`, `SubstituteItem`.
- **Blocked by**: T7.1, T5.2, T4.2
- **Endpoints**: `POST /pharmacy/prescriptions`, `GET /pharmacy/prescriptions`, `GET /pharmacy/prescriptions/{id}`, **`GET /pharmacy/queue`**, and **per-item** actions:
  - `POST /pharmacy/prescriptions/{prescriptionId}/items/{itemId}/dispense`
  - `POST /pharmacy/prescriptions/{prescriptionId}/items/{itemId}/substitute`
  - **`POST /pharmacy/prescriptions/{prescriptionId}/items/{itemId}/out-of-stock`**
- **Deliverable**: `app/models/pharmacy.ts` (+tests), `app/lib/api/pharmacy.ts`, `app/components/dispensing.tsx`, `app/routes/visit-prescription.tsx` (prescribing form: drug → dose → `Frequency` → duration → `Route`, with live `stockOnHand`), `app/routes/pharmacy.tsx` (counter + station queue tabs), `app/routes/prescription.tsx` (per-item dispense supporting **partial**, substitution with reason, explicit out-of-stock).
- **Notes**:
  - same per-item shape as lab. `out-of-stock` is a first-class result, not an error — it closes the item so the patient can be sent to buy outside, and it feeds the low-stock report. It reads as a closed outcome in grey; red is kept for a cancelled line.
  - **The allergy check is the client's alone.** The API does not check, and `allergyMatches()` matches drug *names*, not classes — it will miss a cephalosporin against a penicillin allergy. So the folder's allergies are on screen throughout (prescribing *and* dispensing), a name that matches blocks the submit button until the prescriber acknowledges it, and the copy says the highlight is not a safety system. `Visit.patient` is a `PatientSummary` and carries no allergies: both screens load the folder.
  - **The quantity is derived, not typed twice.** `estimateQuantity()` previews what "1 tablet tds for 5 days" comes to while the line is written; `POST /pharmacy/prescriptions` does the same arithmetic on save and its answer is the record. `prn` and a zero-day course return `undefined` rather than a guess.
  - Prescribing raises **no** charge — the bill follows what is dispensed — and the form says so where a clinician would assume the opposite.
  - `GET /pharmacy/queue` carries ids, not patients. Rather than fetch a visit per row on every poll, the counter reads names off the `pharmacy` station queue it already loads for the other tab; a script whose patient is not in the corridor shows without a name.

### T7.3 — Store / inventory screens ✅
- **Blocked by**: T7.1
- **Endpoints**: **`POST /inventory/receive`** (productId, batchNumber, expiryDate, quantity, costPricePesewas, supplierId), **`POST /inventory/batches/{id}/adjust`**, `GET /inventory/movements`, `GET /inventory/low-stock`, `GET /inventory/expiring`, `GET /inventory/valuation`, `GET /inventory/suppliers`, `POST /inventory/suppliers`.
- **Deliverable**: `app/routes/inventory.tsx` (stock / low-stock / expiring tabs under the valuation), `app/routes/product-detail.tsx` (batches + the adjust action), `app/routes/inventory-receive.tsx`, `app/routes/inventory-suppliers.tsx`, `app/routes/inventory-movements.tsx`, `app/components/stock-ledger.tsx`.
- **Notes**:
  - `StockMovement.quantity` is **negative for anything leaving the store** and `balanceAfter` is the running total — the ledger renders as a signed column with a true minus sign, never an absolute one, and carries no edit affordance anywhere. A mistake is corrected by another movement.
  - The adjust dialog offers a **direction plus a magnitude** and signs the number itself, and it deliberately does not offer `receipt` or `dispense`: stock arrives through the goods receipt and leaves through the counter, each of which records far more than an adjustment can.
  - The goods-receipt cost is **per unit of issue**, not per delivery — typed in cedis, sent as integer pesewas through `tryToPesewas()`. The valuation is counted at it, so the field says so.
  - The valuation splits expired value out rather than folding it into the total: expired stock is a write-off on a shelf, not stock the clinic has.
  - The low-stock list sorts by how far below the reorder level a product has fallen (`compareLowStock`), because it is a buying list rather than an index.
  - A `StockMovement` carries only a product id, so the unfiltered ledger fetches a catalogue page to put names on the lines; anything it does not cover renders as a link, never a guessed name.

---

## Phase 8 — Billing (L2)

### T8.1 — Charge & invoice models
- **Defines**: `ChargeItem`, `Charge`, `Invoice`, `Tariff`; `VisitBill` → `Invoice, Charge`; `PriceQuote` → `ChargeItem`; `CreateChargeItem`, `UpdateChargeItem`, `CreateTariff`, `AddCharge`, `WaiveCharge`.
- **Blocked by**: T3.1, T0.2
- **Endpoints**: `GET /billing/charge-items`, `POST /billing/charge-items`, **`PATCH /billing/charge-items/{id}`**, `GET /billing/tariffs`, `POST /billing/tariffs`, **`GET /billing/quote?visitId&chargeItemId&quantity`**, `GET /billing/visits/{id}/bill`, `POST /billing/visits/{id}/charges`, `GET /billing/charges`, `POST /billing/charges/{id}/waive`, **`POST /billing/charges/{id}/cancel`**, **`GET /billing/invoices/{id}`**.
- **Deliverable**: visit bill view showing the **payer/patient split** per charge line, price-quote widget surfaced *before* ordering (patient cost transparency), waive and cancel actions gated by role.
- **Notes**:
  - The quote is a **GET with query params**, not a POST — it is cheap and cacheable, so call it live as the clinician picks an item.
  - `Charge` carries `coveredByPayer`, `coverageNote` (plain words, readable to the patient), `payerPortionPesewas`, `patientPortionPesewas` and `shortfallPesewas` (how far the payer tariff falls below the clinic price — absorbed by the clinic). Show the patient portion prominently and the shortfall only to finance.
  - `Charge.sourceType` says where the line came from (registration, consultation, lab_order, prescription, procedure, **bed_day**, manual). Manual lines are the only ones that should look editable.
  - **Waive ≠ cancel**: waive forgives a legitimate charge and is reported on; cancel removes one raised in error. Different roles, different copy.
  - `Tariff` is per-payer with an effective date range — display which tariff was applied, never assume the current one.

### T8.2 — Insurance schemes (moved here from T14.2)
- **Defines**: `InsuranceScheme` → `ObjectId, PayerType`, `CreateInsuranceScheme`, `UpdateInsuranceScheme`.
- **Blocked by**: T8.1
- **Endpoints**: **`GET /schemes`, `POST /schemes`, `GET /schemes/{id}`, `PATCH /schemes/{id}`** — top-level paths under the **Billing** tag, not `/insurance-schemes` and not under Facility.
- **Deliverable**: scheme/corporate-account list and editor; the scheme picker consumed by `PayerProfileInput` in T2.2.

---

## Phase 9 — Payments & till (L2)

### T9.1 — Payment models
- **Defines**: `Payment`, `TillSession`; `TillSummary` → `TillSession`; `TakePaymentResult` → `Payment, Invoice`.
- **Blocked by**: T8.1, T0.5
- **Endpoints**: `POST /payments`, `GET /payments`, `GET /payments/{id}`, **`POST /payments/{id}/reverse`**, **`POST /payments/till/open`**, **`GET /payments/till/current`**, **`GET /payments/till/{id}/summary`**, **`POST /payments/till/{id}/close`**, **`GET /payments/till/sessions`**.
- **Realtime**: `payment:received` fires when the MoMo gateway calls back.
- **Deliverable**: cashier screen (cash, momo, card, bank_transfer, insurance, waiver), receipt view keyed on `receiptNumber`, MoMo sub-state handling from `Payment.momo`, open-till with float, close-till with counted cash and **variance** on the Z-report, payment reversal behind a confirm.
- **Notes**:
  - **MoMo is asynchronous.** Cash and card settle immediately; mobile money returns a **pending** payment and a prompt goes to the patient's handset. The money is not counted until `payment:received` arrives (or `GET /payments/{id}` is polled as the fallback). Nothing downstream may assume a MoMo payment succeeded because it was requested — the receipt must not print on `pending`.
  - `GET /payments/till/current` is the "am I already open?" check the cashier screen should run in its loader.
- **Done when**: taking a payment updates the visit bill balance in the same round trip (`TakePaymentResult` carries the updated `Invoice`), and a pending MoMo payment flips to successful without a manual refresh.

---

## Phase 10 — NHIS claims (L1)

### T10.1 — Claim models & vetting
- **Defines**: `ClaimLine`, `ClaimException`, `ClaimGenerationSummary` (L0); `Claim`; `ClaimBatch`.
- **Blocked by**: T8.1, T5.2 (diagnoses), T7.2 (medicine lines)
- **Endpoints**: `POST /claims/generate` (body `{period}`), **`GET /claims/summary/{period}`**, `GET /claims`, `GET /claims/{id}`, **`POST /claims/{id}/revalidate`**, **`POST /claims/{id}/reject`**, `POST /claims/batches`, **`GET /claims/batches/list`**, **`POST /claims/batches/{id}/submit`**, **`POST /claims/batches/{id}/payment`**.
- **Deliverable**: period generation screen with `ClaimGenerationSummary` (visitsExamined, claimsCreated, claimsSkipped, readyCount, heldCount, ready/held value, exceptionCounts), claim detail with service vs medicine lines, exception list separating **blocking** from **warning**, `readyToSubmit` gate on batching, batch lifecycle open → submitted → paid/part_paid with `shortfallPesewas`.
- **Notes**:
  - **There is no `/vet` endpoint.** Vetting is now: fix the underlying record, then `POST /claims/{id}/revalidate`, which rebuilds the claim from the visit and clears exceptions that have been fixed. The UI is therefore a *worklist that sends you to the source record and back*, not a form that edits the claim. Deep-link each exception to the thing that must change (missing diagnosis → consultation, unpriced item → tariff).
  - `POST /claims/{id}/reject` records an **NHIA** rejection with a reason; `rejected` claims can be corrected and go to `resubmitted`.
  - `POST /claims/batches/{id}/payment` records what the NHIA actually reimbursed — the shortfall it computes is the number the dashboard's `nhisShortfallPesewas` reports.
  - Every Claims endpoint requires the `claims` role (or admin) — no read-only view for other staff.

---

## Phase 11 — Maternity & immunization (L1 → L2)

All maternity paths are under **`/maternity/*`**, including immunization.

### T11.1 — ANC
- **Defines**: `AncRecord` → `ObjectId`.
- **Blocked by**: T3.1, T5.1
- **Endpoints**: **`POST /maternity/anc`**, **`GET /maternity/anc`** (filter by `patientId`).
- **Deliverable**: ANC contact form (gravida/para, LMP → EDD, gestational age, risk factors), ANC history timeline on the patient folder.

### T11.2 — Delivery & newborn
- **Defines**: `Newborn` → `ObjectId`; `Delivery` → `ObjectId, Newborn`.
- **Blocked by**: T11.1
- **Endpoints**: **`POST /maternity/deliveries`**, **`GET /maternity/deliveries`**.
- **Deliverable**: delivery record (mode: svd/assisted_breech/vacuum/forceps/caesarean; presentation; labour duration; placenta complete; EBL; complications) with a repeatable newborn block (sex, birth weight + low-birth-weight flag, Apgar, outcome: live_birth/fresh_stillbirth/macerated_stillbirth). Multiple births are a normal case.

### T11.3 — Postnatal
- **Defines**: `PostnatalVisit` → `ObjectId`.
- **Blocked by**: T11.2
- **Endpoints**: **`GET /maternity/postnatal`**, **`POST /maternity/postnatal/{id}`**.
- **Deliverable**: postnatal contact form — mother (temperature, BP, lochia, uterine involution, breastfeeding established) and baby (weight, temperature, cord condition, feeding, jaundice) — plus family-planning counselling and contraceptive method.
- **Note**: the POST is `/{id}`-scoped, so a postnatal contact is **recorded against an existing record** rather than created free-standing. Confirm with the backend whether `{id}` is the delivery or the postnatal record (see [§6 open questions](#6--open-questions-for-the-backend)).

### T11.4 — Immunization
- **Defines**: `Immunization` → `ObjectId`.
- **Blocked by**: T2.1
- **Endpoints**: **`GET /maternity/immunizations`** (`patientId`, **`dueOnly`**), **`POST /maternity/immunizations/{id}/give`**.
- **Deliverable**: due/given schedule view on the child's folder, record-given action.
- **Note**: the schedule is **generated by the API** — you do not create an immunization, you mark a scheduled one as given. `dueOnly=true` is the defaulter/due list for outreach.

---

## Phase 12 — Appointments & referrals (L1)

### T12.1 — Appointments
- **Defines**: `Appointment` → `ObjectId`; `CalendarSummary`, `NoShowRate` (L0); `CalendarDay` → `Appointment`; `Calendar` → `CalendarDay`.
- **Blocked by**: T2.1
- **Endpoints**: `POST /appointments`, `GET /appointments`, **`GET /appointments/calendar?from&to&clinicianId&type&status&includeCancelled`**, **`GET /appointments/calendar/summary`**, **`PATCH /appointments/{id}`**, **`GET /appointments/no-show-rate`**.
- **Deliverable**: booking dialog (reachable from the consultation follow-up date), **day/week calendar** built on `Calendar` — `clinicians[]` are the columns of a resource view and `days[]` includes empty days, so the grid needs no client-side gap filling. `CalendarDay.byStatus` drives the per-day status chips; `calendar/summary` (with `busiestDate`) drives the month mini-map. No-show rate on the practice dashboard.

### T12.2 — Referrals (now write-capable)
- **Defines**: `Referral` → `ObjectId`.
- **Blocked by**: T2.1
- **Endpoints**: **`POST /appointments/referrals`**, **`GET /appointments/referrals/list`**, **`POST /appointments/referrals/{id}/feedback`**.
- **Deliverable**: outward referral form (otherFacility, speciality, reason, urgency, clinicalSummary), referral list on the folder, and a **feedback-outstanding** worklist driven by `awaitingFeedback`.
- **Note**: this answers an old open question — referrals are **not** read-only. `direction` is `out|in`, so inbound referrals from other facilities are recorded too, and the loop only closes when feedback is recorded.

---

## Phase 13 — Reports & analytics (L1)

Reports and analytics are now **separate tags** — the takings and revenue reports moved out of analytics.

### T13.1 — DHIMS2 return
- **Defines**: `Dhims2AgeRow` (L0), `Dhims2Return` → `Dhims2AgeRow`.
- **Blocked by**: T5.2, T11.x
- **Endpoints**: **`GET /reports/dhims2/{period}`**, **`GET /reports/dhims2/{period}/flat`**.
- **Deliverable**: monthly return grouped by attendance / morbidity / maternal / child health / inpatient / notifiable, printable and exportable.
- **Note**: `/flat` returns the same return as **form rows** — that is the export/print shape, matching the paper form the clinic actually submits. Use it for the print stylesheet and CSV rather than re-flattening the nested one.

### T13.2 — Operational reports (new)
- **Defines**: `DailyTakings`, `ServiceLineRevenue`.
- **Blocked by**: T9.1
- **Endpoints**: **`GET /reports/daily-takings`**, **`GET /reports/revenue-by-service`**.
- **Deliverable**: takings by payment method (reconciles against the Z-report) and revenue by service line. Both are cashier/admin-gated.

### T13.3 — Metrics & dashboard
- **Defines**: `MetricSummary`, `MetricResult`, `Dashboard`, `StationCount`.
- **Blocked by**: T9.1, T8.1
- **Endpoints**: `GET /analytics/metrics`, **`POST /analytics/metrics/{name}/run`** (body is the metric's free-form params), `GET /analytics/dashboard`.
- **Deliverable**: executive dashboard (today/month, topDiagnosis, bedOccupancyPercent, lowStockCount, outstanding, nhisShortfall) + a generic metric renderer driven by `MetricResult.columns[].type` (string, number, money, date, percent) — one cell renderer per column type, not one component per metric. `MetricResult.headline` is a computed one-line answer; render it above the table.
- **Note**: there is no `POST /analytics/query`. Metrics are **named and enumerated** by `GET /analytics/metrics` and run by name — build the picker from the catalogue rather than composing queries client-side.

### T13.4 — Natural-language assistant
- **Defines**: `AskResult` → `MetricResult`; `AssistantStatus`.
- **Blocked by**: T13.3, T0.5
- **Endpoints**: **`POST /analytics/ask`** (body `{question, stream, streamId}`), **`GET /analytics/assistant/status`**.
- **Realtime**: with `stream: true`, join the **`ai:<streamId>`** socket room to receive the answer token by token.
- **Deliverable**: ask box rendering narrative + resulting chart + suggested follow-ups, streaming when the socket is up and falling back to a single response when it is not. Gate on `AssistantStatus` and on `GET /health`'s `checks.ai`.
- **Note**: the assistant **only ever runs one of the catalogued metrics** and writes prose around the real result — it never produces a figure of its own, and says so when no metric fits. The UI should make that guarantee visible (show which metric ran), because it is the reason the answer can be trusted.

---

## Phase 14 — Administration (L1 → L2)

### T14.1 — Staff admin ✅
- **Defines**: `CreateStaff`, `UpdateStaff`.
- **Endpoints**: `GET /staff`, `POST /staff`, **`GET /staff/{id}`**, **`PATCH /staff/{id}`**, **`DELETE /staff/{id}`** (deactivate).
- **Note**: all five are admin-only.

### T14.2 — Facility settings
- **Defines**: `FacilitySettings` (L0), `Facility` → `ObjectId, FacilitySettings`, `UpdateFacility`.
- **Blocked by**: T0.1
- **Endpoints**: `GET /facility`, **`PATCH /facility`**.
- **Deliverable**: clinic profile + settings. **`FacilitySettings` feature flags (`hasWard`, `hasMaternity`, `hasLab`, `hasPharmacy`) must gate navigation** — load the facility in the root loader so Phases 6, 7, 11 and 15 can hide themselves.
- **Note**: this is a late *screen* but an early *dependency*, and it is **not yet done** — nothing fetches `GET /facility`. T1.3 is blocked on it. Insurance schemes moved out of this task to [T8.2](#t82--insurance-schemes-moved-here-from-t142).

### T14.3 — Platform / health
- **Defines**: `Health`, `ResetResult`.
- **Endpoints**: `GET /health`, **`POST /health/reset`**.
- **Deliverable**: health indicator surfacing `checks.database`, **`checks.databaseWritable`**, **`checks.realtime`** and **`checks.ai`**; demo-reset button behind an explicit confirm.
- **Note**: `databaseWritable: false` means the node is reachable but not primary — nothing will read or write. That is a distinct, louder banner than "degraded", and it is the one that explains why saves fail.

---

## Phase 15 — Wards & inpatient care (L1) — new

Not in the original plan: the `Wards` tag had no paths when this file was written and question 3 below asked whether admission was in scope. **It is** — eleven endpoints and five schemas. In dependency terms this sits right after Phase 8 (bed-day charges are `Charge`s with `sourceType: bed_day`) and can start as soon as Phases 3 and 8 land; it is numbered 15 only to keep existing task IDs stable.

Gate the whole module on `FacilitySettings.hasWard` (T14.2).

### T15.1 — Ward & bed models
- **Defines**: `Ward` → `ObjectId`; `Bed` → `ObjectId`; `Admission` → `ObjectId`.
- **Blocked by**: T3.1, T14.2
- **Deliverable**: `app/models/ward.ts`.
- **Note**: `Ward` carries live `totalBeds`/`occupiedBeds`/`freeBeds`/`occupancyPercent`; `Bed` carries `status` (free, occupied, cleaning, blocked) plus the occupying `admissionId`/`patientName`. This is the source of `Dashboard.bedOccupancyPercent`.

### T15.2 — Bed board & admission
- **Blocked by**: T15.1
- **Endpoints**: `GET /wards`, **`GET /wards/beds`**, `POST /wards/admissions` (visitId, bedId, admittingDiagnosis, admittingIcd10), `GET /wards/admissions`, `POST /wards/admissions/{id}/discharge` (outcome, dischargeSummary, dischargeInstructions), `POST /wards/beds/{id}/status`.
- **Deliverable**: bed board grouped by ward with the four bed states, admit-from-visit flow (reachable from the close-visit dialog's `admitted` disposition), admission list, discharge form with `outcome` (discharged, referred, absconded, died, dama) and printable discharge instructions, and a bed-status action for cleaning/blocking.
- **Note**: an admission is created **from an open visit** — `visitId` is required. Admission and visit are not interchangeable: the visit stays open for the stay, and the ward screens hang off `admissionId`.

### T15.3 — Ward round notes & drug chart
- **Defines**: `WardNote` → `ObjectId`; `MedicationAdministration` → `ObjectId`.
- **Blocked by**: T15.2
- **Endpoints**: `POST /wards/admissions/{id}/notes`, `GET /wards/admissions/{id}/notes`, `POST /wards/admissions/{id}/medication` (drugName, dose, route, scheduledAt, status, reason), `GET /wards/admissions/{id}/medication`.
- **Deliverable**: chronological note timeline typed ward_round / nursing / progress / handover, and a drug chart where each scheduled dose is marked given / missed / refused / held with a reason. The handover note type is what the shift-change screen filters on.
- **Note**: the drug chart takes a **free-text `drugName`**, not a `productId` — it is not wired to pharmacy stock. Do not try to join it to `Product`; if that link is wanted, it is a backend question.

### T15.4 — Bed-day charging
- **Blocked by**: T15.2, T8.1
- **Endpoints**: `POST /wards/admissions/{id}/accrue-bed-days`.
- **Deliverable**: an accrue action on the admission (and on the discharge flow) that raises outstanding bed-day charges onto the visit bill.
- **Note**: **idempotent** — running it twice in a day adds nothing, because `bedDaysCharged` is stored on the admission. Safe to offer as a visible button and safe to call before discharge. `lengthOfStayDays` vs `bedDaysCharged` is the uncharged gap; show it.

---

## 4. Role gates (from the spec)

Every endpoint description carries `**Requires role:** …` (admin is always additionally allowed). Encode this once, in T1.3, as a `MODULE_ROLES` map — both the nav filter and the route guards read from it.

| Module | Write roles | Read |
|---|---|---|
| Patients | `records, nurse` (register/update/check-duplicates); `records` (merge) | any signed-in |
| Visits | `records, nurse` (check-in); `records` (cancel) | any signed-in; move/close open to all |
| Queues | any signed-in (view **and** act — the corridor is shared) | any signed-in |
| Vitals | `nurse, midwife, doctor, physician_assistant` | any signed-in |
| Consultations | `doctor, physician_assistant, midwife` (write, amend) | any signed-in |
| Lab | `doctor, physician_assistant, midwife` (order); `lab, nurse, midwife` (collect); `lab` (results, verify, reject, worklist) | any signed-in |
| Pharmacy | `doctor, physician_assistant, midwife` (prescribe); `pharmacy` (dispense, substitute, out-of-stock, queue) | any signed-in |
| Inventory | `store, pharmacy` (receive, adjust); `store` (suppliers) | any signed-in |
| Billing | `admin` (charge items, tariffs); `cashier, doctor, physician_assistant, nurse, pharmacy, lab` (add charge); `admin, cashier` (waive, cancel); `admin, claims` (schemes) | any signed-in |
| Payments | `cashier` (take, reverse, till open/close); `admin, cashier` (till summary, sessions) | any signed-in |
| Claims | `claims` — **all ten endpoints, including reads** | `claims` only |
| Wards | `doctor, physician_assistant, midwife` (admit); `doctor, physician_assistant, midwife, nurse` (discharge, notes); `nurse, midwife` (bed status, medication); `admin, cashier, nurse` (accrue bed-days) | any signed-in |
| Maternity | `midwife, nurse, doctor, physician_assistant` (ANC); `midwife, doctor` (delivery); `midwife, nurse, doctor` (postnatal); `nurse, midwife` (immunization) | any signed-in |
| Appointments | any signed-in; `doctor, physician_assistant, midwife` (create referral) | any signed-in |
| Reports | `admin, claims, records` (DHIMS2); `admin, cashier` (takings); `admin, cashier, claims` (revenue) | as write |
| Analytics | any signed-in; `doctor, physician_assistant, midwife` (note search); `admin` (note index) | any signed-in |
| Staff | `admin` — all five | `admin` only |
| Facility | `admin` (update) | any signed-in |

---

## 5. Spec changelog (2026-08-12)

What moved since this plan was first written. Anything already built against these paths (`lib/api/*`) is current; the plan is what had drifted.

**New surface — new work**

- **Wards** (11 endpoints, 5 schemas) — admissions, bed board, ward notes, drug chart, bed-day accrual → new [Phase 15](#phase-15--wards--inpatient-care-l1--new). Answers old question 3.
- **Global search** (`GET /search`, `/search/entities`) — grouped, href-carrying suggestions for the topbar box → new [T1.4](#t14--global-search-new).
- **Socket.io realtime** — `queue:subscribe`/`queue:updated`/`queue:counters`, `lab:ordered`/`lab:updated`, `payment:received`, `ai:<streamId>`, critical-vitals push → new [T0.5](#t05--socketio-client-new). Answers old question 1: **polling is the fallback, not the model.**
- **Appointment calendar** (`/appointments/calendar`, `/calendar/summary`, `/no-show-rate`) and **write-capable referrals** with a feedback loop → [T12.1](#t121--appointments), [T12.2](#t122--referrals-now-write-capable). Answers old question 4.
- **`POST /vitals/preview`** — server-side BMI and flagging without saving.
- **ICD-10 endpoints** (`/consultations/icd10`, `/icd10/all`).
- **Operational reports** (`/reports/daily-takings`, `/reports/revenue-by-service`) split out of analytics → [T13.2](#t132--operational-reports-new).
- **New actions on existing resources**: `POST /visits/{id}/cancel`, `POST /queues/entries/{id}/requeue`, `POST /billing/charges/{id}/cancel`, `POST /payments/{id}/reverse`, `DELETE /staff/{id}` (deactivate), `POST /auth/logout`.
- **New read surface**: `GET /visits`, `GET /visits/open`, `GET /queues` (all-station counters), `GET /lab/worklist`, `GET /pharmacy/queue`, `GET /billing/invoices/{id}`, `GET /payments/till/current`, `GET /claims/summary/{period}`, `GET /patients/by-folder/{folderNumber}`, `GET /staff/{id}`, `GET /lab/tests/{id}`, `GET /inventory/products/{id}`, `GET /inventory/suppliers`.

**Reshaped — plan was wrong**

| Was | Now |
|---|---|
| `POST /patients/search` | `POST /patients/check-duplicates` |
| `PUT` on patients / staff / facility / charge-items / schemes / appointments | `PATCH` |
| `POST /visits/{id}/move-station` | `POST /visits/{id}/move` |
| `POST /queues/{station}/enqueue`, `POST /queues/{id}/…` | `POST /queues`, `POST /queues/entries/{id}/…`, plus `POST /queues/{station}/call-next` |
| `POST /visits/{id}/vitals` | `POST /vitals` (visitId in body) |
| `PUT /consultations/{id}` | `POST /consultations/{id}/amend` |
| `POST /lab/orders/{id}/results` \| `/verify` | **per item**: `/lab/orders/{orderId}/items/{itemId}/results` \| `/verify` \| `/reject` |
| `POST /prescriptions/{id}/dispense` \| `/substitute` | **per item** under `/pharmacy/prescriptions/{id}/items/{itemId}/…`, plus `/out-of-stock` |
| `GET /charge-items`, `/tariffs`, `/visits/{id}/bill`, `POST /charges/{id}/quote` | all under `/billing/*`; quote is **`GET /billing/quote?visitId&chargeItemId&quantity`** |
| `GET /insurance-schemes` | `GET /schemes` (Billing tag) |
| `POST /till-sessions`, `/till-sessions/{id}/close` | `/payments/till/open`, `/payments/till/{id}/close`, `+/current`, `+/{id}/summary`, `+/sessions` |
| `POST /claims/{id}/vet` | **gone** — `POST /claims/{id}/revalidate` + `POST /claims/{id}/reject`; batches gain `/submit` and `/payment` |
| `POST /anc`, `/deliveries`, `/postnatal`, `/immunizations` | all under `/maternity/*`; immunization is `GET /maternity/immunizations` + `POST /{id}/give` |
| `GET /reports/dhims2` | `GET /reports/dhims2/{period}` (+ `/flat`) |
| `POST /analytics/query` | `POST /analytics/metrics/{name}/run` |
| `POST /consultations/search` | `POST /analytics/notes/search` (+ `/notes/index`) |
| `POST /platform/reset` | `POST /health/reset` |

**Envelope note**: the error envelope in the spec description is `{ error: { code, message, details } }` — `data` and `requestId` are no longer documented on it. Confirm before relying on `requestId` in support copy (see question 3 below).

---

## 6. Cross-cutting (run alongside, not after)

- [x] **Codegen decision** — **hand-write** `app/models/*`, per phase, from the spec. Generators emit bare string unions and cannot produce the const-object + label shape T0.1 calls for, and the spec inlines duplicate `$defs` under nearly every path (`PatientSummary` appears ~14 times), which generators expand into a schema per endpoint. Drift is contained by writing each model only when its phase needs it, straight from `openapi.json`. **This sync is the proof it works** — the models were fine, only the plan's endpoint list was stale.
- [ ] **Pagination** — one `PageMeta`-driven list component reused by every index route. The filter contract is uniform (`page`, `limit`, `sort` with `-` prefix, `q`), so build it once against `GET /patients` and parameterise.
- [ ] **Realtime vs revalidate** — one policy, applied everywhere: subscribe where an event exists, `revalidate` on an interval where it does not, and always render correctly from loader data alone. Never let a screen depend on a socket frame having arrived.
- [ ] **Error surface** — map `ErrorResponse.code` to user-facing copy in one place.
- [ ] **Offline/latency** — clinic network is likely poor; decide optimistic-UI policy for queue actions and vitals entry. `GET /consultations/icd10/all` is small enough to cache for offline diagnosis picking.
- [ ] **Print** — receipts, Z-report, DHIMS2 return (`/flat`), discharge instructions and claim batches all need a print stylesheet.
- [ ] **Accessibility & touch targets** — these are triage-desk and ward screens; assume gloves and shared tablets.

---

## 7. Open questions for the backend

**Answered by this sync** — ~~1. polling vs realtime~~ (Socket.io, see T0.5) · ~~3. wards in scope~~ (yes, Phase 15) · ~~4. referrals read-only~~ (write-capable, T12.2).

1. **Socket contract** — the events are named in endpoint descriptions but not specified anywhere. Needed: the connection URL and namespace, how the socket authenticates (token in `auth` handshake?), the exact payload of `queue:updated`, `queue:counters`, `lab:ordered`, `lab:updated`, `payment:received`, and whether a critical-vitals event has a name we can subscribe to.
2. `POST /patients/merge` — is it reversible? The UI copy depends on the answer.
3. ~~**`requestId` on errors**~~ — **answered 2026-08-12**: the deployed backend still returns `error.requestId` (verified on `401`s from `/lab/*`) even though the spec's envelope no longer documents it. Support copy can keep promising it; `ApiError` already reads it.
4. `POST /maternity/postnatal/{id}` — is `{id}` the delivery, the patient, or a pre-created postnatal record? The write is `{id}`-scoped but `GET /maternity/postnatal` is a plain list.
5. **Ward drug chart vs pharmacy** — `MedicationAdministration.drugName` is free text with no `productId`. Is an inpatient dose meant to decrement stock, and if so through which endpoint?
6. Rate limits / token TTL on `expiresIn` — needed to tune the silent-refresh window.
7. `Charge.sourceType: bed_day` is raised by `accrue-bed-days`. Which tariff/charge item does it price against, so the bill can name it?
