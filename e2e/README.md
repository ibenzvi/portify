# Portify end-to-end checks (sample data only)

These scripts drive the app in headless Chrome against a local mock of the records API.
They never touch Supabase or real data. The mock holds invented sample records in memory.

    npm ci
    npm run test:e2e        # starts the mock and vite, runs every suite, stops them

Needs a Chrome or Chromium. Set CHROME_PATH if it is not at /usr/bin/google-chrome.
Suites: flows (save/delete/chat/error at 390px), mobile (320/390/430/1280 layout, menu, invalid input,
chat history/retry/upload), crud (quick buy/sell, edit/delete for classes, instruments, manual assets, values),
chat (upload to review to save, save and delete failures), desktop (1280px layout, screenshots in /tmp).

Not covered: real Supabase (RLS, row limits, auth), the real chat model, real devices.
Deletes that involve several requests are not atomic. A failure shows an error and reloads the data,
but it does not roll back requests that already succeeded.
