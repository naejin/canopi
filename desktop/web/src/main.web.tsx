import { render } from "preact";
import { bootstrapPlatform } from "#platform";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/global.css";
import { createWebAppCatalog, createWebShellShortcutSource, WebApp } from "./web/WebApp";
import { installWebKeyRouter } from "./web/browser-shell-commands";

bootstrapPlatform();
const catalog = createWebAppCatalog();
installWebKeyRouter(createWebShellShortcutSource(catalog));

render(<WebApp catalog={catalog} />, document.getElementById("app")!);
