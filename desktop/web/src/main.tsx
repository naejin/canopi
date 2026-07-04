import { render } from "preact";
import "maplibre-gl/dist/maplibre-gl.css";
import { App } from "./app";
import { bootstrapPlatform } from "#platform";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";

bootstrapPlatform();

render(<ErrorBoundary><App /></ErrorBoundary>, document.getElementById("app")!);
