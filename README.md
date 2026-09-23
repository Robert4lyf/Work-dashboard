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
2. Click **Add file > Upload files** and upload everything in this folder, keeping the `icons` folder. Commit.
3. Go to **Settings > Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
4. After a minute your app is live at `https://YOUR-USERNAME.github.io/cockpit/`.

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

Upload the changed files to the repository, and change `VERSION` in `sw.js` (e.g. `cockpit-v2`) so installed copies pick up the update. Close and reopen the app twice to see it.

## How sync behaves

- Changes save instantly on the device and sync about a second later, and whenever the app is reopened.
- If you edit on two devices while both are offline, the most recent edit wins and the other device's offline changes are overwritten. Avoid editing the same day's list on two offline devices.
- Free Supabase projects pause after a week with no activity. Opening the app regularly keeps it awake. If it pauses, click **Restore** in the Supabase dashboard; your data is kept.
