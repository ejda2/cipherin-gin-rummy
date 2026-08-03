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

Saved players and stats still live in this browser's local storage for
now, same as the original. That moves to Firestore (synced per signed-in
user, across devices) in the next phase, once sign-in itself is
confirmed working.

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
