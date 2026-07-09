# Team & roles

## Role overview

Ascend uses role-based access control (RBAC). Every user has one system role:

| Role | Access level |
|---|---|
| **Owner** | Everything — manage users, billing, API keys, SSO, delete data |
| **Manager** | Manage catalog, inventory, process refunds/voids, run all reports, change settings |
| **Cashier** | Ring up sales, view products, accept payments, view own shift reports |

A user can only have one system role. Custom roles (enterprise) can add granular permission overrides.

## Inviting staff

1. **Settings → Team → Invite**
2. Enter name, email, and role
3. The staff member receives an email with a sign-in link
4. They set their own password on first login

## Changing a role

**Settings → Team → [user] → Change role** (owner only). Role changes take effect immediately on next login.

## Removing a user

**Settings → Team → [user] → Deactivate** — the user cannot log in but their history is preserved. To permanently delete a user, contact support.

## Custom roles (enterprise)

Custom roles let you define granular permission sets beyond the three system roles.

**Settings → Custom Roles → New role**:
1. Enter a name and description
2. Toggle individual permissions on/off
3. Assign the custom role to a user (owner only): Settings → Team → [user] → Assign custom role

Custom role permissions layer on top of the base system role — they cannot grant more than owner-level access.

## PIN overrides

Cashiers can be granted a manager PIN override for specific actions (discounts above a threshold, post-tender corrections) without being promoted to Manager. Configure in **Settings → Terminal → Cashier overrides**.

## Time tracking

Staff can clock in/out from the **Clock in** button at the top of any page (when the Workforce module is enabled):
- Records `clock_in`, `clock_out`, and break time
- Reports → Team → Time Cards shows hours per employee per period

## API keys

**Settings → API Keys** (owner only):
- Create keys scoped to specific API endpoints
- Keys are shown once on creation — copy and store securely
- Revoke a key at any time; it immediately stops working
