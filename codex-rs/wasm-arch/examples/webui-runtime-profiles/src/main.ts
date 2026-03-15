import { mount } from "svelte";

import "./app.css";
import App from "./App.svelte";

(window as typeof window & { __webuiEntryResolved?: boolean }).__webuiEntryResolved = true;

const target = document.getElementById("app");

if (target === null) {
  throw new Error("Missing #app mount target");
}

target.replaceChildren();

const app = mount(App, {
  target,
});

export default app;
