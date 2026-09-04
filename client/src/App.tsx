import { customAlphabet } from "nanoid";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Editor from "./Editor";
import "./assets/App.css";

// https://zelark.github.io/nano-id-cc — 5 chars is short enough to read out loud.
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const nanoid = customAlphabet(alphabet, 5);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to={`/${nanoid()}`} replace />} />
        <Route path="/:id" element={<Editor />} />
      </Routes>
    </BrowserRouter>
  );
}
