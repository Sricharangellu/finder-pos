# Entertainment & Events

## Who this is for

Concert venues, cinemas, theatres, sports venues, escape rooms, amusement parks, and any business that sells tickets to fixed-capacity events.

## Activated modules

| Module | What it does |
|---|---|
| Tickets | Event creation, ticket sales, capacity management |
| Access Control | QR code scanning for entry; redemption tracking |
| Concessions | In-venue F&B sales (uses standard POS module) |
| Season Passes | Multi-event or all-season access passes |

## Events

Location: `/entertainment`

Each event record holds:
- Event name
- Start date/time
- Ticket price (in dollars)
- Capacity (max attendees)
- Tickets sold (maintained atomically — no overselling)
- Status: **Draft**, **On Sale**, **Sold Out**, **Completed**, **Cancelled**

## Selling tickets

1. Select an event from the list
2. Click **Sell tickets**
3. Enter the quantity to sell
4. Choose the customer (optional) or sell as walk-up
5. Click **Confirm** — the system atomically checks capacity, increments sold count, and issues ticket records

### Oversell protection

Ascend uses a database transaction to check capacity before selling. If `sold + quantity > capacity`, the sale is rejected with a `insufficient_capacity` error. This prevents double-selling even under concurrent load.

### After sale

Each sold ticket gets a unique QR code: `{eventId}_{ticketId}`. QR codes are displayed on screen and can be printed or emailed to the customer.

## Redeeming tickets (access control)

At the venue entrance, use the Redeem modal:

1. Click **Redeem ticket**
2. Scan or type the QR code
3. System validates the code:
   - Valid & unused → green success screen, `redeemed_at` timestamp recorded
   - Already redeemed → red error (`already_redeemed`)
   - Not found → red error (`ticket_not_found`)

Each ticket can only be redeemed once.

## Capacity indicator

The event card shows a capacity bar:
- **Green** — under 70% sold
- **Amber** — 70–90% sold
- **Red** — 90%+ sold (nearly full)

Sold-out events are automatically blocked from further ticket sales.

## Dashboard widget

The Entertainment widget on the dashboard shows:
- Upcoming events with status **On Sale**
- Capacity fill % for each event
- Mini-progress bar per event

## Season passes

Season passes give access to multiple events without buying individual tickets. Create in **Settings → Season Passes**:
- Name, price, valid date range
- Linked event list (or "all events" option)

At redemption, a season pass validates against the event date range.
