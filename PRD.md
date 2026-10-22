# Product Requirements Document (PRD)
## Amrutam Telemedicine Backend System

**Document version:** 1.0  
**Status:** Draft  
**Product:** Telemedicine Backend API  
**Organization:** Amrutam Pharmaceuticals Pvt. Ltd.  
**Technology direction:** Node.js, Express.js, PostgreSQL, REST API

---

## 1. Product Overview

### 1.1 Purpose

The Amrutam Telemedicine Backend System will provide the server-side infrastructure required to manage users, doctors, appointment bookings, consultations, prescriptions, payments, and administrative operations.

The system will expose secure APIs that allow patients, doctors, and administrators to interact with the telemedicine platform while protecting sensitive healthcare information.

The backend must be designed with scalability, reliability, security, and observability in mind.

### 1.2 Problem Statement

A telemedicine platform needs to coordinate patients, doctors, appointments, and medical records reliably.

Without appropriate backend controls, the platform could experience:

- Duplicate or conflicting appointment bookings.
- Unauthorized access to patient information.
- Inconsistent consultation and prescription records.
- Service interruptions and slow API responses.
- Insufficient audit history for sensitive operations.
- Difficulty diagnosing errors and monitoring system health.

The proposed backend addresses these challenges through secure authentication, controlled access, transactional database operations, input validation, audit logging, and operational monitoring.

### 1.3 Product Goal

Build a functional and well-documented backend that demonstrates the core telemedicine workflows and establishes a credible foundation for a scalable production system.

---

## 2. Objectives and Success Criteria

The original assignment specifies the following system targets:

| Requirement | Target |
|---|---|
| Daily consultation volume | 100,000 consultations |
| Read latency | p95 below 200 ms |
| Write latency | p95 below 500 ms |
| Service availability | 99.95% |
| Authentication security | MFA and secure authentication |
| Authorization | Role-based access control |
| Data protection | Encryption |
| Observability | Metrics, logs, and traces |
| Delivery | Containerized deployment and CI/CD |

These are target requirements. Actual performance and availability must be validated through appropriate testing and operational evidence.

### Project-level acceptance criteria

The assignment submission should demonstrate that:

1. Users can authenticate securely.
2. Patients and doctors can perform only the operations permitted by their roles.
3. Doctors can manage availability and patients can book appointments.
4. Concurrent booking attempts cannot create conflicting bookings.
5. Consultations and prescriptions follow defined lifecycle rules.
6. Sensitive operations generate audit records.
7. API inputs are validated and errors are handled consistently.
8. Automated tests cover critical business workflows.
9. The system has documented setup instructions, architecture, security controls, and deployment procedures.

---

## 3. Users and Roles

### 3.1 Patient

Patients use the system to:

- Register and authenticate.
- Search for doctors and view availability.
- Book and cancel appointments according to booking rules.
- View their own consultation history.
- Access prescriptions associated with their consultations.

### 3.2 Doctor

Doctors use the system to:

- Authenticate securely.
- Manage their professional profile.
- Publish and manage availability slots.
- View their assigned consultations.
- Update consultation statuses.
- Create prescriptions for eligible consultations.

### 3.3 Administrator

Administrators use the system to:

- Access authorized administrative functions.
- Manage or review platform users.
- View operational analytics.
- Investigate audit records.
- Monitor platform activity and service health.

Administrative access must be restricted. Public registration must not allow users to assign themselves the administrator role.

---

## 4. Functional Requirements

### FR-01: User Lifecycle and Authentication

The system shall support user registration, login, identity verification through authenticated requests, and role-based permissions.

Requirements:

- Store password hashes rather than plaintext passwords.
- Issue and verify signed authentication tokens.
- Validate registration and login inputs.
- Prevent unauthorized access to protected endpoints.
- Enforce role-based permissions.
- Support MFA as required by the assignment.
- Apply rate limiting to sensitive authentication endpoints.

**Acceptance criteria:** Invalid credentials are rejected, passwords are never returned in API responses, and protected endpoints reject unauthenticated or unauthorized requests.

### FR-02: Doctor Availability

The system shall allow authorized doctors to create and manage appointment availability slots.

Requirements:

- Associate each availability slot with a doctor.
- Store the start and end times of each slot.
- Validate that the end time follows the start time.
- Prevent overlapping or invalid bookings according to defined rules.
- Make available slots searchable by relevant criteria.

**Acceptance criteria:** Patients can view available slots, and unavailable or invalid slots cannot be booked.

### FR-03: Appointment Booking

The system shall allow patients to book available doctor slots.

Requirements:

- Validate the patient, doctor, and requested slot.
- Prevent two patients from successfully booking the same slot.
- Use PostgreSQL transactions and database constraints to preserve consistency.
- Implement idempotency for booking writes.
- Support appointment cancellation under defined rules.
- Record booking events in the audit history.

