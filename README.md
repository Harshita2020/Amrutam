# Amrutam Telemedicine Backend

Backend assignment implementation using Node.js, Express and PostgreSQL. Includes authentication/MFA, doctor discovery and availability, transactional booking/cancellation, consultation lifecycle, immutable prescriptions, admin analytics, audit trails and an asynchronous analytics worker.

Start with [the backend setup guide](amrutam-backend/README.md).

- [Submission checklist and verified limits](SUBMISSION.md)
- [Four-page architecture](ARCHITECTURE_SUBMISSION.pdf)
- [Editable architecture overview](ARCHITECTURE_BRIEF.md)
- [API schema](amrutam-backend/openapi.json) and [API contract](API_CONTRACT.md)
- [Security and threat model](SECURITY.md)
- [Operations, deployment and recovery](OPERATIONS.md)
- [Five-minute demo sequence](DEMO.md)
- [Development evidence](Amrutam_Backend_Development_Change_Log.md)

From `amrutam-backend`:

```sh
npm ci
npm test
npm run test:integration
npm run validate:openapi
npm audit --audit-level=moderate
```

Integration tests require a local PostgreSQL role with permission to create disposable databases. See the backend README. Production availability, scale and compliance targets are not claimed as achieved.
