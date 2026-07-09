# Restaurant & Food Service

## Who this is for

Full-service restaurants, quick-service (QSR), cafes, bars, food trucks, and catering operations.

## Activated modules

| Module | What it does |
|---|---|
| Tables & Floor Plan | Visual table layout; seat and open tabs |
| Kitchen Display (KDS) | Real-time ticket view for kitchen staff |
| Bar Tabs | Open tabs per customer or table; close at end of visit |
| Reservations | Booking management by date/time/party size |
| Menu Modifiers | Add-ons, substitutions, special instructions (no onions, etc.) |
| Course Management | Fire courses at the right time from the POS |

## Floor plan

Location: `/restaurant/floor-plan`

Tables are color-coded:
- **Green** — Available
- **Red** — Occupied
- **Yellow** — Reserved
- **Blue** — Needs cleaning

Tap a table to open it, seat it, or transfer an order to another table.

## Ordering flow

1. Tap a table on the floor plan → **New order**
2. Browse menu categories or search by item name
3. Tap an item to add it; apply **modifiers** (size, extras, removals)
4. Tap **Send to kitchen** — ticket fires to the KDS immediately
5. Add more items as guests order (they fire to the KDS incrementally)

## Kitchen Display System

Location: `/restaurant/kitchen`

- New tickets appear at the left; oldest tickets scroll right
- Tap a ticket line to mark it **in progress** (turns amber)
- Tap again to mark it **ready** (turns green)
- Completed tickets auto-dismiss after 30 seconds
- **Bump** bar: physically connected bump bar supported via keyboard shortcuts

## Bar tabs

Location: `/restaurant/tabs`

- Open a tab for a customer (by name or card pre-auth)
- Add rounds to the tab throughout the visit
- Close the tab: apply payment (card, cash, or split)
- Tips can be added at close

## Modifiers

Set up modifiers in **Settings → Menu → Modifiers**:
- **Modifier group** — a set of options (e.g. "Protein: Chicken, Tofu, Beef")
- **Required vs. optional** — required groups block checkout until selected
- **Min/max selections** — e.g. "Choose 1–3 toppings"
- **Price delta** — modifiers can add or subtract from the item price

Attach a modifier group to a product in Catalog → [product] → Modifiers tab.

## Splitting a bill

On the order screen, tap **Split bill**:
- Split evenly across N guests
- Or assign individual items to each guest

Each split produces a separate payment; each can tender independently.

## Reservations

Location: `/restaurant/reservations`

- View by day (timeline) or list
- Create a reservation: name, party size, date/time, notes
- Status: Pending → Confirmed → Seated → Completed / No-show
- Ascend does not yet integrate with third-party booking platforms (on roadmap)

## Reporting

| Report | What to check |
|---|---|
| Sales by category | Which menu sections drive the most revenue |
| Sales by product | Top dishes and slow movers |
| Hourly sales | Peak hours for staffing |
| Voids & comps | Track manager overrides |