**Acceptance criteria:** When two patients attempt to book the same slot concurrently, at most one booking succeeds. Repeating an identical request with the same idempotency key must not create a duplicate booking.

### FR-04: Consultation Lifecycle

The system shall manage consultations associated with booked appointments.

Proposed lifecycle:

Scheduled → In Progress → Completed

A scheduled consultation may also be cancelled where permitted.

Requirements:

- Associate each consultation with the relevant patient and doctor.
- Validate status transitions.
- Restrict status changes to authorized users.
- Preserve consultation history.
- Maintain consistency between booking and consultation records.

**Acceptance criteria:** Invalid status transitions are rejected, and users cannot access consultations outside their authorization scope.

### FR-05: Prescription Management

The system shall allow authorized doctors to create prescriptions associated with consultations.

Requirements:

- Link each prescription to its consultation and doctor.
- Store the required prescription details.
- Restrict access to authorized users.
- Record prescription creation and relevant updates in audit logs.

**Acceptance criteria:** Unauthorized users cannot create prescriptions or retrieve another patient's protected medical information.

### FR-06: Search and Filtering

The system shall support searching and filtering doctors and relevant availability information.

Potential filters include doctor name, specialization, and availability.

**Acceptance criteria:** Valid filters return matching results, invalid parameters are rejected or handled consistently, and pagination is supported for list endpoints.

### FR-07: Payments

The requested data model includes payments.

The initial design shall account for payment records and their relationship to relevant users or consultations.

Real payment processing, gateway integration, refunds, and payment-provider webhooks are not explicitly detailed in the assignment. Their implementation scope must therefore be defined separately rather than assumed.

### FR-08: Audit Trails and Compliance

The system shall maintain audit records for important security and business events.

Examples include:

- Authentication and authorization failures.
- Appointment creation and cancellation.
- Consultation status changes.
- Prescription creation.
- Administrative actions.

Audit records should capture relevant actor, action, timestamp, and resource information.

Passwords, authentication secrets, and unnecessary medical details must not be written to ordinary application logs.

### FR-09: Administrative Analytics

The system shall expose authorized administrative endpoints for operational analytics.

Potential metrics include consultation counts, booking counts, cancellations, and consultation status distribution.

Analytics access must be restricted to authorized administrative users.

---

## 5. Data Requirements

The assignment identifies the following core tables.

| Table | Purpose |
|---|---|
| `users` | Authentication identity and role |
| `profiles` | User profile information |
| `doctors` | Doctor-specific professional information |
| `availability_slots` | Doctor availability |
| `consultations` | Appointment and consultation records |
| `prescriptions` | Prescription information |
| `payments` | Payment records |
| `audit_logs` | Security and business event history |

### Data integrity requirements

- Use primary keys and appropriate foreign keys.
- Enforce uniqueness where duplicate records are invalid.
- Use database transactions for related operations.
- Store timestamps consistently and handle time zones explicitly.
- Add indexes for common search and relationship queries.
- Apply appropriate retention and deletion policies to sensitive data.

The final schema must define the relationships, constraints, required fields, and indexes for each table.

---

## 6. API Requirements

The backend shall expose a REST API. OpenAPI documentation shall describe endpoint behavior, authentication, request validation, response schemas, and error responses.

Proposed endpoint groups:

| Resource | Example operations |
|---|---|
| Authentication | `POST /api/v1/auth/register`, `POST /api/v1/auth/login` |
| User profile | `GET /api/v1/users/me` |
| Doctors | `GET /api/v1/doctors`, `GET /api/v1/doctors/:id` |
| Availability | `GET /api/v1/doctors/:id/slots` |
| Booking | `POST /api/v1/bookings`, `DELETE /api/v1/bookings/:id` |
| Consultations | `GET /api/v1/consultations`, `PATCH /api/v1/consultations/:id/status` |
| Prescriptions | `POST /api/v1/consultations/:id/prescriptions` |
| Administration | `GET /api/v1/admin/analytics` |
| Operations | `GET /api/v1/health`, `GET /api/v1/ready` |

These paths are proposed API conventions, not paths mandated by the original assignment.

All write endpoints must validate input, enforce authorization, and return appropriate HTTP status codes. Critical write operations must support idempotency where applicable.

---

## 7. Non-Functional Requirements

### 7.1 Performance and Scalability

The system shall be designed for the stated target of 100,000 daily consultations.

Design considerations include:

- Appropriate database indexes.
- Efficient queries and pagination.
- Connection pooling.
- Caching where beneficial.
- Asynchronous processing for heavy tasks.
- Data partitioning where justified by volume.
- Concurrency-safe booking operations.

The architecture must explain how these measures support the required throughput and latency targets.

### 7.2 Reliability and Availability

The target availability is 99.95%.

The design shall document:

- Failure handling and retry strategies.
- Bounded retries with exponential backoff where appropriate.
- Health and readiness checks.
- Database backup and restoration procedures.
- Disaster recovery assumptions.
- Transaction boundaries and consistency guarantees.

