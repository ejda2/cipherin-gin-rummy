// Firebase Auth (Google sign-in only) for Cipherin Gin Rummy.
//
// This file only handles who's signed in. It does not touch game.js or
// game state. Firestore-backed profiles and the adaptive opponent come
// in a later pass, once sign-in is confirmed working end to end.
//
// SETUP: replace firebaseConfig below with the values from your Firebase
// project (Project settings -> General -> Your apps -> SDK setup and
// configuration). These values are not secret; Firebase's security model
// relies on Firestore/Auth rules, not on hiding this config, so it's fine
// for it to live in a plain file shipped to the browser.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCuMTfRWEAffVZW0IwVtNdqFo4e8S_xsmE",
  authDomain: "cipherin-gin-rummy.firebaseapp.com",
  projectId: "cipherin-gin-rummy",
  storageBucket: "cipherin-gin-rummy.firebasestorage.app",
  messagingSenderId: "534874075464",
  appId: "1:534874075464:web:09bb36cdc51ff1a91a037d",
  measurementId: "G-G1LG34GNSD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const overlay = document.getElementById("auth-overlay");
const signInBtn = document.getElementById("google-signin-btn");
const authError = document.getElementById("auth-error");
const userBadge = document.getElementById("user-badge");
const userAvatar = document.getElementById("user-avatar");
const userName = document.getElementById("user-name");
const signOutBtn = document.getElementById("sign-out-btn");

signInBtn.addEventListener("click", () => {
  authError.textContent = "";
  signInBtn.disabled = true;
  signInWithPopup(auth, provider)
    .catch((err) => {
      console.error("Sign-in failed", err);
      authError.textContent = "Sign-in failed. Try again.";
    })
    .finally(() => {
      signInBtn.disabled = false;
    });
});

signOutBtn.addEventListener("click", () => {
  signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    overlay.classList.add("hidden");
    userBadge.classList.remove("hidden");
    userName.textContent = user.displayName || user.email || "Signed in";
    if (user.photoURL) {
      userAvatar.src = user.photoURL;
      userAvatar.classList.remove("hidden");
    } else {
      userAvatar.classList.add("hidden");
    }
    // Exposed for the next phase, when saved-player profiles move to
    // Firestore and get keyed off this uid instead of localStorage.
    window.currentUser = user;
  } else {
    overlay.classList.remove("hidden");
    userBadge.classList.add("hidden");
    window.currentUser = null;
  }
});
