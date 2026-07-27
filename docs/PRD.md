# SplitSync Product Requirements Document

## 1. Product Overview

SplitSync is a full-stack expense sharing application that helps groups record shared spending, split costs fairly, track balances, and settle up. It is designed for friends, roommates, trips, teams, and small groups who need a reliable shared ledger that continues to work when the network is unavailable.

The product combines a React progressive web app, local-first IndexedDB storage, queued offline sync, Google authentication, an Express API, and PostgreSQL persistence.

## 2. Problem Statement

Shared expenses often end up scattered across chats, screenshots, notes, and memory. This creates confusion around who paid, who owes, whether a payment has already been settled, and whether everyone has the same view of the group balance.

SplitSync solves this by giving each group one place to:

- Create and manage shared expense groups.
- Invite contributors.
- Add expenses with equal or custom splits.
- See automatic balances.
- Record settlement payments.
- Keep working offline.
- Sync data when connectivity returns.

## 3. Goals

- Make it easy for a user to create a group and start tracking expenses quickly.
- Support common expense splitting workflows: equal split and custom amount split.
- Provide clear group balances so users can understand who owes whom.
- Allow users to record settlement payments and preserve transaction history.
- Provide a reliable offline-first experience for viewing cached data and queueing changes.
- Keep authentication simple and familiar through Google Sign-In.
- Support installable PWA behavior for a lightweight mobile-friendly experience.

## 4. Non-Goals

- SplitSync will not process real money transfers.
- SplitSync will not provide card, bank, UPI, or wallet integrations in the first release.
- SplitSync will not support receipt OCR or receipt image upload in the first release.
- SplitSync will not invite users who have never signed in unless email invitation support is added later.
- SplitSync will not provide advanced accounting, tax, or business reimbursement workflows.

## 5. Target Users

### Primary Users

- Friends sharing costs on trips, meals, events, or recurring activities.
- Roommates splitting rent-adjacent costs, groceries, utilities, and household items.
- Small informal teams that need a transparent shared-expense tracker.

### User Personas

#### Group Organizer

Creates groups, invites people, adds most expenses, and wants a simple view of who owes whom.

#### Contributor

Joins an existing group, adds occasional expenses, checks personal balance, and records payments when settling up.

#### Offline User

Uses the app while traveling or in low-connectivity environments and expects the app to preserve changes until the network returns.

## 6. User Stories

### Authentication

- As a user, I want to sign in with Google so that I can access my groups securely.
- As a user, I want to stay signed in so that I do not need to authenticate every time I open the app.
- As a user, I want to log out and clear local cached data from the device.

### Groups

- As a user, I want to create a group so that I can track shared expenses with others.
- As a group member, I want to view all groups I belong to.
- As a group organizer, I want to invite existing users by email.
- As an invited user, I want to accept a pending invitation.
- As a group member, I want to see active and pending members.

### Expenses

- As a member, I want to add an expense with description, amount, date, and comments.
- As a member, I want to split an expense equally among selected members.
- As a member, I want to split an expense by custom amounts.
- As a member, I want to view expense details.
- As a member, I want to edit an existing expense.
- As a member, I want to delete an expense.

### Balances and Settlements

- As a member, I want to see the current group balance summary.
- As a member, I want to know whether I owe money or should recover money.
- As a member, I want the app to suggest a practical settlement recipient.
- As a member, I want to record a payment between two group members.
- As a member, I want to see expenses and settlement payments in one activity history.

### Offline and Sync

- As a user, I want to view cached user, group, member, expense, and payment data when offline.
- As a user, I want locally created changes to be queued while offline.
- As a user, I want queued changes to sync automatically when I am online again.
- As a user, I want visual feedback when the app is offline or has pending sync items.

## 7. Functional Requirements

### 7.1 Authentication

| ID | Requirement | Priority |
| --- | --- | --- |
| AUTH-001 | The frontend must support Google Sign-In. | Must |
| AUTH-002 | The backend must verify Google ID tokens with the configured Google OAuth client ID. | Must |
| AUTH-003 | The backend must create a user record when a valid Google user signs in for the first time. | Must |
| AUTH-004 | The backend must set an HTTP-only session cookie after successful login. | Must |
| AUTH-005 | The app must expose a logout action that clears the server cookie and local cached data. | Must |

### 7.2 Groups and Membership

