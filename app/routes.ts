import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  // Everything inside the app shell requires a signed-in staff member.
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("staff", "routes/staff.tsx"),
    // Patients: the directory, then a page each for registering, reading,
    // editing and merging a folder. Static segments outrank `:patientId`, so
    // `/patients/new` never resolves to a folder id.
    route("patients", "routes/patients.tsx"),
    route("patients/new", "routes/patient-new.tsx"),
    route("patients/:patientId", "routes/patient-detail.tsx"),
    route("patients/:patientId/edit", "routes/patient-edit.tsx"),
    route("patients/:patientId/merge", "routes/patient-merge.tsx"),
    // Visits: the clinic day, check-in, and one visit's lifecycle. Same
    // static-before-`:visitId` ordering as patients, for the same reason.
    route("visits", "routes/visits.tsx"),
    route("visits/new", "routes/visit-new.tsx"),
    route("visits/:visitId", "routes/visit-detail.tsx"),
    // Clinical capture, worked in for the length of a patient rather than
    // embedded in the visit page.
    route("visits/:visitId/vitals", "routes/visit-vitals.tsx"),
    route("visits/:visitId/consultation", "routes/visit-consultation.tsx"),
    route("visits/:visitId/lab", "routes/visit-lab.tsx"),
    route("visits/:visitId/prescription", "routes/visit-prescription.tsx"),
    // The laboratory module: the bench worklist, and one order's lifecycle —
    // collection, per-item results, verification, rejection.
    route("laboratory", "routes/laboratory.tsx"),
    route("laboratory/orders/:orderId", "routes/lab-order.tsx"),
    // The pharmacy: the dispensing counter, and one script's lifecycle —
    // per-item dispense, substitute, out-of-stock.
    route("pharmacy", "routes/pharmacy.tsx"),
    route("pharmacy/prescriptions/:prescriptionId", "routes/prescription.tsx"),
    // The store. `receive`, `suppliers` and `movements` are static segments and
    // so outrank nothing here — products live one level deeper — but keeping
    // them adjacent says which of them is a page and which is a record.
    route("inventory", "routes/inventory.tsx"),
    route("inventory/receive", "routes/inventory-receive.tsx"),
    route("inventory/suppliers", "routes/inventory-suppliers.tsx"),
    route("inventory/movements", "routes/inventory-movements.tsx"),
    route("inventory/products/:productId", "routes/product-detail.tsx"),
    // Analytics: the dashboard and the metric catalogue, then the assistant
    // that runs one of those same metrics from a plain-English question. The
    // assistant is a page rather than a widget because an answer is a document
    // — headline, prose, the table it was written from — not a toast.
    route("analytics", "routes/analytics.tsx"),
    route("analytics/assistant", "routes/analytics-assistant.tsx"),
    // Queues: OPD is the `consulting` station's worklist; every other station
    // is the same screen under `/queues/:station`. `queues/actions` is the
    // write-only resource route the worklist posts to, and must outrank
    // `:station` — static segments win, but keeping them adjacent says why.
    route("opd", "routes/opd.tsx"),
    route("queues/actions", "routes/queue-actions.tsx"),
    route("queues/:station", "routes/station-queue.tsx"),
    // Read-only resource routes backing the live lookups the clinical screens
    // make. They render nothing; they exist so the access token can stay in its
    // httpOnly cookie. All three are `GET` — even the two whose API call is a
    // `POST` — so a `fetcher.load()` answers a keystroke without revalidating
    // the screen that asked.
    route("resources/icd10", "routes/resource-icd10.tsx"),
    route("resources/vitals-preview", "routes/resource-vitals-preview.tsx"),
    route("resources/note-search", "routes/resource-note-search.tsx"),
    route("resources/lab-tests", "routes/resource-lab-tests.tsx"),
    route("resources/products", "routes/resource-products.tsx"),
    // The exception to the rule above: the socket connects browser-to-backend
    // across origins, so this one hands the access token out rather than
    // spending it server-side. See the route for what that costs.
    route("resources/realtime-token", "routes/resource-realtime-token.tsx"),
    // Unbuilt sidebar modules land on a placeholder until their route exists.
    route("*", "routes/coming-soon.tsx"),
  ]),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  // The shadcn kit that shipped with the template, kept as a component reference.
  route("ui-kit", "routes/ui-kit.tsx"),
] satisfies RouteConfig;
