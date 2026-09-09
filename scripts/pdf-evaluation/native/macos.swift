import Cocoa
import WebKit

// Separate native probe: no Canopi application state, commands or save acknowledgement.
final class Probe: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let output: URL
    let script: String
    let webView: WKWebView
    var window: NSWindow!
    var timer: Timer?
    var succeeded = false

    init(output: URL, script: String) {
        self.output = output
        self.script = script
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 800), configuration: configuration)
        super.init()
        configuration.userContentController.add(self, name: "canopiEvaluation")
        webView.navigationDelegate = self
    }

    func finish(_ error: String? = nil) {
        timer?.invalidate()
        webView.stopLoading()
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "canopiEvaluation")
        if let error = error { fputs("\(error)\n", stderr) }
        NSApp.stop(nil)
        NSApp.postEvent(NSEvent.otherEvent(with: .applicationDefined, location: .zero, modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil, subtype: 0, data1: 0, data2: 0)!, atStart: false)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript(script) { _, error in
            if let error = error { self.finish(error.localizedDescription) }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(error.localizedDescription) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(error.localizedDescription) }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        do {
            guard message.frameInfo.isMainFrame, let text = message.body as? String, text.utf8.count < 10_000_000,
                  let data = text.data(using: .utf8), let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            else { throw NSError(domain: "Probe", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid fixture result"]) }
            if let error = payload["error"] as? String { finish(error); return }
            guard let encoded = payload["pdf"] as? String, let pdf = Data(base64Encoded: encoded),
                  let report = payload["report"], let previews = payload["previews"] as? [String], (1...3).contains(previews.count)
            else { finish("Missing fixture output"); return }
            try pdf.write(to: output.appendingPathComponent("pdfkit.pdf"), options: .atomic)
            try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("pdfkit.json"))
            for (index, encodedPNG) in previews.enumerated() {
                guard let png = Data(base64Encoded: encodedPNG) else { finish("Invalid preview"); return }
                try png.write(to: output.appendingPathComponent("preview-\(index + 1).png"))
            }
            let runtime = ["host": "WKWebView", "os": ProcessInfo.processInfo.operatingSystemVersionString,
                           "engine": Bundle(for: WKWebView.self).infoDictionary?["CFBundleVersion"] as? String ?? "unknown",
                           "delivery": "Native fixed-path binary write; no save dialog"]
            try JSONSerialization.data(withJSONObject: runtime, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("runtime.json"))
            succeeded = true
            finish()
        } catch { finish(error.localizedDescription) }
    }
}

let arguments = CommandLine.arguments
guard arguments.count == 4, let url = URL(string: arguments[1]), url.host == "127.0.0.1" else { fatalError("Expected localhost URL, output directory and script") }
let output = URL(fileURLWithPath: arguments[2], isDirectory: true)
guard !FileManager.default.fileExists(atPath: output.path) else { fatalError("Output directory already exists") }
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let probe = Probe(output: output, script: try String(contentsOfFile: arguments[3], encoding: .utf8))
probe.window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 800), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
probe.window.title = "Canopi PDF native runtime probe"
probe.window.contentView = probe.webView
probe.window.makeKeyAndOrderFront(nil)
probe.timer = Timer.scheduledTimer(withTimeInterval: 120, repeats: false) { _ in probe.finish("Native PDF probe timed out") }
probe.webView.load(URLRequest(url: url))
app.run()
probe.window.close()
exit(probe.succeeded ? 0 : 1)