| ID | Requirement | Priority |
| --- | --- | --- |
| GRP-001 | Users must be able to create a named group. | Must |
| GRP-002 | Group creators must be added as joined admin members. | Must |
| GRP-003 | Users must be able to view groups where they have membership. | Must |
| GRP-004 | Members must be able to invite existing users by email. | Must |
| GRP-005 | Invited members must be stored with a pending joined state. | Must |
| GRP-006 | Pending members must be able to accept an invite. | Must |
| GRP-007 | Group detail views must include members, expenses, and payments. | Must |

### 7.3 Expenses

| ID | Requirement | Priority |
| --- | --- | --- |
| EXP-001 | Users must be able to create an expense for a group. | Must |
| EXP-002 | Expenses must include amount, description, date, payer, split type, and split records. | Must |
| EXP-003 | Users must be able to add optional comments to an expense. | Should |
| EXP-004 | Users must be able to split expenses equally across selected members. | Must |
| EXP-005 | Users must be able to split expenses by custom amounts. | Must |
| EXP-006 | Custom split totals must match the total expense amount before submission. | Must |
| EXP-007 | Users must be able to view, edit, and delete existing expenses. | Must |
| EXP-008 | Expense access must be restricted to members of the relevant group. | Must |

### 7.4 Balances and Settlements

| ID | Requirement | Priority |
| --- | --- | --- |
| BAL-001 | The group detail screen must calculate balances from expenses, splits, and payments. | Must |
| BAL-002 | The app must show whether the current user owes money or can recover money. | Must |
| BAL-003 | The app should suggest a settlement target based on balances. | Should |
| PAY-001 | Users must be able to record settlement payments between two different group members. | Must |
| PAY-002 | Payment users must belong to the same group. | Must |
| PAY-003 | Settlement records must appear in group history. | Must |

### 7.5 Offline-First Behavior

| ID | Requirement | Priority |
| --- | --- | --- |
| OFF-001 | The frontend must persist users, groups, members, expenses, payments, and sync queue records in IndexedDB. | Must |
| OFF-002 | The app must detect online and offline browser states. | Must |
| OFF-003 | The app must display offline status when connectivity is unavailable. | Must |
| OFF-004 | Local mutations must be added to a sync queue when immediate server sync is not possible. | Must |
| OFF-005 | The app must process queued changes when the device returns online. | Must |
| OFF-006 | The app must display the number of pending sync items. | Should |

### 7.6 Progressive Web App

| ID | Requirement | Priority |
| --- | --- | --- |
| PWA-001 | The frontend must be installable as a PWA where supported. | Should |
| PWA-002 | The app must use standalone display mode. | Should |
| PWA-003 | The service worker should auto-update. | Should |

## 8. Key User Flows

### 8.1 First Login

1. User opens SplitSync.
2. User selects Google Sign-In.
3. Frontend receives a Google ID token.
4. Backend verifies the token.
5. Backend creates or fetches the user.
6. Backend sets an HTTP-only session cookie.
7. Frontend stores user data locally and syncs groups.

### 8.2 Create a Group

1. Signed-in user enters a group name.
2. Frontend creates a local group record.
3. Frontend queues or submits the group creation.
4. Backend creates the group and adds the creator as admin.
5. Frontend syncs latest group data.

### 8.3 Add an Expense

1. User opens a group.
2. User selects add expense.
3. User enters description, amount, date, comments, split type, and selected members.
4. App validates required fields and split totals.
5. Frontend saves the expense locally and queues/submits it.
6. Backend persists the expense and split records.
7. Balances and history update.

### 8.4 Record Settlement

1. User opens a group.
2. App shows balances and suggested settlement information.
3. User opens record payment.
4. User selects payer, recipient, amount, and date.
5. App validates that payer and recipient are different group members.
6. Backend persists the payment.
7. Balances and history update.

### 8.5 Offline Sync

1. User opens the app while offline.
2. App loads cached user and group data from IndexedDB.
3. User makes supported local changes.
4. App stores pending changes in the sync queue.
5. Browser returns online.
6. App processes queued changes.
7. App refreshes data from `/api/sync`.

## 9. Data Model

### Users

- `id`
- `email`
- `name`
- `avatar`

### Groups

- `id`
- `name`
- `createdAt`
- `updatedAt`

### Group Members

- `id`
- `groupId`
- `userId`
- `role`
- `joined`

### Expenses

- `id`
- `groupId`
- `paidById`
- `amount`
- `description`
- `comments`
- `date`
- `splitType`

### Expense Splits

- `id`
- `expenseId`
- `userId`
- `amount`

### Payments

- `id`
- `groupId`
- `fromUserId`
- `toUserId`
- `amount`
- `date`

### Sync Queue

