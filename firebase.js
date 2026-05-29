import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBR3pzideEWqHgqO2X3vcaDFg5QCRLD14A",
  authDomain: "dibujo-f59fd.firebaseapp.com",
  projectId: "dibujo-f59fd",
  storageBucket: "dibujo-f59fd.firebasestorage.app",
  messagingSenderId: "117236676246",
  appId: "1:117236676246:web:3995df20c1599bc31d74b7",
  measurementId: "G-WC92M26XTS",
  databaseURL: "https://dibujo-f59fd-default-rtdb.firebaseio.com"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
