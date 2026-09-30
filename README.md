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
  supabaseUrl: 'https://abcdefgh.supabase.co',
  supabaseAnonKey: 'eyJ...',
};
```

The anon key is designed to be public. Row-level security (from the SQL file) is what keeps your data private.

## 3. Put it online (GitHub Pages)

1. Create a free account at https://github.com and make a new **public** repository, e.g. `dashboard`.
2. Click **Add file > Upload files** and upload everything in this folder, keeping the `icons`, `js` and `.github` folders. Commit.
3. Go to **Settings > Pages**. Under _Build and deployment_, set **Source** to **GitHub Actions**.
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

In the old claude.ai version: **Save backup**. In the new app: open **Settings** > **Restore backup** and choose that file. Restoring replaces quests, inbox, notes, alarms and history but keeps your notification keys, device names and any running timer.

## Updating the app later

Upload the changed files to the repository. The deploy workflow stamps a new `VERSION` in `sw.js` automatically, so installed copies pick up the update. Close and reopen the app once while online to see it.

If you deploy from a branch instead of the workflow, change `VERSION` in `sw.js` by hand on each upload (e.g. `dashboard-v5`).

**Upgrading:** whenever this file changes, run the updated `supabase-setup.sql` once in the SQL Editor. It's safe to re-run and only adds what's missing.

**Upgrading to per-item sync (item rows and live updates):** run the updated `supabase-setup.sql` first, then open the updated app on one device and let it sync; that device moves your data into the new table. Then open the app on your other devices. If live updates don't arrive, check **Database > Publications > supabase_realtime** in Supabase includes `cockpit_items`.

## Notifications (optional, one-time setup)

Real notifications, even with the app closed: when a focus session ends, on the morning a deadline or chase date is due, when an Upcoming quest returns to Today, when an alarm rings, and for alerts from your scripts (below).

1. Run the updated `supabase-setup.sql` (adds the notification tables).
2. In the app: **Settings > Notifications > Generate keys**. Copy the two keys it shows (the private key isn't saved anywhere else).
3. In Supabase, open **Edge Functions**, create a function named `send-notices`, and give it the two files from `supabase/functions/send-notices/` (`index.ts` and `core.mjs`). Turn **off** "Enforce JWT verification" for it (a secret header protects it instead). If you use the Supabase CLI: `supabase functions deploy send-notices --no-verify-jwt`.
4. In **Edge Functions > Secrets**, add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (from step 2), `VAPID_SUBJECT` (`mailto:` plus your email) and `CRON_SECRET` (any long random string).
5. In Supabase, **Database > Extensions**: enable **pg_cron** and **pg_net** (the job below needs both). Then copy `supabase/notifications-cron.sql` into the SQL Editor, replace `YOUR-PROJECT-REF` (from your project URL) and `YOUR-CRON-SECRET` (the same value as the function's secret) and run it. It checks for due notifications every minute. Make the replacements in the SQL Editor only, not in the file in the repository: the repository is public, and the secret shouldn't be in it.
6. On each device: **Settings > Notifications > Turn on for this device**, then **Send a test**.

**Lost the private key?** It's only shown once. Use **Settings > Notifications > New keys**: it makes a new pair and turns notifications off on every device. Enter the two new keys in the function's secrets (step 4), then turn notifications on again on each device.

**If the test doesn't arrive:** **Send a test** checks each link and shows which one is broken: _This phone_ (a notification shown straight away, no server; if it fails, allow notifications for Chrome/the app in Android settings), _Subscription_ (this device is subscribed with the current key; if not, **Turn off here** and turn it on again) and _Server_ (the function picks it up within about a minute and sends it). If the server tried and failed it says why, for example the VAPID secrets not matching the keys the app generated (re-enter them from step 2, or generate new keys and turn notifications off and on again on each device). "Not picked up" means the function, its secrets or the cron job from step 5 isn't set up. After updating the app, re-run `supabase-setup.sql` and redeploy `send-notices` so the reason is recorded.

## Alerts from scripts and flows (optional)

Anything that can send a web request (PowerShell, Power Automate Desktop, Task Scheduler jobs, Tasker...) can notify your phone and add the alert to the Dashboard. It needs notifications set up (above) and a capture link (**Settings > Capture from anywhere**; the values are under **Set up a shortcut**). Run the updated `supabase-setup.sql` once first, then tap **Test alert** there.

Send a POST to the **Alert URL** with the header `apikey: <apikey value>` and a JSON body:

| Field        | Required | Meaning                                                                                                                                                                      |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`      | yes      | the capture token                                                                                                                                                            |
| `title`      | yes      | the notification title, and the item's name                                                                                                                                  |
| `body`       | no       | details: the notification text, and the item's notes                                                                                                                         |
| `to`         | no       | `inbox` (default): notification + Inbox item; `phone`: notification only; `today`: notification + a quest on Today; `waiting`: notification + an Inbox item waiting on `who` |
| `who`, `due` | no       | for `waiting`: who you're waiting on, and when to chase (`yyyy-mm-dd`)                                                                                                       |

