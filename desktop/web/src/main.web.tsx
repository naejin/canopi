import { render } from "preact";
import { bootstrapPlatform } from "#platform";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/global.css";
import { WebApp } from "./web/WebApp";

bootstrapPlatform();

render(<WebApp />, document.getElementById("app")!);
