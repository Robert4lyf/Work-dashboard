# Work Cockpit: setup

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

1. Create a free account at https://github.com and make a new **public** repository, e.g. `cockpit`.
2. Click **Add file > Upload files** and upload everything in this folder, keeping the `icons` and `.github` folders. Commit.
3. Go to **Settings > Pages**. Under *Build and deployment*, set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. The "Deploy to GitHub Pages" workflow runs on every upload to `main` (run it by hand the first time if it hasn't started).
5. After a minute your app is live at `https://YOUR-USERNAME.github.io/cockpit/`.

If you'd rather use **Deploy from a branch** (branch `main`, folder `/ (root)`), delete `.github/workflows/pages.yml`, otherwise that workflow fails on every upload.

## 4. Finish Supabase auth settings

1. In Supabase, open **Authentication > URL Configuration** and set **Site URL** to your GitHub Pages address.
2. Open the app, tap the **Sync off / Sign in to sync** button in the header, and choose **Create account**.
3. Confirm the email Supabase sends you, then sign in in the app.
4. Back in Supabase, open **Authentication > Sign In / Providers** and turn **off** "Allow new users to sign up". Only your account can then use your database.

## 5. Install it

- **iPhone:** open the link in Safari > Share > **Add to Home Screen**.
- **Android:** open in Chrome > menu > **Install app**.
- **Computer:** in Chrome or Edge, click the install icon at the right of the address bar.

Sign in once on each device. After that it opens like a normal app, works offline, and syncs when you're online.

## 6. Bring over your existing data

In the old claude.ai version: **Save backup**. In the new app: tap the sync button > **Restore backup** and choose that file.

## Updating the app later

Upload the changed files to the repository. The deploy workflow stamps a new `VERSION` in `sw.js` automatically, so installed copies pick up the update. Close and reopen the app twice to see it.

If you deploy from a branch instead of the workflow, change `VERSION` in `sw.js` by hand on each upload (e.g. `cockpit-v3`).

**Upgrading from the first version:** run the updated `supabase-setup.sql` once in the SQL Editor. It's safe to re-run and adds the server-side version history.

## How sync behaves

- Changes save instantly on the device and sync about a second later, and whenever the app is reopened.
- If you edit on two devices while both are offline, the most recent edit wins and the other device's offline changes are overwritten. Avoid editing the same day's list on two offline devices.
- Every time sync replaces your data, the server keeps the previous version (the newest 200). If something goes missing, open **Sync > Previous versions** and restore one.

## Features worth knowing

- **Voice capture:** tap the mic next to the inbox box and speak. Say "next item" between thoughts to add several at once (this also works when typing or using keyboard dictation). The mic shows in Chrome and Edge, and in Safari in a normal tab. It's hidden in the iPhone home-screen app, where Apple's speech recognition is unreliable, so use the keyboard's dictation key there. Chrome sends the audio to Google to transcribe.
- **Inbox subquests:** tap **Add subquests** on an inbox item to break it down before it goes to Today. They move with it.
- **Header:** shows your next step (tick it off right there, or tap to open it), today's progress, focus time, and anything overdue or due today. While a focus timer runs, it shows the countdown with a pause button on every tab.
- **History:** where your focus time went (week, month or year, by tag) and what you finished over the last two weeks. **Copy last 7 days** gives you a ready-made standup update.
- **Tags:** a tag belongs to a quest. Set it on the quest (Today) or inbox item (Tag and subquests); subquests and focus sessions use it. Add, rename or delete tags in Settings (the sync button).
- **Undo:** deleting a quest, clearing an inbox item, or deleting a template or tag shows an Undo button for 5 seconds.
- **Repeating quests:** open a quest and use **Repeat** to pick days (every day, weekdays, any mix) and/or a day of the month. A fresh copy, subquests included, is added to Today on those days, even if the app wasn't opened on the day itself. An unfinished copy carries over instead of doubling up. Choose **Off** to stop it. All repeats are listed under Today > Repeating quests.
- **Focus timer:** pick what you're working on (defaults to Next up) and a length. While it runs: pause, +5 min, stop and keep the minutes, or **Done** to save and tick off the quest.
- **Timer alerts:** the first time you start a timer, the app asks to show notifications. On a computer you get an alert when the timer ends, even from another tab (it can arrive up to a minute late). On phones, the operating system pauses the app in the background, so the alert only comes when you reopen it.
- **Keyboard shortcuts (computer):** `n` new quest, `i` capture to inbox, `t` today, `f` focus, `l` history, `p` pause/resume the timer, `Esc` back, `?` show these.
- Free Supabase projects pause after a week with no activity. Opening the app regularly keeps it awake. If it pauses, click **Restore** in the Supabase dashboard; your data is kept.
