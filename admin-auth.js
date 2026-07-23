import { app } from "./firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  deleteUser,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const ADMIN_UID = "5LM5VFGcQRU46C2XUWJmVma3Uco2";

const auth = getAuth(app);
const btn = document.getElementById("admin-trigger");

if (btn) {
  btn.addEventListener("click", async () => {
    if (auth.currentUser) {
      await signOut(auth);
      return;
    }
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      console.error(err);
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (user && user.uid !== ADMIN_UID) {
      try {
        await deleteUser(user);
      } catch (err) {
        await signOut(auth);
      }
      return;
    }
    btn.classList.toggle("is-signed-in", !!user);
    btn.title = user ? `로그인됨: ${user.email || user.uid}` : "";
  });
}
