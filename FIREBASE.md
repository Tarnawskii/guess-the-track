# Firebase: public room lobby

Public rooms ("🌍 List this room publicly" / "🌍 Find") can use a Firebase Realtime Database
instead of the PeerJS lobby slots. Rooms then show up instantly, update live, and vanish by
themselves when the host closes the tab. Game traffic itself still goes over PeerJS.

Leave `FIREBASE` in `index.html` blank and everything keeps working on the PeerJS lobby.

## Setup

1. Create a project at <https://console.firebase.google.com> (Analytics not needed).
2. **Build → Realtime Database → Create database.** Any location, start in *locked mode*.
3. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
   Hosts sign in anonymously so only they can edit or delete their own listing.
   People browsing the lobby don't sign in.
4. **Project settings → Your apps → Web (`</>`)** and register an app. Copy the config into
   `FIREBASE` near the top of `index.html`:

   ```js
   const FIREBASE = window.GTT_FIREBASE || {
     apiKey: "AIza…",
     authDomain: "your-project.firebaseapp.com",
     databaseURL: "https://your-project-default-rtdb.europe-west1.firebasedatabase.app",
     projectId: "your-project",
     appId: "1:…:web:…",
   };
   ```

   It's fine to commit these values: the API key only identifies the project, and the rules
   below decide what anyone can read or write.
5. Deploy the rules from `database.rules.json`, either by pasting them into
   **Realtime Database → Rules**, or with the CLI:

   ```sh
   npx firebase-tools login
   npx firebase-tools deploy --only database --project your-project
   ```

## What's stored

`rooms/<CODE>`: `{ uid, name, imode, jam?, players, full, at }`. That's the same info the PeerJS
lobby already shared. The rules allow only that shape, cap the sizes, and let only the
host who created the entry change or delete it.
