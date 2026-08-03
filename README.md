# Cipherin Gin Rummy (with Google sign-in)

This is a separate project from the original app. It's the same game,
plus Firebase Authentication gating access behind a Google sign-in
screen. The original repo/deployment is untouched.

## What's new here vs. the original

- `firebase-init.js` — handles Google sign-in/out and shows or hides
  the game behind an overlay based on auth state. Nothing else in the
  game changed: `game.js` is identical to the original.
- `index.html` — added the sign-in overlay markup and a small user
  badge (avatar, name, sign-out button) in the header.
- `style.css` — added styling for the overlay and user badge only.

Saved players and stats now live in **Firestore**, not this browser's
local storage. Each signed-in user gets one document, keyed by their
Google account's uid, holding their saved players and stats:

```
users/{uid}
  profiles: [ { id, name, gender, style, skill, stats: {...} }, ... ]
```

That's the same array shape the app always used for saved players, it's
just stored under your account instead of pinned to one browser, so it
follows you across devices.

## Firestore setup (one-time, in addition to the Auth setup above)

1. In the Firebase console, go to **Build → Firestore Database** (or
   under **Databases & Storage**, depending on which console layout
   you're seeing) and click **Create database**.
2. Choose a location close to you (this can't be changed later, but it
   doesn't meaningfully affect a small app like this).
3. Start in **production mode**, not test mode. Test mode leaves the
   database wide open to anyone for 30 days, which isn't something you
   want even temporarily for an app with sign-in.
4. Once the database exists, go to the **Rules** tab and replace the
   default rules with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```

   This locks every user's document to that same user, nobody can read
   or write anyone else's saved players, even other signed-in users of
   this app. Click **Publish**.

## Firebase console setup (one-time)

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   and create a new project (or reuse an existing one, e.g. your P10
   project, if you'd rather keep everything under one Firebase project).
2. In the project, go to **Build → Authentication → Get started**.
3. Under **Sign-in method**, enable **Google** as a provider. Pick a
   support email when prompted.
4. Go to **Project settings** (gear icon) → **General** → scroll to
   **Your apps** → click the **</>** (web) icon to register a new web
   app. Give it any nickname (e.g. "gin-rummy-web").
5. Firebase will show you a `firebaseConfig` object. Copy those values
   into `firebase-init.js`, replacing the placeholder `YOUR_...` strings.
6. Still in Authentication, go to **Settings → Authorized domains** and
   add your Vercel domain once you have it (e.g.
   `your-project.vercel.app`). `localhost` is included by default, so
   local testing works without this step.

These config values aren't secret. Firebase's security model is
enforced by Auth and Firestore rules, not by hiding this file, so it's
fine for it to sit in the repo as plain text.

## Run it locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000`. Google sign-in will work here since
`localhost` is an authorized domain by default.

## Deploy to Vercel via GitHub

1. Create a **new** GitHub repository (separate from the original
   game's repo) and push these files:

   ```bash
   git init
   git add .
   git commit -m "Gin Rummy with Google sign-in"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<new-repo>.git
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com) → **Add New → Project** →
   import the new repository.
3. Framework preset: **Other** (no build command, no output directory,
   this is still a static site).
4. Click **Deploy**.
5. Once deployed, copy the resulting `.vercel.app` URL and add it to
   Firebase's **Authorized domains** list (step 6 above), or Google
   sign-in will fail on the live site with an unauthorized-domain error.

## What's next

Once sign-in is confirmed working end to end (sign in, see your name
in the header, sign out, sign back in), the next phase moves saved
player profiles from `localStorage` into Firestore under
`users/{uid}/profiles/{profileId}`, so your saved opponents and stats
follow you across devices. After that, the adaptive opponent logic
(tracking your tendencies across games, not just within one match)
builds on top of that same Firestore data.