- `id`
- `action`
- `table`
- `data`
- `timestamp`

## 10. API Requirements

### Public and Auth

- `GET /api/health`
- `POST /api/auth/google`
- `GET /api/me`
- `POST /api/auth/logout`

### Groups

- `GET /api/groups`
- `POST /api/groups`
- `GET /api/groups/:id`
- `POST /api/groups/:id/invite`
- `POST /api/groups/:groupId/join`

### Expenses

- `POST /api/expenses`
- `GET /api/expenses/:id`
- `PUT /api/expenses/:id`
- `DELETE /api/expenses/:id`

### Payments and Sync

- `POST /api/payments`
- `GET /api/sync`

## 11. Non-Functional Requirements

### Security

- Sessions must use HTTP-only cookies.
- Backend routes that expose user data must require authentication.
- Expense and payment operations must validate group membership.
- Production deployments should use secure cookies over HTTPS.
- OAuth client IDs and database credentials must be configured through environment variables.

### Reliability

- The app must preserve local data across page reloads.
- Offline changes must not be lost during normal browser usage.
- Sync failures should stop queue processing safely and retry later.

### Performance

- Common group and expense views should load from local IndexedDB quickly.
- Sync responses should include all data needed to refresh local state in one request.
- The PWA should remain responsive on mobile devices.

### Usability

- Users should always understand whether they are online, offline, synced, or waiting to sync.
- Expense forms should prevent invalid custom split totals.
- Settlement forms should prevent selecting the same member as payer and recipient.
- Group member status should clearly distinguish joined and pending users.

### Maintainability

- Frontend and backend should remain independently buildable.
- Environment setup should be documented.
- Database initialization should remain reproducible for local and Docker environments.

## 12. MVP Scope

The MVP includes:

- Google Sign-In.
- Group creation.
- Existing-user invitations.
- Invite acceptance.
- Expense creation, editing, viewing, and deletion.
- Equal and custom amount splits.
- Balance calculation.
- Settlement payment recording.
- Combined activity history.
- IndexedDB local cache.
- Offline sync queue.
- PWA installation support.
- Docker Compose setup for frontend, backend, and PostgreSQL.

## 13. Out of Scope for MVP

- Native mobile apps.
- Real payment processing.
- Receipt uploads.
- Receipt OCR.
- Multi-currency support.
- Email invites for users who have never signed in.
- Advanced conflict resolution for simultaneous offline edits.
- Export to CSV/PDF.
- Admin-only role enforcement beyond basic membership.

## 14. Success Metrics

- A new user can sign in and create a group in under one minute.
- A group member can add an expense with a valid split in under thirty seconds.
- Users can understand their personal balance without reading transaction details manually.
- Offline-created changes sync successfully after the app returns online.
- No unauthorized user can access another group’s expense details through the API.

## 15. Risks and Open Questions

| Area | Risk or Question | Suggested Follow-Up |
| --- | --- | --- |
| Offline sync | Simultaneous edits from multiple users can create conflicts. | Define conflict resolution rules. |
| Invitations | Inviting only existing users limits adoption. | Add email invitation and pending account flow. |
| Authorization | Member roles exist but admin-only permissions are limited. | Define role matrix and enforce server-side. |
| Data integrity | Expense update behavior must ensure old split records are replaced correctly. | Add tests around update flows. |
| Testing | Automated tests are not yet part of the documented workflow. | Add backend route tests and frontend workflow tests. |
| Production readiness | Deployment, HTTPS, and secure cookie defaults need environment-specific guidance. | Create production deployment guide. |

## 16. Future Roadmap

### Near Term

- Add automated tests for API routes and critical frontend flows.
- Improve error handling for failed invites, failed sync, and invalid forms.
- Add email invitations for users who have not signed in.
- Enforce stronger role-based authorization.

### Mid Term

- Add receipt image uploads.
- Add filtering, search, and export options.
- Improve offline conflict handling.
- Add better settlement optimization across all group members.

### Long Term

- Add multi-currency support.
- Add native mobile wrappers or platform-specific apps if demand justifies it.
- Add optional payment provider integrations.
- Add analytics dashboards for recurring household or team expenses.

## 17. Release Criteria

SplitSync is ready for an MVP release when:

- Authentication works reliably in local and deployed environments.
- Group, expense, split, payment, and sync workflows are manually verified.
- API authorization checks prevent cross-group access.
- PWA build completes successfully.
- Docker Compose stack starts successfully.
- Environment variables are documented and validated.
- Known limitations are documented for users or maintainers.

