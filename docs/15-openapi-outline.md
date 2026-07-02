# 15 — OpenAPI Outline

A skeleton to seed `openapi.yaml`. It lists paths, security, and the core component schemas. Full request/response detail is in [05 — API Endpoints](./05-api-endpoints.md); generate the complete spec from Zod schemas (`zod-to-openapi`) to keep it in sync (NFR-M5). Serve Swagger UI / Redoc at `/docs` (non-prod or auth-gated).

```yaml
openapi: 3.1.0
info:
  title: TejoTime API
  version: 1.0.0
  description: Multi-tenant queue, booking & CRM platform for small businesses.
servers:
  - url: https://api.tejotime.com/api/v1
  - url: https://staging-api.tejotime.com/api/v1

security:
  - bearerAuth: []          # default: owner endpoints

tags:
  - name: Auth
  - name: Business
  - name: Services
  - name: Staff
  - name: Queue
  - name: Appointments
  - name: Customers
  - name: Dashboard
  - name: Notifications
  - name: Subscription
  - name: Public
  - name: Uploads
  - name: Webhooks

paths:
  # ---- Auth ----
  /auth/login:            { post: { tags: [Auth], security: [], operationId: login } }
  /auth/refresh:          { post: { tags: [Auth], security: [] } }
  /auth/logout:           { post: { tags: [Auth] } }
  /auth/me:               { get:  { tags: [Auth] } }
  /auth/otp/request:      { post: { tags: [Auth], security: [] } }
  /auth/otp/verify:       { post: { tags: [Auth], security: [] } }

  # ---- Business & config ----
  /business:              { get: { tags: [Business] }, patch: { tags: [Business] } }
  /business/hours:        { get: { tags: [Business] }, put: { tags: [Business] } }
  /business/qr:           { get: { tags: [Business] } }
  /business/amenities:    { get: { tags: [Business] }, post: { tags: [Business] } }
  /business/gallery:      { get: { tags: [Business] }, post: { tags: [Business] } }
  /services:              { get: { tags: [Services] }, post: { tags: [Services] } }
  /services/{id}:         { patch: { tags: [Services] }, delete: { tags: [Services] } }
  /staff:                 { get: { tags: [Staff] }, post: { tags: [Staff] } }
  /staff/{id}:            { patch: { tags: [Staff] }, delete: { tags: [Staff] } }

  # ---- Queue (core) ----
  /queue:                 { get: { tags: [Queue] }, post: { tags: [Queue], operationId: addWalkIn } }
  /queue/{id}:            { get: { tags: [Queue] }, delete: { tags: [Queue] } }
  /queue/{id}/start:      { post: { tags: [Queue] } }
  /queue/{id}/checkout:   { post: { tags: [Queue] } }
  /queue/{id}/no-show:    { post: { tags: [Queue] } }
  /queue/{id}/reassign:   { post: { tags: [Queue] } }
  /queue/{id}/extend:     { post: { tags: [Queue] } }
  /queue/{id}/move:       { post: { tags: [Queue] } }

  # ---- Appointments ----
  /appointments:              { get: { tags: [Appointments] }, post: { tags: [Appointments] } }
  /appointments/{id}:         { get: { tags: [Appointments] }, patch: { tags: [Appointments] } }
  /appointments/{id}/check-in:{ post: { tags: [Appointments], operationId: checkInAppointment } }
  /appointments/{id}/cancel:  { post: { tags: [Appointments] } }
  /appointments/{id}/no-show: { post: { tags: [Appointments] } }

  # ---- Customers ----
  /customers:             { get: { tags: [Customers] }, post: { tags: [Customers] } }
  /customers/{id}:        { get: { tags: [Customers] }, patch: { tags: [Customers] } }
  /customers/{id}/visits: { get: { tags: [Customers] } }

  # ---- Dashboard / notifications / billing ----
  /dashboard/summary:     { get: { tags: [Dashboard] } }
  /notifications:         { get: { tags: [Notifications] } }
  /notifications/read:    { post: { tags: [Notifications] } }
  /subscription:          { get: { tags: [Subscription] } }
  /subscription/upgrade:  { post: { tags: [Subscription] } }
  /subscription/checkout: { post: { tags: [Subscription] } }
  /subscription/cancel:   { post: { tags: [Subscription] } }

  # ---- Uploads ----
  /uploads/sign:          { post: { tags: [Uploads] } }

  # ---- Public (customer) ----
  /public/businesses/{slug}:              { get: { tags: [Public], security: [] } }
  /public/businesses/{slug}/availability: { get: { tags: [Public], security: [] } }
  /public/businesses/{slug}/staff:        { get: { tags: [Public], security: [] } }
  /public/businesses/{slug}/slots:        { get: { tags: [Public], security: [] } }
  /public/businesses/{slug}/otp/request:  { post: { tags: [Public], security: [] } }
  /public/businesses/{slug}/otp/verify:   { post: { tags: [Public], security: [] } }
  /public/businesses/{slug}/queue:        { post: { tags: [Public], security: [], operationId: joinQueue } }
  /public/businesses/{slug}/appointments: { post: { tags: [Public], security: [], operationId: bookSlot } }
  /public/tickets/{ticketId}:             { get: { tags: [Public], security: [] }, delete: { tags: [Public], security: [] } }

  # ---- Webhooks ----
  /webhooks/payments:     { post: { tags: [Webhooks], security: [] } }
  /webhooks/sms:          { post: { tags: [Webhooks], security: [] } }

components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
    customerToken: { type: http, scheme: bearer }   # OTP-issued customer token
  schemas:
    Money:
      type: object
      required: [amount, currency]
      properties:
        amount: { type: integer, description: minor units (paise) }
        currency: { type: string, example: INR }
    Error:
      type: object
      properties:
        error:
          type: object
          properties:
            code: { type: string }
            message: { type: string }
            requestId: { type: string }
            details:
              type: array
              items:
                type: object
                properties: { field: {type: string}, rule: {type: string}, message: {type: string} }
    Service:
      type: object
      properties:
        id: { type: string }
        name: { type: string }
        durationMinutes: { type: integer }
        price: { $ref: '#/components/schemas/Money' }
        colorToken: { type: string, enum: [primary, secondary, amber500, green500] }
        isActive: { type: boolean }
        position: { type: integer }
    Staff:
      type: object
      properties:
        id: { type: string }
        name: { type: string }
        roleLabel: { type: string }
        colorToken: { type: string, enum: [primary, secondary, amber500, green500] }
        acceptsWalkIns: { type: boolean }
        isActive: { type: boolean }
    QueueCard:
      type: object
      properties:
        id: { type: string }
        name: { type: string }
        service: { type: string }
        status: { type: string, enum: [waiting, in_service, completed, no_show, cancelled] }
        source: { type: string, enum: [walk_in, online] }
        position: { type: integer }
        etaMinutes: { type: integer }
        rightText: { type: string }
        initials: { type: string }
    SeatGroup:
      type: object
      properties:
        id: { type: string }
        name: { type: string }
        colorToken: { type: string }
        serving: { type: boolean }
        servingName: { type: string }
        subLine: { type: string }
        waitBadge: { type: string }
        waitingCount: { type: integer }
        clearMinutes: { type: integer }
        empty: { type: boolean }
        cards: { type: array, items: { $ref: '#/components/schemas/QueueCard' } }
    Appointment:
      type: object
      properties:
        id: { type: string }
        customerName: { type: string }
        customerPhone: { type: string }
        serviceId: { type: string }
        serviceName: { type: string }
        staffId: { type: string, nullable: true }
        scheduledStartAt: { type: string, format: date-time }
        scheduledEndAt: { type: string, format: date-time }
        status: { type: string, enum: [pending, confirmed, checked_in, completed, cancelled, no_show] }
        source: { type: string, enum: [online, owner] }
    Customer:
      type: object
      properties:
        id: { type: string }
        name: { type: string }
        phone: { type: string }
        isVip: { type: boolean }
        visitsCount: { type: integer }
        lastVisitAt: { type: string, format: date-time, nullable: true }
        lastVisitLabel: { type: string }
        totalSpend: { $ref: '#/components/schemas/Money' }
    Ticket:
      type: object
      properties:
        ticketId: { type: string }
        token: { type: string, example: A-24 }
        ahead: { type: integer }
        waitMinutes: { type: integer }
        status: { type: string }
        isYourTurn: { type: boolean }
        progressPct: { type: integer }
    PublicBusiness:
      type: object
      description: Full microsite payload (see 05 §K)
      properties:
        id: { type: string }
        slug: { type: string }
        name: { type: string }
        rating: { type: number }
        reviewCount: { type: integer }
        services: { type: array, items: { $ref: '#/components/schemas/Service' } }
        staff: { type: array, items: { $ref: '#/components/schemas/Staff' } }
        live:
          type: object
          properties: { waitMinutes: {type: integer}, queueCount: {type: integer} }
```

## Conventions to encode in the full spec

- Every operation: `operationId`, `summary`, request body schema, `200/201` + at least `400/401/403/404/409/429` responses referencing `#/components/schemas/Error`.
- Reusable parameters: `limit`, `cursor`, `search`, `date`, `Idempotency-Key` header, `X-Request-Id` header.
- Money always `#/components/schemas/Money`; timestamps `format: date-time`.
- Public operations set `security: []` (or `customerToken` where an OTP token is required).