A production availability target requires suitable deployment infrastructure and monitoring; it cannot be demonstrated by local execution alone.

### 7.3 Security and Privacy

The system shall implement:

- Secure authentication and role-based authorization.
- Password hashing.
- Encryption in transit and appropriate encryption at rest.
- Secure secret management and key rotation procedures.
- Rate limiting and input validation.
- Audit logging.
- Dependency vulnerability scanning.
- Protection against relevant OWASP risks.
- A threat model covering sensitive healthcare data.

### 7.4 Observability

The system shall support:

- Structured application logs.
- Operational metrics.
- Distributed tracing or a documented tracing implementation.
- Health and readiness endpoints.
- Monitoring of latency, error rates, and service availability.

Sensitive data must be excluded or appropriately redacted from telemetry.

### 7.5 Maintainability

The implementation shall use modular services, dependency injection where appropriate, centralized error handling, consistent API conventions, and automated tests.

---

## 8. Architecture and Technical Constraints

The original assignment permits Node.js, Go, or Python and specifies PostgreSQL, with Redis as an optional component.

For this implementation, the selected stack is:

- Node.js
- Express.js
- PostgreSQL
- REST APIs
- Docker
- GitHub Actions or an equivalent CI pipeline
- Automated API and business-logic tests

Redis may be introduced for caching or other justified use cases.

The architecture document shall include:

1. High-level architecture and data flow.
2. Booking flow sequence diagram.
3. Entity-relationship diagram.
4. API schema.
5. Retry and backoff strategies.
6. Data partitioning strategy.
7. Caching and concurrency handling.
8. Transaction management and sagas.
9. Backup and disaster recovery strategy.

The assignment requests modular services with dependency injection. The implementation should explain its service boundaries and avoid introducing unnecessary distributed services before their need is established.

---

## 9. Testing and Acceptance

Automated tests shall cover the most important functional and security requirements.

Minimum priority test scenarios:

- Successful and unsuccessful authentication.
- Role-based authorization.
- Invalid request validation.
- Successful appointment booking.
- Duplicate and concurrent booking attempts.
- Idempotent booking retries.
- Valid and invalid consultation transitions.
- Prescription access restrictions.
- Audit record creation.
- Health and readiness behavior.

The CI pipeline shall install dependencies, run tests, and report failures. Dependency scanning should be included in the delivery pipeline.

Performance testing is required to substantiate the specified latency and capacity targets.

---

## 10. Deliverables

The submission shall include:

1. Git repository containing source code and infrastructure configuration.
2. README with setup and execution instructions.
3. OpenAPI specification or GraphQL schema.
4. Architecture document of 2–4 pages.
5. Automated tests and CI pipeline.
6. Observability setup.
7. Security checklist and threat model.
8. Five-minute demonstration video.

---

## 11. Scope and Prioritization

The full assignment describes a production-oriented backend with a time expectation of four to five days.

For a constrained initial implementation, priorities are:

**Priority 1 — Essential**
- Working application and database setup.
- Authentication and authorization.
- Doctor availability and booking.
- Transactional booking integrity and idempotency.
- Consultation and prescription access controls.
- Input validation and error handling.
- Critical automated tests.

**Priority 2 — Required supporting deliverables**
- OpenAPI documentation.
- Architecture and ER diagrams.
- Security checklist and threat model.
- Structured logs and health checks.
- Docker and CI pipeline.

**Priority 3 — Advanced capabilities**
- Redis caching.
- Background job processing.
- Detailed distributed tracing.
- Load testing and performance optimization.
- Advanced partitioning and production disaster recovery.

This prioritization is an implementation plan, not a reduction of the original requirements. Any incomplete feature must be documented clearly in the submission.

---

## 12. Risks and Assumptions

### Risks

- Concurrent booking requests may cause double booking without database-level protection.
- Incorrect authorization may expose sensitive medical records.
- Unbounded retries may amplify service failures.
- Poor indexing may prevent the system from meeting latency targets.
- Inadequate backup and recovery procedures may lead to data loss.
- Unverified performance claims may overstate system readiness.

### Assumptions requiring clarification

- The exact MFA mechanism and enrollment workflow.
- Whether payments require a real payment gateway.
- Detailed cancellation and rescheduling policies.
- Required healthcare data-retention and compliance rules.
- Production deployment platform and infrastructure budget.
- Expected peak traffic and workload distribution.
- Required backup recovery point and recovery time objectives.

The original assignment does not specify all these details. They should be treated as open decisions rather than established requirements.

---

## 13. Definition of Done

The project is ready for submission when the repository, documentation, and demo collectively demonstrate the implemented workflows and explain the design decisions.

Critical security and idempotency requirements must not be omitted.

Any feature not fully implemented, tested, or deployed must be explicitly identified. Performance, availability, and scalability targets must be supported by evidence or documented as unverified targets.

**End of document.**