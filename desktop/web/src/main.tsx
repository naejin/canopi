import { render } from "preact";
import { App } from "./app";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";

render(<ErrorBoundary><App /></ErrorBoundary>, document.getElementById("app")!);
