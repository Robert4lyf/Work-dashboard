# Dashboard: setup

About 20 minutes, done once from a computer. Everything used here is free.

## 1. Create the sync database (Supabase)

1. Sign up at https://supabase.com and create a new project. Pick a region near you and save the database password somewhere safe.
2. Open **SQL Editor**, paste the contents of `supabase-setup.sql`, and click **Run**.
3. Open **Project Settings > API** (or **API Keys**). Copy the **Project URL** and the **anon** (or **publishable**) key.
   Never use the `service_role` / secret key in this app.

## 2. Add your details to the app

Open `config.js` in a text editor and paste them in:

```js
self.COCKPIT_CONFIG = {
  supabaseUrl: "https://abcdefgh.supabase.co",
  supabaseAnonKey: "eyJ..."
};
```

The anon key is designed to be public. Row-level security (from the SQL file) is what keeps your data private.

## 3. Put it online (GitHub Pages)

1. Create a free account at https://github.com and make a new **public** repository, e.g. `dashboard`.
2. Click **Add file > Upload files** and upload everything in this folder, keeping the `icons`, `js` and `.github` folders. Commit.
3. Go to **Settings > Pages**. Under *Build and deployment*, set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. The "Deploy to GitHub Pages" workflow runs on every upload to `main` (run it by hand the first time if it hasn't started).
5. After a minute your app is live at `https://YOUR-USERNAME.github.io/dashboard/`.

If you'd rather use **Deploy from a branch** (branch `main`, folder `/ (root)`), delete `.github/workflows/pages.yml`, otherwise that workflow fails on every upload.

## 4. Finish Supabase auth settings

1. In Supabase, open **Authentication > URL Configuration** and set **Site URL** to your GitHub Pages address.
2. Open the app, open the **Settings** tab, and choose **Create account**.
3. Confirm the email Supabase sends you, then sign in in the app.
4. Back in Supabase, open **Authentication > Sign In / Providers** and turn **off** "Allow new users to sign up". Only your account can then use your database.

## 5. Install it

- **Android:** open in Chrome > menu > **Install app**.
- **Computer:** in Chrome or Edge, click the install icon at the right of the address bar.

Sign in once on each device. After that it opens like a normal app, works offline, and syncs when you're online.

## 6. Bring over your existing data

In the old claude.ai version: **Save backup**. In the new app: open **Settings** > **Restore backup** and choose that file.

## Updating the app later

Upload the changed files to the repository. The deploy workflow stamps a new `VERSION` in `sw.js` automatically, so installed copies pick up the update. Close and reopen the app twice to see it.

If you deploy from a branch instead of the workflow, change `VERSION` in `sw.js` by hand on each upload (e.g. `dashboard-v5`).

**Upgrading:** whenever this file changes, run the updated `supabase-setup.sql` once in the SQL Editor. It's safe to re-run and only adds what's missing.

**Upgrading to per-item sync (item rows and live updates):** run the updated `supabase-setup.sql` first, then open the updated app on one device and let it sync; that device moves your data into the new table. Then open the app on your other devices. If live updates don't arrive, check **Database > Publications > supabase_realtime** in Supabase includes `cockpit_items`.

## Notifications (optional, one-time setup)

Real notifications, even with the app closed: when a focus session ends, on the morning a deadline is due, and when an Upcoming quest returns to Today.

1. Run the updated `supabase-setup.sql` (adds the notification tables).
2. In the app: **Settings > Notifications > Generate keys**. Copy the two keys it shows (the private key isn't saved anywhere else).
3. In Supabase, open **Edge Functions**, create a function named `send-notices`, and give it the two files from `supabase/functions/send-notices/` (`index.ts` and `core.mjs`). Turn **off** "Enforce JWT verification" for it (a secret header protects it instead). If you use the Supabase CLI: `supabase functions deploy send-notices --no-verify-jwt`.
4. In **Edge Functions > Secrets**, add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (from step 2), `VAPID_SUBJECT` (`mailto:` plus your email) and `CRON_SECRET` (any long random string).
5. Open `supabase/notifications-cron.sql`, replace `YOUR-PROJECT-REF` (from your project URL) and `YOUR-CRON-SECRET`, and run it in the SQL Editor. It checks for due notifications every minute.
6. On each device: **Settings > Notifications > Turn on for this device**, then **Send a test**.

**Lost the private key?** It's only shown once. Use **Settings > Notifications > New keys**: it makes a new pair and turns notifications off on every device. Enter the two new keys in the function's secrets (step 4), then turn notifications on again on each device.

**If the test doesn't arrive:** **Send a test** checks each link and shows which one is broken: *This phone* (a notification shown straight away, no server; if it fails, allow notifications for Chrome/the app in Android settings), *Subscription* (this device is subscribed with the current key; if not, **Turn off here** and turn it on again) and *Server* (the function picks it up within about a minute and sends it). If the server tried and failed it says why, for example the VAPID secrets not matching the keys the app generated (re-enter them from step 2, or generate new keys and turn notifications off and on again on each device). "Not picked up" means the function, its secrets or the cron job from step 5 isn't set up. After updating the app, re-run `supabase-setup.sql` and redeploy `send-notices` so the reason is recorded.

## How sync behaves

- Each quest, inbox item, focus session and so on is stored as its own row, so devices only exchange what changed. Changes save instantly on the device, sync about a second later, and reach your other open devices within a second or two (live updates).
- Edits on two devices at the same time (or offline) are all kept, as long as they're to different items. If the *same* quest was changed on both, the newer edit wins. Focus time from every device adds up.
- A copy of everything is saved on the server every few hours (the newest 200 are kept). If something goes missing, open **Settings > Previous versions** and restore one.

## Features worth knowing

- **One way in:** new work always starts in the Inbox (typed, spoken, shared or captured from anywhere). Today only holds what you've chosen from it: tap **Today** on an inbox item, or set its project, waiting details or a later date first. Subquests are still added on a quest's page.
- **Tabs:** Today, Inbox, Waiting, Review and Settings. Focus opens from the header (tap the focus time, **Single-task**, or **Focus on this** on a quest).
- **Estimates:** on a quest (or a step), pick 15m, 30m, 1h or 2h. Today then shows what's planned against the free time left: from now to the end of your workday (Settings > Appearance, 17:30 by default). When it doesn't fit, the line turns orange. Waiting quests don't count.
- **Inbox swipes (phone):** swipe an item left to send it to Today (with Undo); swipe right for quick options: Tomorrow, Next week, Waiting… or Clear.
- **Weekly review:** Review > Week walks through the week in one page: empty the Inbox, decide on carried-over quests, chase what you're waiting on, projects with nothing open, what's coming up, and what you finished (with **Copy summary** for an update). From Friday until you tap **Mark week reviewed**, the header shows a **Weekly review** button.
- **Health check:** Settings > Health check tests the setup against your Supabase project (sync table, live updates, notifications, offline) and says what to fix for anything that isn't working.
- **Voice capture:** tap the mic next to the inbox box and speak. Say "next item" between thoughts to add several at once (this also works when typing or using keyboard dictation). The mic shows in Chrome and Edge. Chrome sends the audio to Google to transcribe.
- **Inbox subquests:** tap **Add subquests** on an inbox item to break it down before it goes to Today. They move with it.
- **Header:** your next step (tick it off, tap to open it, or **Focus** to start single-task mode), today's progress and focus time. While a focus timer runs, it shows the countdown with a pause button. Anything needing attention (overdue, due today, to chase, weekly review) shows at the top of Today instead, and the Waiting and Review tabs get a badge.
- **History (Review > History):** where your focus time went (week, month or year, by tag) and what you finished over the last two weeks. **Copy last 7 days** gives you a ready-made standup update.
- **Tags:** a tag belongs to a quest. Set it on the quest (Today) or inbox item (Tag and subquests); subquests and focus sessions use it. Add, rename or delete tags in the Settings tab.
- **Undo:** deleting a quest, clearing an inbox item, or deleting a template or tag shows an Undo button for 5 seconds.
- **Upcoming:** on a quest (or an inbox item's Tag and subquests), use **Do later** (Tomorrow, Next Mon, or a date) to move it off Today. It waits under Today > Upcoming, where you can change the date or bring it back, and joins the end of Today's list on its day.
- **Capture from anywhere:** in Settings > Capture from anywhere, create a private capture link, then follow the steps for Android's HTTP Shortcuts app. On a computer, drag the **+ Dashboard** bookmarklet to your bookmarks bar to send the page you're on. Long-pressing the installed app's icon also offers **Capture** and **Focus**.
- **Share to Inbox (Android):** once the app is installed, choose it from any app's Share menu to drop a link or text straight into the inbox.
- **Repeating quests:** open a quest and use **Repeat** to pick days (every day, weekdays, any mix) and/or a day of the month. A fresh copy, subquests included, is added to Today on those days, even if the app wasn't opened on the day itself. An unfinished copy carries over instead of doubling up. Choose **Off** to stop it. All repeats are listed under Today > Repeating quests.
- **Projects:** Review > Projects is where you set up projects and see each one's finished and open quests, progress and focus time. Add new work for a project right there (it goes to the Inbox, already in the project), or pull in one that's already on Today. You can also pick a project on a quest or an inbox item. Finish, rename or delete projects from the tab.
- **Single-task mode:** starting a focus session opens a full-screen view of just your current step and the timer (pause, +5 min, stop and save, Done, discard). While the timer runs you stay there: the tabs and shortcuts come back when you pause. Resuming, or reopening the app mid-session, goes straight back in. You can also open it any time with **Single-task** in the header or `z`.
- **Talk mode (optional, per device):** turn it on in **Settings > Talk mode** and a **Talk** button appears in the header (there's also a **Talk** app-icon shortcut). The app reads out your day (time, planned vs free, Next up, inbox, anything to chase) and listens for an answer: "done", "start focus", "tomorrow", "waiting on Sam", "add …" (to the inbox), "inbox" (goes through it item by item: today, tomorrow, next week, delete or skip), "next", "repeat", "help" and "stop". Works with headphones; the screen stays on while it's open, since Android stops listening when the screen locks.
- **Where you left off:** when a focus session stops, the app asks for one line on where you left it. The note shows on that step next time: in single-task mode, the Focus tab and the quest's page.
- **Carried over:** each quest on Today remembers when it arrived. After 3 days a "Carried over" card at the top of Today asks you to decide: **Keep** (asks again tomorrow), **Tomorrow**, **Next week**, **Inbox** or **Drop**. The quest's row also shows its age.
- **Waiting:** on a quest (or a step), open **Waiting on someone?** to say who and what for, with an optional date to chase. It stays on Today with a "Waiting on …" tag but isn't Next up. The Waiting tab lists everything you're waiting on, lets you add a new one (it lands in the Inbox, already waiting), and **Got it** puts it back on your list. Chase dates show in the header and get a 9am notification. A quest with a waiting step shows as waiting too ("Step waiting on Sam"); its other steps carry on.
- **Interruptions:** pausing a focus session asks what paused you. Name the cause (or tap one you've used before) and it's logged as an interruption; tap **Just a break**, or simply resume, and nothing is logged. History shows the last 7 days: how many, how often per focus hour, the main causes and the busiest hour.
- **Desktop board:** on a wide screen, Today, Inbox and Focus sit side by side. Drag an inbox item onto Today (onto a quest to place it before or after), a quest onto Inbox or onto Focus, or quests within Today to reorder.
- **Appearance:** Settings > Appearance offers the pixel font or a plain one, and light, dark or matching your system. It's saved per device.
- **Focus timer:** pick what you're working on (defaults to Next up) and a length. While it runs: pause, +5 min, stop and keep the minutes, or **Done** to save and tick off the quest.
- **Timer alerts:** the first time you start a timer, the app asks to show notifications. On a computer you get an alert when the timer ends, even from another tab (it can arrive up to a minute late). On phones, the operating system pauses the app in the background, so the alert only comes when you reopen it.
- **Keyboard shortcuts (computer):** `i` or `n` capture to the inbox (`n` on a quest's page adds a subquest), `t` today, `f` focus, `l` history (Review), `s` settings, `z` single-task, `p` pause/resume the timer, `Esc` back, `?` show these.
- Free Supabase projects pause after a week with no activity. Opening the app regularly keeps it awake. If it pauses, click **Restore** in the Supabase dashboard; your data is kept.

## Working on the code

The app is plain HTML, CSS and JavaScript with no build step: `index.html` loads `styles.css` and the scripts in `js/` in order (they share globals).

- `npm install` once, then `npm test` runs the browser tests in `tests/` (Playwright, Chromium).
- `npm run format` tidies the code with Prettier.
- Every pull request runs the format check and tests on GitHub (`.github/workflows/test.yml`).
