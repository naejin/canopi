import { render } from "preact";
import "maplibre-gl/dist/maplibre-gl.css";
import { App } from "./app";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";

render(<ErrorBoundary><App /></ErrorBoundary>, document.getElementById("app")!);
