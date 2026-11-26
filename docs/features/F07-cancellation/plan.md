# Plan — F07 Event cancellation

1. `src/cancellation/cancel.ts`: `cancelEvent` (one transaction, owner-scoped row lock).
2. `src/cancellation/index.ts`: management section (order 30), `POST /events/:id/cancel` inside `registerOrganizerRoutes`;
   one line in `src/app.ts`; `cancelled: "Evento cancelado."` added to F02's `NOTICES`.
3. Tests `tests/cancellation.test.ts`: domain (published only; owner only; confirmed→refunded, pending→cancelled,
   declined untouched; late gateway answer after cancel; purchases racing a cancel never leave a pending/confirmed
   ticket on a cancelled event); HTTP (section per status, 303/409/404, edit/publish blocked, storefront/API/check-in/
   dashboard after cancel, the X-F04-F07-2 fixture end to end at gateway scale 0.01).
