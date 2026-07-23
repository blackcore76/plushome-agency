import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

const firebaseConfig = {
  projectId: "plushome-agency",
  appId: "1:400823886638:web:ca85dec4b175d646af10bf",
  storageBucket: "plushome-agency.firebasestorage.app",
  apiKey: "AIzaSyAfRO9dpUTn26lp7Xn31NBHWLX_qNoO8LE",
  authDomain: "plushome-agency.firebaseapp.com",
  messagingSenderId: "400823886638",
};

export const app = initializeApp(firebaseConfig);
