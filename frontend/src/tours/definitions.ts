/*  The guided tours. Each step spotlights a `data-tour` anchor in the
    screen's markup, so restyling a screen doesn't break its tour; renaming
    or removing an anchor does, so keep them when you rework a screen.

    Copy is English source and goes through t() at run time: add every new
    title and body to locales/id.json. */

import type { Tour } from "./types"

export const TOURS: Tour[] = [
  {
    id: "welcome",
    version: 1,
    title: "Find your way around",
    summary: "Apps, search, bookings and where to find these tours again.",
    minutes: 1,
    // the first one the person's role can open: the desk, the books, the
    // housekeeping office, then the restaurant
    next: ["today", "billing", "hk-board", "restaurant-pos"],
    steps: [
      {
        title: "Welcome to BizConnect.id Hotel",
        body: "A one-minute look at where things are. Use Next or the arrow keys, and press Esc to leave at any time.",
      },
      {
        at: ["app-menu", "app-switcher"],
        title: "Switch between apps",
        body: "The system is split into apps: Front Desk, Housekeeping, F&B, Finance and more. You see the ones your role uses.",
        side: "right",
        when: (c) => c.multiApp,
      },
      {
        at: "nav",
        title: "Pages in this app",
        body: "Each app lists its pages here, grouped into sections. The page you're on is highlighted.",
        side: "right",
        when: (c) => c.rail,
      },
      {
        at: "menu-button",
        title: "The menu",
        body: "Tap here for the pages of the app you're in.",
        when: (c) => !c.rail,
      },
      {
        at: "search",
        title: "Search everything",
        body: "Find a guest, booking or invoice by name, phone or number, or jump to any page. Press `Ctrl` `K` (`⌘` `K` on a Mac) from anywhere.",
      },
      {
        at: "property",
        title: "Switch property",
        body: "You work across several properties. Pick one here and every screen follows it.",
        when: (c) => c.multiProperty,
      },
      {
        at: "booking-buttons",
        title: "Book a room",
        body: "**New booking** takes a reservation for any date. For a guest at the desk now, **Walk-in** books, checks in and takes payment in one go; it's also a switch inside the booking form.",
        side: "bottom",
        align: "end",
        when: (c) => c.canBook,
      },
      {
        at: "account",
        title: "Your account",
        body: "Sign out from here. The moon beside it switches between light and dark mode.",
        side: "bottom",
        align: "end",
      },
      {
        at: "guides",
        title: "Tours whenever you need them",
        body: "**Guides** lists a short tour for each screen. Open it any time for a refresher.",
        side: "right",
        align: "end",
        when: (c) => c.rail,
      },
      {
        at: "account",
        title: "Tours whenever you need them",
        body: "**Guided tours** in this menu lists a short tour for each screen. Open it any time for a refresher.",
        side: "bottom",
        align: "end",
        when: (c) => !c.rail,
      },
    ],
  },

  // ── Front Desk ──────────────────────────────────────────────────────────
  {
    id: "today",
    version: 1,
    title: "Today at the front desk",
    summary: "Arrivals, departures, the room board and who's in house.",
    app: "front-desk",
    route: "/",
    minutes: 1,
    next: ["new-booking"],
    steps: [
      {
        at: "today-kpis",
        title: "The day in numbers",
        body: "Arrivals, departures, guests in house, occupancy and today's revenue. They refresh every 30 seconds.",
      },
      {
        at: "today-arrivals",
        title: "Arrivals",
        body: "Everyone due today. **Check in** opens the check-in form: assign a room, record the ID and take a deposit.",
        side: "right",
      },
      {
        at: "today-departures",
        title: "Departures",
        body: "Guests leaving today. Settle any balance in Billing, then **Check out** closes the stay.",
        side: "right",
      },
      {
        at: "today-rooms",
        title: "Room board",
        body: "Every room, coloured by housekeeping status. Tap a room to mark it clean or dirty, open the guest's registration or see cleaning photos.",
        side: "left",
      },
      {
        at: "today-inhouse",
        title: "In-house guests",
        body: "Who's staying, in which room, and any balance due. Click a row to open the registration card.",
        side: "top",
      },
    ],
  },
  {
    id: "new-booking",
    version: 1,
    title: "Take a booking",
    summary: "The booking form from guest to confirmation, with the live quote.",
    app: "front-desk",
    minutes: 2,
    when: (c) => c.canBook,
    steps: [
      {
        at: "new-booking",
        title: "Start a booking",
        body: "Click **New booking**, or press Next and we'll open it for you.",
        side: "bottom",
        align: "end",
        action: true,
      },
      {
        at: "booking-mode",
        title: "Reservation or walk-in",
        body: "**Reservation** is for a stay booked ahead. **Walk-in** is for a guest at the desk now: it also checks them in and takes payment.",
        side: "bottom",
        align: "end",
        noBack: true,
      },
      {
        at: "booking-guest",
        title: "Who's staying",
        body: "Type the guest's name. Returning guests show up as you type: pick them to keep their history together.",
        interactive: true,
      },
      {
        at: "booking-room-type",
        title: "Room type",
        body: "Each type shows its price per night.",
      },
      {
        at: "booking-stay",
        title: "Dates and guests",
        body: "Set the check-in date, the number of nights and who's coming. If the party is too big for one room, the form offers to split it.",
        interactive: true,
      },
      {
        at: "booking-extras",
        title: "Meals and vouchers",
        body: "Add a meal plan or a voucher code. The quote updates as you go.",
      },
      {
        at: "booking-quote",
        title: "Live quote",
        body: "The total with tax, the cancellation terms and any deposit due. Read it back to the guest before you confirm.",
        side: "left",
      },
      {
        at: "booking-confirm",
        title: "Confirm",
        body: "**Confirm booking** saves it and assigns a free room. **Waitlist** parks it with no room. The form stays open after the tour, so finish the booking or close it.",
        side: "top",
      },
    ],
  },
  {
    id: "tape-chart",
    version: 1,
    title: "Tape chart",
    summary: "Rooms by day: spot gaps, move stays and assign arrivals.",
    app: "front-desk",
    route: "/tape",
    minutes: 1,
    steps: [
      {
        at: "tape-grid",
        title: "Rooms by day",
        body: "Each row is a room and each column a day. Bars are stays: blue is confirmed, violet is checked in.",
        side: "top",
      },
      {
        at: "tape-position",
        title: "House position",
        body: "Rooms sold out of rooms available, per day. Green means busy and red means overbooked.",
      },
      {
        at: "tape-bar",
        title: "Move a stay",
        body: "Click a bar to move the guest to another room or change the dates.",
        optional: true,
      },
      {
        at: "tape-view",
        title: "Days or hours",
        body: "Switch to **Hourly** for day-use rooms and same-day changeovers.",
      },
      {
        at: "tape-auto-assign",
        title: "Auto-assign arrivals",
        body: "Suggests a room for each arrival that has none. You review the plan before anything changes.",
      },
      {
        at: "tape-dates",
        title: "Move through the calendar",
        body: "Step a week at a time, or pick the first day to show.",
        side: "bottom",
        align: "end",
      },
    ],
  },
  {
    id: "reservations",
    version: 1,
    title: "Find a reservation",
    summary: "Search, filter and export lists. Every list in the app works the same way.",
    app: "front-desk",
    route: "/reservations",
    minutes: 1,
    steps: [
      {
        at: "list-search",
        title: "Search and filter",
        body: "Search by guest or booking number, and narrow the list by status or dates.",
      },
      {
        at: "list-table",
        title: "The list",
        body: "Click a row to open it and make changes.",
        side: "top",
      },
      {
        at: "list-tools",
        title: "Export and columns",
        body: "Download what you see as a CSV for Excel, or choose which columns show.",
        side: "bottom",
        align: "end",
      },
      {
        at: "list-new",
        title: "Add a record",
        body: "**New** opens a blank form. Rooms, rate plans, guests and the other lists work the same way.",
        side: "bottom",
        align: "end",
        optional: true,
      },
    ],
  },

  // ── Housekeeping ────────────────────────────────────────────────────────
  {
    id: "hk-board",
    version: 1,
    title: "Housekeeping room board",
    summary: "Every room's status at a glance, and how to change it.",
    app: "housekeeping",
    route: "/housekeeping-board",
    minutes: 1,
    steps: [
      {
        at: "hk-filters",
        title: "Filter rooms",
        body: "Show only dirty rooms, rooms due out today or rooms with an open task. The numbers are live counts.",
      },
      {
        at: "hk-rooms",
        title: "Every room at a glance",
        body: "Green is clean, blue inspected, amber dirty and red out of order. A bed means someone is staying.",
        side: "top",
      },
      {
        at: "hk-room",
        title: "Change a status",
        body: "Tap a room to set its status. The front desk sees the change straight away.",
        optional: true,
      },
    ],
  },

  // ── F&B ─────────────────────────────────────────────────────────────────
  {
    id: "restaurant-pos",
    version: 1,
    title: "Restaurant POS",
    summary: "Tables, the menu, the bill and settling, plus the shortcut keys.",
    app: "fnb",
    route: "/pos",
    minutes: 2,
    steps: [
      {
        at: "pos-outlet",
        title: "Choose the outlet",
        body: "Each restaurant or bar is an outlet with its own menu and tables.",
      },
      {
        at: "pos-tables",
        title: "Tables",
        body: "Pick a table to start its bill or reopen a running one. The colours show whether a table is free, running, in the kitchen or reserved.",
        side: "right",
        optional: true,
      },
      {
        at: "pos-menu",
        title: "The menu",
        body: "Search or pick a category, then tap an item to add it to the bill.",
        side: "left",
        optional: true,
      },
      {
        at: "pos-bill",
        title: "The bill",
        body: "Items, discount and totals for the open bill. Send the order to the kitchen (KOT) or hold the bill from here.",
        side: "left",
        optional: true,
      },
      {
        at: "pos-settle",
        title: "Settle",
        body: "Take payment, or post the bill to a guest's room.",
        side: "top",
        optional: true,
      },
      {
        at: "pos-keys",
        title: "Shortcut keys",
        body: "`F2` new bill, `F4` settle, `F5` hold, `F6` send the KOT. Focus mode hides the hotel menus on a dedicated till.",
        side: "bottom",
        align: "end",
      },
    ],
  },

  // ── Finance ─────────────────────────────────────────────────────────────
  {
    id: "billing",
    version: 1,
    title: "Billing and night audit",
    summary: "Folios, the night audit and where cash handling lives.",
    app: "finance",
    route: "/billing",
    minutes: 1,
    next: ["cashier"],
    steps: [
      {
        at: "billing-folios",
        title: "Folios",
        body: "Every stay has a folio: its charges, payments and balance. Click one to post charges, take payment, settle and print the invoice.",
        side: "top",
      },
      {
        at: "billing-audit",
        title: "Night audit",
        body: "Posts tonight's room charges for every in-house guest and flags no-shows. It runs by itself at 3 AM; run it by hand to close the day earlier.",
      },
      {
        at: "billing-pos",
        title: "Cash and the till",
        body: "Cash has its own screen: open the till, record paid outs and close the shift there.",
      },
    ],
  },
  {
    id: "cashier",
    version: 1,
    title: "Open and close the till",
    summary: "The opening float, paid outs, cash drops and closing count.",
    app: "finance",
    route: "/cashier",
    minutes: 1,
    steps: [
      {
        at: "cashier-open",
        title: "Open a session",
        body: "Count the cash in the drawer, enter it as the opening float and open the session. Cash you take is counted against it.",
        optional: true,
      },
      {
        at: "cashier-totals",
        title: "Where the cash stands",
        body: "Float, takings by method, paid outs and drops add up to the cash the drawer should hold.",
        optional: true,
      },
      {
        at: "cashier-paidout",
        title: "Paid out",
        body: "Cash leaving the drawer for an expense. Always give the reason.",
        optional: true,
      },
      {
        at: "cashier-drop",
        title: "Cash drop",
        body: "Move surplus cash to the safe during the shift.",
        optional: true,
      },
      {
        at: "cashier-close",
        title: "Close the session",
        body: "Count the drawer, enter the amount and close. Any difference shows as the variance.",
        optional: true,
      },
      {
        at: "cashier-links",
        title: "Sessions and shift report",
        body: "Past sessions, and the end-of-shift report for the handover.",
        side: "bottom",
        align: "end",
      },
    ],
  },
]

export const tourById = (id: string) => TOURS.find((t) => t.id === id)
