import Cocoa
import WebKit

class ScriptBridgeHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: AppDelegate?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "saveDownload",
           let dict = message.body as? [String: Any],
           let filename = dict["filename"] as? String,
           let content = dict["content"] as? String {
            guard let downloadsURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first else { return }
            
            // Prevent path traversal: extract strict base filename and forbid hidden files
            let baseName = (filename as NSString).lastPathComponent
            guard !baseName.isEmpty && !baseName.hasPrefix(".") else {
                print("Security: Rejected invalid download filename: \(filename)")
                return
            }

            let fileURL = downloadsURL.appendingPathComponent(baseName)
            guard fileURL.resolvingSymlinksInPath().path.hasPrefix(downloadsURL.resolvingSymlinksInPath().path) else {
                print("Security: Path traversal attempt blocked: \(filename)")
                return
            }

            do {
                try content.write(to: fileURL, atomically: true, encoding: .utf8)
                print("Export saved to: \(fileURL.path)")
            } catch {
                print("Failed to save export: \(error)")
            }
        } else if message.name == "openExternal",
                  let urlString = message.body as? String,
                  let url = URL(string: urlString) {
            // Allow http, https, and mailto schemes
            if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" || scheme == "mailto" {
                NSWorkspace.shared.open(url)
            } else {
                print("Security: Blocked external URL: \(urlString)")
            }
        } else if message.name == "printHtml",
                  let htmlString = message.body as? String {
            DispatchQueue.main.async {
                self.delegate?.printHTML(htmlString)
            }
        }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var printWebView: WKWebView?
    var backendProcess: Process?
    let bridgeHandler = ScriptBridgeHandler()

    func applicationDidFinishLaunching(_ notification: Notification) {
        bridgeHandler.delegate = self
        setupMenuBar()
        startBackend()

        // Configure Window
        let screenSize = NSScreen.main?.visibleFrame.size ?? CGSize(width: 1200, height: 800)
        let windowWidth = min(1280.0, screenSize.width * 0.9)
        let windowHeight = min(850.0, screenSize.height * 0.9)
        let rect = NSRect(x: (screenSize.width - windowWidth) / 2,
                          y: (screenSize.height - windowHeight) / 2,
                          width: windowWidth,
                          height: windowHeight)

        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Scout v1.47"
        window.minSize = CGSize(width: 850, height: 550)
        window.isReleasedWhenClosed = false
        window.delegate = self

        // Configure WebView & Native JS Bridge
        let config = WKWebViewConfiguration()
        config.userContentController.add(bridgeHandler, name: "saveDownload")
        config.userContentController.add(bridgeHandler, name: "openExternal")
        config.userContentController.add(bridgeHandler, name: "printHtml")

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        window.contentView?.addSubview(webView)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        loadWhenReady()
    }

    func printHTML(_ html: String) {
        let printConfig = WKWebViewConfiguration()
        let pWebView = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 1100), configuration: printConfig)
        self.printWebView = pWebView
        pWebView.navigationDelegate = self
        pWebView.loadHTMLString(html, baseURL: nil)
    }

    @objc func printCurrentPage() {
        let printInfo = NSPrintInfo.shared
        let printOperation = webView.printOperation(with: printInfo)
        printOperation.showsPrintPanel = true
        printOperation.showsProgressPanel = true
        if let win = self.window {
            printOperation.runModal(for: win, delegate: nil, didRun: nil, contextInfo: nil)
        } else {
            printOperation.run()
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView == self.printWebView {
            let printInfo = NSPrintInfo.shared
            printInfo.horizontalPagination = .fit
            printInfo.verticalPagination = .automatic
            printInfo.isHorizontallyCentered = false
            printInfo.isVerticallyCentered = false
            printInfo.leftMargin = 36.0
            printInfo.rightMargin = 36.0
            printInfo.topMargin = 36.0
            printInfo.bottomMargin = 36.0

            let printOperation = webView.printOperation(with: printInfo)
            printOperation.showsPrintPanel = true
            printOperation.showsProgressPanel = true
            if let win = self.window {
                printOperation.runModal(for: win, delegate: nil, didRun: nil, contextInfo: nil)
            } else {
                printOperation.run()
            }
            self.printWebView = nil
        }
    }

    // MARK: - WKUIDelegate (Handles window.open, alert, and confirm)
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Scout"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.alertStyle = .informational
        if let win = self.window {
            alert.beginSheetModal(for: win) { _ in
                completionHandler()
            }
        } else {
            alert.runModal()
            completionHandler()
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Scout"
        alert.informativeText = message
        let isDelete = message.localizedCaseInsensitiveContains("delete") || message.localizedCaseInsensitiveContains("remove")
        alert.addButton(withTitle: isDelete ? "Delete" : "OK")
        alert.addButton(withTitle: "Cancel")
        alert.alertStyle = isDelete ? .warning : .informational
        if let win = self.window {
            alert.beginSheetModal(for: win) { response in
                completionHandler(response == .alertFirstButtonReturn)
            }
        } else {
            let response = alert.runModal()
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    // MARK: - WKNavigationDelegate (Intercepts external links & mailto)
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        // Intercept mailto: scheme and open in default email client
        if let scheme = url.scheme?.lowercased(), scheme == "mailto" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        // If it's an external link (not localhost or 127.0.0.1 or blob/data), open in default browser
        if let host = url.host, host != "localhost" && host != "127.0.0.1" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    // MARK: - WKDownloadDelegate (Handles file downloads to ~/Downloads)
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let downloads = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
        let destinationURL = downloads.appendingPathComponent(suggestedFilename)
        completionHandler(destinationURL)
    }

    func setupMenuBar() {
        let mainMenu = NSMenu()

        // 1. App Menu (Scout)
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu(title: "Scout")
        appMenu.addItem(withTitle: "About Scout", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide Scout", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Scout", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // 2. File Menu
        let fileMenuItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileMenu.addItem(withTitle: "Print...", action: #selector(printCurrentPage), keyEquivalent: "p")
        fileMenuItem.submenu = fileMenu
        mainMenu.addItem(fileMenuItem)

        // 3. Edit Menu (Enables Copy, Paste, Cut, Select All, Undo in WebKit)
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: #selector(UndoManager.undo), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: #selector(UndoManager.redo), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // 4. Window Menu
        let windowMenuItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenuItem.submenu = windowMenu
        mainMenu.addItem(windowMenuItem)

        NSApp.mainMenu = mainMenu
    }

    func startBackend() {
        guard let resourcePath = Bundle.main.resourcePath else { return }
        let binaryPath = "\(resourcePath)/scout"
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let scoutDir = appSupport.appendingPathComponent("Scout")
        try? FileManager.default.createDirectory(at: scoutDir, withIntermediateDirectories: true)

        let dbPath = scoutDir.appendingPathComponent("fusion.db").path
        let logPath = scoutDir.appendingPathComponent("scout.log").path

        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }

        var envVars = ProcessInfo.processInfo.environment
        envVars["FUSION_DB_PATH"] = dbPath
        envVars["FUSION_PORT"] = "8088"
        envVars["FUSION_ALLOW_EMPTY_PASSWORD"] = "true"
        envVars["FUSION_LOG_LEVEL"] = "INFO"
        envVars["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin"

        let envFilePath = "\(resourcePath)/.env"
        if let envData = try? String(contentsOfFile: envFilePath, encoding: .utf8) {
            for line in envData.components(separatedBy: .newlines) {
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
                let parts = trimmed.split(separator: "=", maxSplits: 1).map(String.init)
                if parts.count == 2 {
                    let key = parts[0].trimmingCharacters(in: .whitespaces)
                    var val = parts[1].trimmingCharacters(in: .whitespaces)
                    if (val.hasPrefix("\"") && val.hasSuffix("\"")) || (val.hasPrefix("'") && val.hasSuffix("'")) {
                        if val.count >= 2 { val = String(val.dropFirst().dropLast()) }
                    }
                    if envVars[key] == nil || envVars[key]!.isEmpty {
                        envVars[key] = val
                    }
                }
            }
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: binaryPath)
        proc.environment = envVars
        proc.currentDirectoryURL = scoutDir

        if let logHandle = try? FileHandle(forWritingTo: URL(fileURLWithPath: logPath)) {
            logHandle.seekToEndOfFile()
            proc.standardOutput = logHandle
            proc.standardError = logHandle
        }

        do {
            try proc.run()
            self.backendProcess = proc
        } catch {
            print("Failed to start backend: \(error)")
        }
    }

    func loadWhenReady(attempt: Int = 0) {
        let url = URL(string: "http://localhost:8088")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.5
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let task = URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                if let httpResp = response as? HTTPURLResponse, httpResp.statusCode == 200 {
                    // Clear stale cache data so updates appear immediately
                    let websiteDataTypes = NSSet(array: [WKWebsiteDataTypeDiskCache, WKWebsiteDataTypeMemoryCache])
                    let date = Date(timeIntervalSince1970: 0)
                    WKWebsiteDataStore.default().removeData(ofTypes: websiteDataTypes as! Set<String>, modifiedSince: date) {
                        self?.webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
                    }
                } else if attempt < 40 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        self?.loadWhenReady(attempt: attempt + 1)
                    }
                }
            }
        }
        task.resume()
    }

    func stopBackend() {
        if let proc = backendProcess, proc.isRunning {
            proc.terminate()
            proc.waitUntilExit()
            backendProcess = nil
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.terminate(nil)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopBackend()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
