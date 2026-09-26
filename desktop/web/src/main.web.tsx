import { render } from "preact";
import { bootstrapPlatform } from "#platform";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/global.css";
import { createWebAppCatalog, createWebShellShortcutSource, WebApp } from "./web/WebApp";
import { installWebCanvasShortcuts } from "./web/canvas-shortcuts";

bootstrapPlatform();
const catalog = createWebAppCatalog();
installWebCanvasShortcuts(window, createWebShellShortcutSource(catalog));

render(<WebApp catalog={catalog} />, document.getElementById("app")!);
