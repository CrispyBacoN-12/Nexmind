# Fractional shares in /journal: short design

- Date: 2026-11-25. Approved by owner ("ok") the same day.
- Owner's words: "แก้ให้เป็นซื้อเศษหุ้นได้หน่อย", then chose **ก**: journal only.

## Intent

The owner buys fractional shares on Webull and wants to record them in /journal so the risk numbers
(risk $, R, put card) use the real holding.

## Approaches

- **ก (picked): /journal only.** Store and accept fractional shares; everything that reads
  `JournalTrade.shares` already does float math.
- ข: /journal + /advisor fractional sizing. Deferred: Webull fractional orders are market/limit,
  regular hours only, and a resting stop on a fractional position is unconfirmed, so the advisor would
  need a warning whose wording depends on what the owner finds in the app.

## Design

1. `JournalTrade.shares` Int → Float (`DOUBLE PRECISION`). Widening; existing values unchanged.
   SQL from `prisma migrate diff`, applied through the Neon HTTPS driver (port 5432 is blocked),
   before the code ships.
2. `parseOpenTrade`: shares must be a finite number > 0; no whole-share check.
3. Display: shares shown with up to 4 decimals in the /journal table and the put card.

## Non-goals

- /advisor sizing and the portfolio-gates suggested size stay whole shares.
- No rounding to a broker lot size.
