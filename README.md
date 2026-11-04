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

In the old claude.ai version: **Save backup**. In the new app: open **Settings** > **Restore backup** and choose that file. Restoring replaces tasks, inbox, notes, alarms and history but keeps your notification keys, device names and any running timer.

## Updating the app later

Upload the changed files to the repository. The deploy workflow stamps a new `VERSION` in `sw.js` automatically, so installed copies pick up the update. Close and reopen the app once while online to see it.

If you deploy from a branch instead of the workflow, change `VERSION` in `sw.js` by hand on each upload (e.g. `dashboard-v5`).

**Upgrading:** whenever this file changes, run the updated `supabase-setup.sql` once in the SQL Editor. It's safe to re-run and only adds what's missing.

**Upgrading to per-item sync (item rows and live updates):** run the updated `supabase-setup.sql` first, then open the updated app on one device and let it sync; that device moves your data into the new table. Then open the app on your other devices. If live updates don't arrive, check **Database > Publications > supabase_realtime** in Supabase includes `cockpit_items`.

## Notifications (optional, one-time setup)

Real notifications, even with the app closed: when a focus session ends, on the morning a deadline or chase date is due, when an Upcoming task returns to Today, when an alarm rings, and for alerts from your scripts (below).

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

| Field        | Required | Meaning                                                                                                                                                                     |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`      | yes      | the capture token                                                                                                                                                           |
| `title`      | yes      | the notification title, and the item's name                                                                                                                                 |
| `body`       | no       | details: the notification text, and the item's notes                                                                                                                        |
| `to`         | no       | `inbox` (default): notification + Inbox item; `phone`: notification only; `today`: notification + a task on Today; `waiting`: notification + an Inbox item waiting on `who` |
| `who`, `due` | no       | for `waiting`: who you're waiting on, and when to chase (`yyyy-mm-dd`)                                                                                                      |

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

## Automation execution tracking (optional)

A flow's button can only ask Power Automate Desktop to run the flow: the app can't see whether it started, let alone finished. With tracking set up, the flow (or a PowerShell script) reports back, and each launch shows its real result: **Launched, no word yet**, **Running**, **Succeeded**, **Failed** (with the message), **Cancelled**, or **Unconfirmed** after a day of silence. A tap is never shown as a success.

1. Run the updated `supabase-setup.sql` once (it adds the execution tables and functions; nothing is changed or removed).
2. In the app: **Settings > Flows and automations > Create execution token**. Copy the **Report URL**, the **apikey** and the **token**, and note each flow's id (listed there and under Knowledge > Flows). Creating a token turns tracking on for the account: from then on every tap on a flow's button records a launch, on every device.
3. Make the flow (or script) report its status (below). Test it: tap the flow's button, then send a report by hand; the chip on Today and the row under Knowledge > Flows show the result within a few seconds.

**What the token can do:** add a status report for your account, at most 120 an hour (a `failed` report also queues the "Flow failed" notification, with the report's message). Nothing else: it can't read anything, and it can't change tasks, notes or articles. **New token** replaces it (the old one stops working at once); **Revoke** turns reporting off. The token is kept on the device that made it, like the capture token; other devices see tracking as on and can make a new one if they need to see it. Keep it in the flow's variables or the script, never in the repository.

**How a report finds its launch:** a report names the flow (`flow`) and, if the script knows it, the execution (`execution`). Without one, the server pairs the report with the newest launch of that flow still waiting to hear (tapped within the last 24 hours and not yet finished). A flow launched by its `ms-powerautomate:` link can't be given the execution id, so this pairing is the normal case: tap, then run, one at a time. Reports with the same `run_ref` (the script's own run id) always stay together. A report that matches no launch (the flow was started outside the app, or the app hadn't synced the tap yet) becomes an execution of its own, marked as reported by the flow rather than launched here. A result (succeeded, failed, cancelled) is final for a launch: a "running" arriving late never undoes it, and a later result replaces an earlier one. Reports arrive on every device through sync (and live within a second), folded in the same order everywhere, so the records agree.

**A failure** sends a notification (if notifications are set up), shows a **Flow failed** chip at the top of Today, and marks the flow's chip. Tap it for the reported message and what happened, then **Run again** (a deliberate tap; nothing is retried on its own), **Add to the Inbox** to look into it later, **Copy a summary** for whoever maintains the flow, or **Acknowledge** to clear the chip while keeping the record. Offline, every status is shown as last synced, and says so.

**Reporting from Power Automate Desktop**

Make one reusable subflow, `ReportStatus`, with input variables `Status` (text) and `Message` (text), and three flow variables set at the top of the main flow: `DashReportURL` (the Report URL), `DashKey` (the apikey) and `DashToken` (the token), plus `DashFlow` (this flow's id from Settings).

1. In `ReportStatus`: **Set variable** `Report` to `%{ 'token': DashToken, 'flow': DashFlow, 'status': Status, 'message': Message }%`, then **Convert custom object to JSON** into `ReportJson` (this copes with quotes and line breaks in a message).
2. **Invoke web service**: URL `%DashReportURL%`, method POST, accept and content type `application/json`, custom headers `apikey: %DashKey%`, request body `%ReportJson%`, "Encode request body" off. Set this action's own **On error** to continue: a network problem while reporting must never hide the flow's real outcome or stop the flow.
3. In the main flow: call `ReportStatus` with `running` and an empty message as the first action. Wrap the main steps in **On block error** that runs `ReportStatus` with `failed` and `%LastError.Message%` (use **Get last error** first) and then re-throws or stops the flow as it did before. After the last step, call `ReportStatus` with `succeeded` and a short message (a count, a file name; never the data itself).
4. If the flow is cancelled by hand, report `cancelled` from the cancel path where the flow has one; otherwise the launch shows as unconfirmed after a day, which is the honest state.

Keep messages short and plain: an error's text, a count. Report contents and personal information don't belong in a status.

**Reporting from PowerShell**

```powershell
$url = 'https://YOUR-PROJECT.supabase.co/rest/v1/rpc/cockpit_exec_report'
$key = 'YOUR-APIKEY'; $token = 'YOUR-EXEC-TOKEN'; $flow = 'YOUR-FLOW-ID'
$run = [guid]::NewGuid().ToString('N')  # keeps this run's reports together
function Report($status, $message = '') {
  try {
    Invoke-RestMethod -Method Post -Uri $url -Headers @{ apikey = $key } -ContentType 'application/json' `
      -Body (@{ token = $token; flow = $flow; status = $status; message = "$message"; run_ref = $run } | ConvertTo-Json) | Out-Null
  } catch { Write-Warning "Couldn't report $status to the Dashboard: $_" }  # never hides the real error
}
Report 'running'
try {
  # ... the work ...
  Report 'succeeded' 'Report sent, 3 files'
} catch {
  Report 'failed' $_.Exception.Message
  throw
}
```

The function answers `{"execution":"<id or empty>","event":<n>}`; an unknown or revoked token, a status other than running/succeeded/failed/cancelled, or more than 120 reports in an hour are refused with a message. For scripts the app itself starts, the same pairing applies: tap the flow's button in the app first (so the launch is recorded), then run the script.

## Deep links and Android shortcuts

A link with a route opens a place in the app: from a home-screen shortcut, a bookmark, Automate, Tasker, HTTP Shortcuts, or an NFC card through one of them. **Settings > Shortcuts and deep links** builds one for a chosen place and copies it. Opening a link only navigates: nothing is ticked, launched or sent, and a link can carry no secrets. (Two links do what their place does on arrival: `#/inbox/triage` begins the walk through the Inbox, and `#/kb/<id>/run` resumes the procedure's unfinished run or starts a fresh one, a small record of its own; neither changes a task or runs a flow.)

| Route                          | Opens                                                                    |
| ------------------------------ | ------------------------------------------------------------------------ |
| `#/today`                      | Today, with the Top 3                                                    |
| `#/continue`                   | the task with the newest saved place, else the one Next up is in         |
| `#/inbox` · `#/inbox/triage`   | the Inbox · Process inbox                                                |
| `#/q/<id>`                     | a task or step (on Upcoming it opens that list; in the Inbox, that item) |
| `#/kb/<id>` · `#/kb/<id>/run`  | an article · a procedure, started or resumed                             |
| `#/waiting` · `#/waiting/<id>` | the Waiting Centre · one item, marked                                    |
| `#/focus` · `#/review`         | the Focus tab (no session is started or changed) · the weekly review     |

The link works with the app open, from a fresh launch, from the installed app, and offline for anything already on the device. A target not on the device yet (made elsewhere, not synced) is looked for again after the first sync, then the app says so and opens the nearest list. A deleted or unknown target, or an id that isn't one, gets the same plain message. The route is cleared from the address once followed, so a reload or the back gesture doesn't replay it, and the back gesture steps back through the app as usual.

**Android.** HTTP Shortcuts: a shortcut of type "Open URL" (or a browser shortcut) with the link. Tasker: an action **Net > Browse URL** with the link; for an NFC card, a profile with the **NFC Tag** plugin (or Tasker's own NFC event on supported phones) running that task. Automate: an **NFC read** block (or any trigger) followed by **App start** with the link, or an **Open URL** block. The app itself can't read NFC: the automation app recognises the card and opens the link, and the installed app opens at that place. The home-screen app's long-press menu also offers **Capture**, **Process inbox** and **Continue work**. Nothing can run a flow or change work from a link: those take a tap in the app.

**Which link for what:** a deep link opens a place; the capture link (Settings > Advanced) adds an Inbox item or sends an alert from a script; the execution token (Settings > Flows and automations) reports a flow's status. Each does only its one thing.

## Suggest steps with AI (optional)

A **Suggest steps (AI)** link on a task's page asks Claude for a few next steps, offered as a list to tick; only the ticked ones are added. It sends the task's name and its steps' names, and nothing else (no notes, other tasks, or anything from Knowledge). The first time on each device it says so and asks before sending. Check your organisation allows this for work information before turning it on.

It only shows while you're signed in to sync, and needs a small Supabase function that holds the API key, so the key never reaches the app:

1. At https://console.anthropic.com create an account (separate from a Claude subscription), add some credit, and create an API key. It uses the small, fast model (Claude Haiku 5.5): each suggestion costs a fraction of a penny.
2. In Supabase, open **Edge Functions**, choose **Deploy a new function > Via Editor**, name it `suggest-steps`, and paste in the whole of `supabase/functions/suggest-steps/index.ts` (it's the only file). Leave **"Enforce JWT verification" on**: only signed-in users of your project get an answer. With the Supabase CLI: `supabase functions deploy suggest-steps`.
3. In **Edge Functions > Secrets**, add `ANTHROPIC_API_KEY` with the key from step 1. Never put the key in `config.js` or anywhere in this repository: it's public.

If it says it couldn't get suggestions, the function's **Logs** in Supabase show why (a missing or wrong key, or no credit left).

### Summarise with AI

The same function also writes summaries. On a task's page, under its name, is an optional **Summary and updates** box that you write yourself; it shows under the task's name on Today. **Summarise (AI)** beside it asks Claude for a short plain-English summary of what's been done, offered as a draft: you choose whether to use it instead of yours, add it below yours, or cancel. It sends the task's name, its steps (which are ticked or waiting, and on whom) and its summary, and nothing else; the first time on each device it says so and asks before sending.

If you set up the function before summaries were added, paste the updated `supabase/functions/suggest-steps/index.ts` over it once (**Edge Functions > suggest-steps > Code**, then **Deploy**). Until then, Summarise says it couldn't get a summary.

## How sync behaves

- Each task, inbox item, focus session and so on is stored as its own row, so devices only exchange what changed. Changes save instantly on the device, sync about a second later, and reach your other open devices within a second or two (live updates).
- Edits on two devices at the same time (or offline) are all kept, as long as they're to different items. If the _same_ task was changed on both, the newer edit wins. Focus time from every device adds up.
- Follow-ups on waiting items, procedure runs and flow executions are rows of their own (`follow:`, `run:`, `exec:`), appended rather than edited, so two devices adding one each keep both and a task's row stays small. Flow status reports live in a separate append-only table (`cockpit_exec_events`) written only by the report function; each device pulls them and folds them into the execution records in the same order, so the records agree.
- A task's resources and saved place are part of its row, so they sync with it (and the newer edit of the task wins, as for any other change to it). The Top 3 is a record of its own (`meta:top3`), and its set-aside choices another (`meta:top3held`, so a copy of the app from before them leaves them alone): choosing on two devices at once, the newer choice wins; clearing it deletes the records. The day's reset clears a Top 3 from an earlier day as of midnight, so a choice already made today on another device still wins. No database changes are needed for any of this: the rows are the same table, and the new fields are ignored by older copies of the app and kept as they are.
- A copy of everything is saved on the server every few hours (the newest 200 are kept). If something goes missing, open **Settings > Previous versions** and restore one.

## Features worth knowing

- **One way in:** new work always starts in the Inbox (typed, spoken, shared or captured from anywhere). Today only holds what you've chosen from it: tap **Today** on an inbox item, or set its waiting details or a later date first. Steps are still added on a task's page.
- **Tabs:** Today, Inbox, Knowledge (Reference and Processes), Review (Week, Forecast, Insights, History) and Settings. Waiting opens from the **to chase** chip on Today (Inbox and Upcoming items you're waiting on also fold under Today's list); the notes are the **Scratchpad** tile at the top of Knowledge. Focus opens from the header (tap the focus time once there is some, **Single-task**, or **Focus on this** on a task).
- **Header:** the next step with its tick on up to two lines (cut short if longer; tap it for the whole step), and under it **Focus**, a search icon and a sync dot. Finished tasks fold away under **Done today** (open it to un-tick one). The ⋯ on a row opens its quick actions (below). Rows show just the tag, what's waiting or due, a **Saved place** mark if you've saved one, and the next step.
- **Quick actions (⋯):** every task row, board tile and step has a ⋯ that opens a small sheet of just the actions that fit it right now: Open, Focus on its next step (or Resume work / Resume focus), Add to or Remove from Top 3, Save my place, Mark done / Finish task / Reopen, Do tomorrow, Do next week, Move to Inbox, Delete (with Undo). The same sheet opens from the ⋯ at the foot of a task's page. Escape, the back gesture or the backdrop close it; the keyboard goes back to the ⋯ that opened it.
- **Top 3:** at the top of Today, **Pick your Top 3** (or **Change**) opens a picker of Today's open quests: tap up to three, most important first, and move them up or down. They show in a small box with their progress and a Focus (or Resume) button; the list underneath keeps its own order and Next up is still its first open step. A finished one shows as done; one moved to Upcoming or the Inbox drops out (and comes back if it returns the same day). One that becomes scheduled, or has nothing left to do but wait, is **set aside**: still chosen, but it doesn't hold one of the three places, so you can choose another. When it can be worked on again it takes a free place by itself; if all three are taken, nothing is pushed out: Top 3 says it can be worked on again, with **Bring back** (the picker opens to make room). The picker lists set-aside choices with **Take out**. The choice is for the calendar day: a new day starts with none chosen, and yesterday's is never carried over. It syncs as one small record; if two devices choose at once the newer choice wins, and the tasks themselves are never changed.
- **Tasks and steps:** a task is the title of a piece of work; its steps are the actions. A task with no steps is still an action of its own (tick it, or focus on it). Steps don't have steps of their own: ones from before moved up beside their step, named with it ("Contract: Draft"). Waiting is always on a step: see **Waiting** below.
- **A task's page (its workspace):** its title and progress, then **Next**: the first step still to do (or that every step is ticked, or that it's waiting). If you saved your place, **Where you left off** shows the note, when, and the step it was on (**Edit the note**, **Clear**). Then the summary, its tag (folded to the one it has: tap to change), **Waiting on someone?**, **Resources** (below), its steps and an add box. Everything else is under **More**: notes and deadline, do later, repeat, move to inbox, delete. At the bottom of the screen, always to hand: the one thing to do next, which follows the task's state (**Focus: _step_**, **Resume work**, **Resume focus**, **Finish task**, **Review waiting**, **Reopen task**), **Mark done** beside Focus for a task without steps, and ⋯ for the rest. A step's page is the same without tag, steps, do later or repeat (it has **Optional** under More) and shows the task's resources to use.
- **Resources:** on a task's page, link what the work needs: **+ Article** (a Knowledge article, picked from a list, searchable), **+ Flow** (a Power Automate Desktop flow; it runs only when tapped, never on opening the task) and **+ Web link** (http(s) only, with an optional name; anything else is refused). Articles and flows are linked by id, not copied: a renamed article keeps its link, a deleted one shows as "Removed" until you unlink it (and comes back if the article does). The article's **‹** takes you back to the task. Resources travel with the task to the Inbox or Upcoming and back, and a repeating task's fresh copies have them too. Up to 20 per task.
- **Save my place (interruptions):** when you have to stop, **Save my place** (a task's or step's ⋯, the foot of its page, single-task mode, or the Focus tab) asks "Where did you stop, and what should you do next?" and keeps the note with the task, with the time and the step you were on. From a running session it's **Pause and save my place**: the timer pauses first, and its minutes are kept as for any pause (nothing is logged twice). Without a session it just saves the note. The task's row on Today gets a quiet **Saved place** mark; its page and single-task mode show the note; search finds it. **Resume work** (its page, its ⋯, or the Top 3) opens single-task mode on that step with the note in view (if that step was ticked since, on the next one). The place stays until you clear it, save a new one (one per task), or finish the task; it travels with the task to the Inbox or Upcoming and back, and goes with it if it's deleted (Undo brings both back). A repeating task's fresh copy never gets last time's.
- **Scratchpad (Knowledge > Scratchpad):** one free-text space, saved as you type and synced to your other devices. Handy for moving a phone number or a link from one device to another. Pictures can be pasted into the notes (or added from a file): they're shrunk to at most 1600 pixels across, shown below the text, and synced too. All of the app's data is kept in the browser's database (IndexedDB), pictures one by one and everything else as one saved copy, with room for far more than the old storage (pictures can take up to about 22 MB); the app asks the phone to keep its storage, so it isn't cleared when space runs low. Data saved by an earlier version moves over on the first run. An article holds up to 30 pictures and 50,000 characters. Tap one to see it full size.
- **Search:** the search icon in the header (or the / key) searches everything at once: tasks and their steps (notes and waiting details too), Upcoming, the Inbox, Notes, Knowledge articles, flows and what you've finished. Tap a result to go to it.
- **Back gesture (Android):** steps back through the app (a picture shown full size, an article, the article editor, a task's page, other tabs back to Today) and only leaves the app from Today's list. An article being written is kept if you leave the app, and comes back if it was closed before you saved.
- **Guides (Knowledge > Reference, listed under Processes too):** an article can hold ordered steps, each with notes and, optionally, an article to open, a flow to run, a web link, and whether the result needs checking: add them in the article's editor (**Add step**, move up and down, tap one to edit). The article reads as before, with its steps listed; **Start** follows it one step at a time (**Done, next**, **Back**, tap a step to jump), with each step's action a tap away: a flow runs only when its button is tapped, and tapping Run never ticks the step. Each time through is a run of its own with its own ticks (the article is the definition; **Start afresh** leaves an unfinished run behind); an unfinished run is resumed with **Resume**, and finished ones are listed under **Previous runs** for a while. A task that links a procedure (Resources) shows how far its run has got and starts or resumes it from there, with **Back to the task** at the end; finishing a procedure never finishes the task.
- **Waiting Centre:** opens from Today's "to chase" chip or **Also waiting on others**. Every waiting item, grouped by urgency (**To chase**: overdue or today, or a promised reply overdue; **Due soon**; **Reply promised**; **Chased recently**; **Chase later**; **No chase date**) or by **Person**. A waiting item keeps who, what for, when asked, the chase date, and optionally when a reply was promised and when it was last chased; its ⋯ offers **Record a follow-up** (a note and the next chase date), **Response received**, **Change the next chase date**, **Copy a follow-up message** (a short, editable message with the ask and the latest follow-up) and Open. Follow-ups are kept as a short history on the step's page ("Followed up 3 Nov: emailed Sam"; asked, reply promised, resolved, reopened), and **Got it** resolves the item (the step is back on your list; **Set waiting** again reopens it, history kept). People are grouped by the name as typed: use "Sam (Finance)" and "Sam (Legal)" to keep two Sams apart. The weekly review's Waiting step puts what's overdue to chase and promised replies that slipped first, with **Follow up** on each.
- **Knowledge:** reference articles (step-by-step guides, who manages what, links to tools) filed in categories and sub-categories, shown as tiles with counts: open one for its sub-categories, articles and actions (**+ Article**, **+ Sub-category**, **Rename**, **Move**, **Delete**). Search looks through every article. Web links in an article are clickable. Articles can have pictures (paste a screenshot into the article while writing it, or use **Add picture**). Naming and renaming use a small sheet at the bottom of the screen.
- **Desktop automations:** one button per Power Automate Desktop flow, folded at the foot of Today and listed under Knowledge > Processes (**Manage automations** to add one with its Run URL: in Power Automate Desktop, the flow's Properties, then Details). A chip runs the flow on the computer it's tapped on, which needs Power Automate Desktop installed; it may ask you to confirm each run. Each chip shows when it was last tapped; with tracking set up (Settings > Automation result tracking, and "Automation execution tracking" above) it also shows the last reported result, and Knowledge > Processes has each automation's latest result with **Details** and **History**.
- **Alarms (folded at the foot of Today; the header's alarm opens them):** **+ Alarm**, set the time and an optional label, and switch it **On**. Several can be on at once, and the header shows the next one. When one goes off it rings until you **Dismiss** it (or **Snooze 5 min**):
  - with the app open on that device, it shows a full-screen alarm and keeps sounding (browsers only allow sound once the app has been tapped since it was opened, so tap it once after opening);
  - otherwise it sends a notification that sounds and vibrates again every minute for 10 minutes (it needs notifications set up, above; Android's silent or Do Not Disturb modes can still mute it).

  Once a second device has signed in, choose which device rings (**Any device**, or one by name; name each device in **Settings > Appearance**). Alarms are for the current day: overnight they all switch off but stay listed, ready to edit or switch on again. Re-run `supabase-setup.sql` and redeploy `send-notices` so a device-specific alarm rings only on that device. After this update, reload the app on every device: a copy from before it still open somewhere doesn't know about notes and alarms and could remove them when it syncs.

- **Inbox steps:** tap an inbox item's title to open it, then add steps to break it down before it goes to Today; they move with it.
- **Process inbox (triage):** **Process inbox** at the top of the Inbox shows its items one at a time, each with its notes and steps, and six decisions: **Today** (a task, details kept), **Later** (Tomorrow, Next Mon or a date, as Do later), **Waiting** (who, and when to chase; the item stays in the Inbox, waiting), **Reference** (opens Knowledge's editor with the title, notes and steps filled in; the item leaves the Inbox only once the article is saved, Undo puts it back; Cancel or the back gesture returns to the item untouched), **Delete** (with Undo) and **Skip** (leave it, go on). "3 of 8 processed" keeps count; at the end, the skipped ones can be gone through again. The Inbox itself is unchanged: triage is optional, **Exit** or the back gesture leaves it, and so does switching tabs (except to write the article). An item moved on another device meanwhile simply drops out of the walk; one captured meanwhile joins it.
- **Weekly review:** Review > Week walks through the week one step at a time (Back and Next): empty the Inbox, decide on carried-over tasks, chase what you're waiting on, what's coming up, and what you finished this calendar week, Monday to Sunday (with **Copy summary** for an update). From Friday until you tap **Mark week reviewed**, a **Weekly review** chip appears at the top of Today (and a dot on the Review tab).
- **Health check:** Settings > Health check tests the setup against your Supabase project (sync table, live updates, notifications, offline) and says what to fix for anything that isn't working.
- **Voice capture:** tap the mic next to the inbox box and speak. Say "next item" between thoughts to add several at once (this also works when typing or using keyboard dictation). The mic shows in Chrome and Edge. Chrome sends the audio to Google to transcribe.
- **Header:** your next step (tick it off, tap to open it, or **Focus** to start single-task mode), today's progress and focus time. While a focus timer runs, it shows the countdown with a pause button. Anything needing attention (overdue, due today, to chase, weekly review) shows at the top of Today instead.
- **History (Review > History):** where your focus time went (week, month or year, by tag) and what you finished over the last two weeks. **Copy last 7 days** gives you a ready-made standup update.
- **Tags:** a tag belongs to a task. Set it on the task's page (Today); steps and focus sessions use it. Add, rename or delete tags in the Settings tab.
- **Undo:** deleting a task, clearing an inbox item, or deleting a tag shows an Undo button for 5 seconds.
- **Upcoming:** on a task (under More), use **Do later** (Tomorrow, Next Mon, or a date) to move it off Today. It waits under Today > Upcoming, where you can change the date or bring it back, and joins the end of Today's list on its day.
- **Capture from anywhere:** in Settings > Capture from anywhere, create a private capture link (60 captures an hour, up to 20,000 characters each), then follow the steps for Android's HTTP Shortcuts app. On a computer, drag the **+ Dashboard** bookmarklet to your bookmarks bar to send the page you're on. Long-pressing the installed app's icon also offers **Capture**.
- **Share to Inbox (Android):** once the app is installed, choose it from any app's Share menu to drop a link or text straight into the inbox.
- **Repeating quests:** open a task and use **Repeat** to pick days (every day, weekdays, any mix) and/or a day of the month. A fresh copy, steps included, is added to Today on those days, even if the app wasn't opened on the day itself. An unfinished copy carries over instead of doubling up. Choose **Off** to stop it. All repeats are listed under Today > Repeating tasks.
- **Single-task mode:** starting a focus session opens a full-screen view of just your current step and the timer (pause, +5 min, stop and save, Done, discard). While the timer runs you stay there: the tabs and shortcuts come back when you pause. Resuming, or reopening the app mid-session, goes straight back in. You can also open it any time with **Single-task** in the header or `z`. When the time runs out it asks what next: **Done** (ticks the step off), **+5 min** or **+15 min** (carry on), or **Stop for now**.
- **Carried over:** each task on Today remembers when it arrived. After 3 days a folded "N tasks carried over" line at the top of Today (open it) lets you decide on each: **Keep** (asks again tomorrow), **Tomorrow**, **Next week**, **Inbox** or **Drop**.
- **Waiting:** a step waits, never the task itself. On a task's page, **Waiting on someone?** adds a step named by "For what" (or "Hear back") that waits on who you say, with an optional date to chase; on a step's page it sets that step waiting. The task shows "Waiting on …" on Today, and the waiting step isn't Next up. (Tasks set waiting before this, and Inbox items moved to Today while waiting, get such a step automatically.) The Waiting page (from the "to chase" chip on Today, or Today's "Also waiting on others" section) lists everything you're waiting on, lets you add a new one (it lands in the Inbox, already waiting), and **Got it** puts it back on your list. Chase dates put a "to chase" chip at the top of Today, and get a 9am notification. A task with a waiting step shows as waiting too ("Waiting on Sam"); its other steps carry on. Tasks with waiting steps sit at the bottom of Today (above finished ones) and move back to their place when the wait is over.
- **Desktop:** Today and Inbox are separate pages, as on a phone. On a wide screen you can drag tasks within Today to reorder them.
- **Appearance:** Settings > Appearance offers the pixel font or a plain one, and light, dark or matching your system. It's saved per device.
- **Focus timer:** pick what you're working on (defaults to Next up) and a length. While it runs: pause, +5 min, stop and keep the minutes, or **Done** to save and tick off the task.
- **Timer alerts:** the first time you start a timer, the app asks to show notifications. On a computer you get an alert when the timer ends, even from another tab (it can arrive up to a minute late). On phones, the operating system pauses the app in the background, so without Notifications (above) the alert only comes when you reopen it; with them set up, the phone gets a real notification within a minute.
- **Keyboard shortcuts (computer):** `i` or `n` capture to the inbox (`n` on a task's page adds a step), `t` today, `o` Command Centre, `l` history (Review), `s` settings, `z` single-task, `p` pause/resume the timer, `Esc` back, `?` show these.
- Free Supabase projects pause after a week with no activity. Opening the app regularly keeps it awake. If it pauses, click **Restore** in the Supabase dashboard; your data is kept.

## Processes, rules, forecast, insights and the Command Centre

Everything in this section runs in the app itself, from its own records; nothing needs a database change, a server, or any new service. Reload the app on every device after updating.

### The words the app uses

| On screen                | What it is underneath                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| **Task**, with **steps** | a quest and its subquests (records unchanged)                                                |
| **Process**              | a workflow definition; its **steps** are the workflow's stages; a run of it is "in progress" |
| **Guide**                | a reference article with steps you can follow one at a time (a Knowledge procedure)          |
| **Desktop automation**   | a Power Automate Desktop flow, launched by a deliberate tap                                  |
| **Automation attempt**   | one launch of a desktop automation and the result it reported (an execution)                 |
| **Rule**                 | when this happens, do one thing                                                              |

Records, ids, sync rows, deep links (`#/q/…`, `#/kb/…`, `#/workflows`, `#/wrun/…`, `#/ops`) and backups are exactly as before: only the words on screen changed.

### Knowledge: Reference and Processes

The Knowledge tab shows one of two views. **Reference** is what you read: the scratchpad, search, categories and articles (an article with steps is a guide, and reads the same). **Processes** is what you follow, run or repeat: **In progress** (process runs and guides under way, each with Continue, or Fix for a failed run), the **Processes** you've made, the **Guides** (the same articles, listed here because they're followed, never copied), and the **Desktop automations**. **+ New** at the top asks what you need to do: finish something (a task: it goes to the Inbox, to sort as everything captured does), do something again and again (a process), keep information (an article; add steps to make it a guide), or launch a desktop automation. Search results say what each thing is and what tapping does (Article · read, Guide · follow, Process · start or continue, Desktop automation).

### Processes (Knowledge > Processes)

A process is a checklist you can run again. **+ New process** offers five worked examples (Simple checklist, Weekly report, Approval process, Automation with a check, Month-end process), each previewed before you use it, or **From scratch**. In the editor, type the steps one line at a time (Enter adds one); every step is a plain one until you tap it and choose what happens at it: **Plain step** (you do it, then mark it done), **Run a desktop automation** (launched when you tap, as everywhere; with result tracking on, the step completes when it reports), **Follow a guide** (finishing the guide completes the step), **Check the result** (a checklist to tick), **Wait for someone** (a waiting item in the Inbox and the Waiting Centre; the reply completes the step), **Decide what happens next** (choices, each able to jump to a later step). A step can be marked as skippable (with a reason). **Add with options** opens that sheet for a new step. Repeat (weekdays and/or a day of the month) is folded at the end: on its days a run is made **ready**, never started on its own.

Opening a process shows its **overview**: what it's for, where it stands (Not started, In progress, Your turn, Waiting for the automation, Waiting on someone, Paused, Failed, Completed), one button (**Start**, **Continue** or **Fix the failed step**), its steps, its past runs, and, a step further, **Edit the steps**, **Duplicate** and **Archive**. Saving a changed definition is a new version; a run keeps its own copy of the steps it started with.

**A run** shows the current step with what to do, what the app is waiting for and what moving on means, and the one action: **Mark done**, **Verified** (every check ticked first), **Mark reply received**, a choice, **Follow the guide**, or **Launch** for an automation (the step completes when the result is reported; with tracking off, or no word for a day, you confirm it by hand and the run says so). **Report a problem** or **Check failed** fails the step; a failed run offers **Try again** (a fresh attempt; an automation step asks first, since the last launch may have done its work), **Skip** (where allowed, with a reason), **Cancel the run**, **Acknowledge** and **Add to the Inbox**. Pause, Cancel and Copy summary are a line below; **What happened** is the log. Back from a run returns to where it was opened: the overview, Today or the Command Centre.

### Rules (Settings > Rules)

A rule is one sentence: when this happens, do one thing. **Add rule** offers five starters (when a process fails, add an Inbox item; when an automation fails, flag it in the Inbox; when a reply arrives, add the next step to the Inbox; when a recurring process is due, add a task for it to Today; when a chase date comes, add a reminder to the Inbox) or **From scratch**. The editor reads the rule back as a sentence, says under the trigger when it can actually run, and **Preview on recent records** says what it would have made for the last 30 days' records, making nothing. The list shows each rule's trigger, action, when it runs, whether it's on, and its last result; the log is folded below.

How rules run: on the device where the thing happens, while Work Dashboard is open. Nothing runs in the background or on a server. Day-of-week and chase-date rules check when the app is first opened that day; a day it isn't opened is skipped. Rules that must run with every device closed would need a Supabase cron or edge function, which is not included. What a rule makes is named from the rule and the event, so two devices seeing the same event make one thing; things a rule made never trigger a rule; each rule fires at most 20 times a day and all rules 60.

### Forecast (Review > Forecast)

The headline says four things apart: **estimated work**, **capacity** (marked assumed until you set it), **days overloaded**, and **tasks not estimated**, with a coverage line underneath: _all relevant work is estimated_, _some work is unestimated_ (a quarter or fewer of the tasks in view), or _much of the forecast is incomplete_ (more than a quarter), plus _capacity uses assumed defaults_ when it does. Unestimated work is counted but not planned: it is never spare capacity. Tap a day on the radar (7 or 14 days; at 30 days, pick it from the list) for what's estimated on it, what's due that day, its capacity and what isn't counted. Recommendations are a line each, with the reason a line below: an overloaded day and what could move (after its due date, said so), tasks without estimates, assumed capacity. A move is a button that asks first. **How this forecast works** is folded at the end and documents the allocation and the coverage classes.

**Estimates:** the **+ Estimate** chip on a task's or step's page; a task's estimate is its steps' when any step has one. **Capacity:** minutes per weekday, under **Capacity per weekday**. **Estimates against focus time** compares finished tasks' estimates with the timer's focus time.

### Insights (Review > Insights)

**What stands out** first: at most three findings, each picked by a fixed rule with a bar to clear, with its evidence and a way in: a desktop automation failing repeatedly (two or more verified failures, no more successes than failures), a process step that failed in two or more runs, runs with no movement for three days, three or more overdue tasks, an item chased three times and still open, two or more launches that never reported, estimates off by half over five or more finished tasks, and a change of a third or more in tasks finished with five or more in each period. Then **Key numbers** (tasks finished, timer focus time, process runs completed of started, automation attempts verified ok), **Trends** (tasks finished and focus time by day; tap a bar for its number; **As a table** lists the days), **Details** (the full sentences, which the text export carries) and the exports (**Copy as text**, **Save CSV**: counts only). With fewer than two recorded things in the period the page says what it can measure instead of showing empty sections.

### Command Centre

One page for the operator: from the **Command Centre** link at the top of Today, the `o` key, or the `#/ops` deep link (an NFC card or shortcut can open it; opening runs nothing). **Needs attention** (the same list Today summarises): failed processes and automations, overdue and due-today tasks, waiting items to chase, processes ready to start, launches with no word, a full Inbox, the weekly review. **In progress:** process runs with their step, guides under way, automations awaiting a result, tasks with a saved place. **Quick launch:** pins (a process, a guide, a desktop automation, a task or a page; **Reorder**, unpin). **Recent results**, **Coming up** (the next days' load against capacity, what's due, what repeats, what's to chase), and the **Morning** and **End-of-day checklists**, which are lists of things to open: nothing happens on its own. The line under the title says how fresh the records are.

### Sync notes

Processes (`workflow:`), runs (`wrun:`), rules (`rule:`) and the rule log (`rlog:`) are rows of their own; capacity (`meta:cap`) and pins (`meta:pins`) are single records that exist only once set. A device on a previous version leaves rows it doesn't know alone, and keeps a task's estimate as data it doesn't understand. Run outcomes are deterministic from the records. There is no new SQL.

## Working on the code

The app is plain HTML, CSS and JavaScript with no build step: `index.html` loads `styles.css` and the scripts in `js/` in order (they share globals).

- `npm install` once (and `npx playwright install chromium` on a new machine; `python3` must be on the PATH, it serves the folder), then `npm test` runs the browser tests in `tests/` (Playwright, Chromium).
- `npm run format` tidies the code with Prettier.
- Every pull request and push to main runs the format check and tests on GitHub (`.github/workflows/test.yml`).
