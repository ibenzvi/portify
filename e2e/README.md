# Portify end-to-end checks (sample data only)

These scripts drive the app in headless Chrome against a local mock of the records API.
They never touch Supabase or real data.

    node e2e/mock.mjs &                      # mock backend on :54399
    VITE_SUPABASE_URL=http://localhost:54399 VITE_SUPABASE_ANON_KEY=k npx vite --port 5199 &
    npm i --no-save puppeteer-core           # plus a Chrome at /usr/bin/google-chrome
    node e2e/flows.mjs                       # save/delete/chat/error flows at 390px
    node e2e/mobile.mjs                      # 320/390/430/1280 overflow, menu, invalid input, chat history/retry/upload

Not covered: real Supabase (RLS, row limits, auth), the real /api/chat model, real devices.