The notification arrives within about a minute. Keep work details out of messages ("Invoice flow failed at step 4", not the data itself); the token only lets callers add alerts and items to the Inbox or Today (never read anything), and **New link** replaces it. Limits: 60 alerts an hour; titles are cut to 200 characters and the notification text to 300 (the item keeps up to 4,000).

**PowerShell**

```powershell
$url = 'https://YOUR-PROJECT.supabase.co/rest/v1/rpc/cockpit_alert'
$key = 'YOUR-APIKEY'; $token = 'YOUR-TOKEN'
Invoke-RestMethod -Method Post -Uri $url -Headers @{ apikey = $key } -ContentType 'application/json' `
  -Body (@{ token = $token; title = 'Backup failed'; body = 'Robocopy exit code 8'; to = 'inbox' } | ConvertTo-Json)
```

**Power Automate Desktop** (alert when a flow fails)

1. Set variables `DashURL` (the Alert URL), `DashKey` (apikey) and `DashToken` (token) at the top of the flow.
2. Make a subflow `SendAlert`:
   - **Get last error** into `LastError`.
   - **Set variable** `Alert` to `%{ 'token': DashToken, 'title': 'Invoice flow failed', 'body': LastError.Message, 'to': 'inbox' }%`, then **Convert custom object to JSON** into `AlertJson` (this copes with quotes and line breaks in the error).
   - **Invoke web service**: URL `%DashURL%`, method POST, accept and content type `application/json`, custom headers `apikey: %DashKey%`, request body `%AlertJson%`, "Encode request body" off. Set its own **On error** to continue, so a network problem can't hide the original failure.
3. Wrap the main steps in **On block error** that runs `SendAlert` (or set a risky action's **On error** to run it).
4. Run `SendAlert` once on its own to test. From a work PC, if it times out, the network is probably blocking `*.supabase.co`.

## How sync behaves

- Each quest, inbox item, focus session and so on is stored as its own row, so devices only exchange what changed. Changes save instantly on the device, sync about a second later, and reach your other open devices within a second or two (live updates).
- Edits on two devices at the same time (or offline) are all kept, as long as they're to different items. If the _same_ quest was changed on both, the newer edit wins. Focus time from every device adds up.
- A copy of everything is saved on the server every few hours (the newest 200 are kept). If something goes missing, open **Settings > Previous versions** and restore one.

## Features worth knowing

- **One way in:** new work always starts in the Inbox (typed, spoken, shared or captured from anywhere). Today only holds what you've chosen from it: tap **Today** on an inbox item, or set its waiting details or a later date first. Subquests are still added on a quest's page.
- **Tabs:** Today, Inbox, Knowledge, Review and Settings. Waiting opens from the **to chase** chip on Today (Inbox and Upcoming items you're waiting on also fold under Today's list); the notes are the **Scratchpad** tile at the top of Knowledge. Focus opens from the header (tap the focus time once there is some, **Single-task**, or **Focus on this** on a quest).
- **Header:** the next step with its tick on up to two lines (cut short if longer; tap it for the whole step), and under it **Focus**, a search icon and a sync dot. Finished quests fold away under **Done today** (open it to un-tick one). On a phone, swipe a row left for Inbox / Delete (there's no × on a phone), right to tick a step off. Rows show just the tag, what's waiting or due, and the next step.
- **Quests and subquests:** a quest is the title of a piece of work; its subquests are the actions. A quest with no subquests is still an action of its own (tick it, or focus on it). Subquests don't have subquests of their own: ones from before moved up beside their step, named with it ("Contract: Draft"). Waiting is always on a subquest: see **Waiting** below.
- **A quest's page:** its title and progress, its tag (folded to the one it has: tap to change), **Waiting on someone?**, then its subquests and an add box. Everything else is under **More**: notes and deadline, do later, repeat, move to inbox, delete. **Mark done** and **Focus on this** stay at the bottom of the screen. A subquest's page is the same without tag, subquests, do later or repeat (it has **Optional** under More).
- **Scratchpad (Knowledge > Scratchpad):** one free-text space, saved as you type and synced to your other devices. Handy for moving a phone number or a link from one device to another. Pictures can be pasted into the notes (or added from a file): they're shrunk to at most 1600 pixels across, shown below the text, and synced too. All of the app's data is kept in the browser's database (IndexedDB), pictures one by one and everything else as one saved copy, with room for far more than the old storage (pictures can take up to about 22 MB); the app asks the phone to keep its storage, so it isn't cleared when space runs low. Data saved by an earlier version moves over on the first run. An article holds up to 30 pictures and 50,000 characters. Tap one to see it full size.
- **Search:** the search icon in the header (or the / key) searches everything at once: quests and their steps (notes and waiting details too), Upcoming, the Inbox, Notes, Knowledge articles, flows and what you've finished. Tap a result to go to it.
- **Back gesture (Android):** steps back through the app (a picture shown full size, an article, the article editor, a quest's page, other tabs back to Today) and only leaves the app from Today's list. An article being written is kept if you leave the app, and comes back if it was closed before you saved.
- **Knowledge:** reference articles (step-by-step guides, who manages what, links to tools) filed in categories and sub-categories, shown as tiles with counts: open one for its sub-categories, articles and actions (**+ Article**, **+ Sub-category**, **Rename**, **Move**, **Delete**). Search looks through every article. Web links in an article are clickable. Articles can have pictures (paste a screenshot into the article while writing it, or use **Add picture**). Naming and renaming use a small sheet at the bottom of the screen.
- **Flows:** one chip per Power Automate Desktop flow, at the top of Today (Knowledge > **Manage flows** to add one with its Run URL: in Power Automate Desktop, the flow's Properties, then Details). A chip runs the flow on the computer it's tapped on, which needs Power Automate Desktop installed; it may ask you to confirm each run. Each chip shows when it was last tapped (the app can't tell whether the flow then ran).
- **Alarms (folded at the foot of Today; the header's alarm opens them):** **+ Alarm**, set the time and an optional label, and switch it **On**. Several can be on at once, and the header shows the next one. When one goes off it rings until you **Dismiss** it (or **Snooze 5 min**):
  - with the app open on that device, it shows a full-screen alarm and keeps sounding (browsers only allow sound once the app has been tapped since it was opened, so tap it once after opening);
  - otherwise it sends a notification that sounds and vibrates again every minute for 10 minutes (it needs notifications set up, above; Android's silent or Do Not Disturb modes can still mute it).

  Once a second device has signed in, choose which device rings (**Any device**, or one by name; name each device in **Settings > Appearance**). Alarms are for the current day: overnight they all switch off but stay listed, ready to edit or switch on again. Re-run `supabase-setup.sql` and redeploy `send-notices` so a device-specific alarm rings only on that device. After this update, reload the app on every device: a copy from before it still open somewhere doesn't know about notes and alarms and could remove them when it syncs.

- **Inbox swipes (phone):** swipe an item left to send it to Today (with Undo); swipe right for quick options: Tomorrow, Next week, Waiting… or Clear.
- **Weekly review:** Review > Week walks through the week one step at a time (Back and Next): empty the Inbox, decide on carried-over quests, chase what you're waiting on, what's coming up, and what you finished this calendar week, Monday to Sunday (with **Copy summary** for an update). From Friday until you tap **Mark week reviewed**, a **Weekly review** chip appears at the top of Today (and a dot on the Review tab).
- **Health check:** Settings > Health check tests the setup against your Supabase project (sync table, live updates, notifications, offline) and says what to fix for anything that isn't working.
- **Voice capture:** tap the mic next to the inbox box and speak. Say "next item" between thoughts to add several at once (this also works when typing or using keyboard dictation). The mic shows in Chrome and Edge. Chrome sends the audio to Google to transcribe.
- **Header:** your next step (tick it off, tap to open it, or **Focus** to start single-task mode), today's progress and focus time. While a focus timer runs, it shows the countdown with a pause button. Anything needing attention (overdue, due today, to chase, weekly review) shows at the top of Today instead.
- **History (Review > History):** where your focus time went (week, month or year, by tag) and what you finished over the last two weeks. **Copy last 7 days** gives you a ready-made standup update.
- **Tags:** a tag belongs to a quest. Set it on the quest's page (Today); subquests and focus sessions use it. Add, rename or delete tags in the Settings tab.
- **Undo:** deleting a quest, clearing an inbox item, or deleting a tag shows an Undo button for 5 seconds.
- **Upcoming:** on a quest (under More) or an opened inbox item, use **Do later** (Tomorrow, Next Mon, or a date) to move it off Today. It waits under Today > Upcoming, where you can change the date or bring it back, and joins the end of Today's list on its day.
- **Capture from anywhere:** in Settings > Capture from anywhere, create a private capture link (60 captures an hour, up to 20,000 characters each), then follow the steps for Android's HTTP Shortcuts app. On a computer, drag the **+ Dashboard** bookmarklet to your bookmarks bar to send the page you're on. Long-pressing the installed app's icon also offers **Capture**.
- **Share to Inbox (Android):** once the app is installed, choose it from any app's Share menu to drop a link or text straight into the inbox.
- **Repeating quests:** open a quest and use **Repeat** to pick days (every day, weekdays, any mix) and/or a day of the month. A fresh copy, subquests included, is added to Today on those days, even if the app wasn't opened on the day itself. An unfinished copy carries over instead of doubling up. Choose **Off** to stop it. All repeats are listed under Today > Repeating quests.
- **Single-task mode:** starting a focus session opens a full-screen view of just your current step and the timer (pause, +5 min, stop and save, Done, discard). While the timer runs you stay there: the tabs and shortcuts come back when you pause. Resuming, or reopening the app mid-session, goes straight back in. You can also open it any time with **Single-task** in the header or `z`. When the time runs out it asks what next: **Done** (ticks the step off), **+5 min** or **+15 min** (carry on), or **Stop for now**.
- **Carried over:** each quest on Today remembers when it arrived. After 3 days a folded "N quests carried over" line at the top of Today (open it) lets you decide on each: **Keep** (asks again tomorrow), **Tomorrow**, **Next week**, **Inbox** or **Drop**.
- **Waiting:** a subquest waits, never the quest itself. On a quest's page, **Waiting on someone?** adds a subquest named by "For what" (or "Hear back") that waits on who you say, with an optional date to chase; on a subquest's page it sets that step waiting. The quest shows "Waiting on …" on Today, and the waiting step isn't Next up. (Quests set waiting before this, and Inbox items moved to Today while waiting, get such a step automatically.) The Waiting page (from the "to chase" chip on Today, or Today's "Also waiting on others" section) lists everything you're waiting on, lets you add a new one (it lands in the Inbox, already waiting), and **Got it** puts it back on your list. Chase dates put a "to chase" chip at the top of Today, and get a 9am notification. A quest with a waiting step shows as waiting too ("Waiting on Sam"); its other steps carry on. Quests with waiting steps sit at the bottom of Today (above finished ones) and move back to their place when the wait is over.
- **Desktop:** Today and Inbox are separate pages, as on a phone. On a wide screen you can drag quests within Today to reorder them.
- **Appearance:** Settings > Appearance offers the pixel font or a plain one, and light, dark or matching your system. It's saved per device.
- **Focus timer:** pick what you're working on (defaults to Next up) and a length. While it runs: pause, +5 min, stop and keep the minutes, or **Done** to save and tick off the quest.
- **Timer alerts:** the first time you start a timer, the app asks to show notifications. On a computer you get an alert when the timer ends, even from another tab (it can arrive up to a minute late). On phones, the operating system pauses the app in the background, so without Notifications (above) the alert only comes when you reopen it; with them set up, the phone gets a real notification within a minute.
- **Keyboard shortcuts (computer):** `i` or `n` capture to the inbox (`n` on a quest's page adds a subquest), `t` today, `l` history (Review), `s` settings, `z` single-task, `p` pause/resume the timer, `Esc` back, `?` show these.
- Free Supabase projects pause after a week with no activity. Opening the app regularly keeps it awake. If it pauses, click **Restore** in the Supabase dashboard; your data is kept.

## Working on the code

The app is plain HTML, CSS and JavaScript with no build step: `index.html` loads `styles.css` and the scripts in `js/` in order (they share globals).

- `npm install` once (and `npx playwright install chromium` on a new machine; `python3` must be on the PATH, it serves the folder), then `npm test` runs the browser tests in `tests/` (Playwright, Chromium).
- `npm run format` tidies the code with Prettier.
- Every pull request and push to main runs the format check and tests on GitHub (`.github/workflows/test.yml`).
