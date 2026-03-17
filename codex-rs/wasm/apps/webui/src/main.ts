import { mount } from "svelte";

import "./app.css";
import App from "./App.svelte";

(window as typeof window & { __webuiEntryResolved?: boolean }).__webuiEntryResolved = true;

let app: ReturnType<typeof mount> | undefined;

const target = document.getElementById("app");

if (target === null) {
  throw new Error("Missing #app mount target");
}

target.replaceChildren();

app = mount(App, {
  target,
});

export default app;
