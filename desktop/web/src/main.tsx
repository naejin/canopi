import { render } from "preact";
import "maplibre-gl/dist/maplibre-gl.css";
import { App } from "./app";
import { bootstrapShell } from "./app/shell/bootstrap";
import { registerCloseGuard } from "./app/shell/close-guard";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";

bootstrapShell();
registerCloseGuard();

render(<ErrorBoundary><App /></ErrorBoundary>, document.getElementById("app")!);
