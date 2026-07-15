import { render } from "preact";
import { bootstrapPlatform } from "#platform";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/global.css";
import { WebApp } from "./web/WebApp";
import { installWebCanvasShortcuts } from "./web/canvas-shortcuts";

bootstrapPlatform();
installWebCanvasShortcuts();

render(<WebApp />, document.getElementById("app")!);
