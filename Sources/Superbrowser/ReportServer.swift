import Foundation
import Network
import SuperbrowserCore

/// Loopback-only HTTP server: `POST /report` from the helper extension; `GET /claim?nonce=` (the page
/// Superbrowser opens in a profile to link it) and `POST /claim/confirm` (the extension trading that
/// one-time nonce for its profile dir).
@MainActor
final class ReportServer {
    nonisolated static let maxRequestBytes = 1 << 20
    nonisolated static let requestTimeout: TimeInterval = 5

    private let port: UInt16
    private let onReport: @MainActor (ExtensionReport) -> Void
    private let profileName: @MainActor (String) -> String?
    private let claims: ClaimRegistry
    private let queue = DispatchQueue(label: "superbrowser.report-server")
    private var listener: NWListener?

    enum State: Equatable { case ready, failed(String) }
    struct StartError: Error, CustomStringConvertible {
        let description: String
    }
    /// Called on the main actor when the listener becomes ready or fails (e.g. port in use).
    var onStateChange: (@MainActor (State) -> Void)?

    init(port: UInt16 = 47321,
         claims: ClaimRegistry,
         onReport: @MainActor @escaping (ExtensionReport) -> Void,
         profileName: @MainActor @escaping (String) -> String?) {
        self.port = port
        self.claims = claims
        self.onReport = onReport
        self.profileName = profileName
    }

    func start() throws {
        guard listener == nil else { return }
        guard let nwPort = NWEndpoint.Port(rawValue: port) else { throw StartError(description: "invalid port \(port)") }
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: nwPort)
        params.acceptLocalOnly = true
        let listener = try NWListener(using: params)
        let handler: @Sendable (HTTPRequest) async -> Data = { [weak self] request in
            guard let self else { return Self.reply(500, "text/plain", "gone") }
            return await self.handle(request)
        }
        let queue = self.queue
        listener.newConnectionHandler = { connection in
            ConnectionHandler(connection: connection, queue: queue, handler: handler).start()
        }
        listener.stateUpdateHandler = { [weak self] state in
            let mapped: State
            switch state {
            case .ready: mapped = .ready
            case .failed(let error): mapped = .failed("\(error)")
            default: return
            }
            Task { @MainActor in
                guard let self else { return }
                if case .failed = mapped { self.listener?.cancel(); self.listener = nil }
                self.onStateChange?(mapped)
            }
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    nonisolated static func reply(_ status: Int, _ type: String, _ body: String) -> Data {
        httpResponse(status: status, contentType: type, body: Data(body.utf8))
    }

    private func handle(_ request: HTTPRequest) -> Data {
        switch (request.method, request.path) {
        case ("POST", "/report"):
            if let rejected = Self.rejectNonExtensionJSON(request) { return rejected }
            guard let report = try? JSONDecoder().decode(ExtensionReport.self, from: request.body) else {
                return Self.reply(400, "text/plain", "bad report")
            }
            onReport(report)
            return httpResponse(status: 204, contentType: "text/plain", body: Data())
        case ("POST", "/claim/confirm"):
            if let rejected = Self.rejectNonExtensionJSON(request) { return rejected }
            guard let nonce = claimConfirmNonce(from: request.body), let dir = claims.confirm(nonce) else {
                return Self.reply(404, "text/plain", "unknown or expired claim")
            }
            return httpResponse(status: 200, contentType: "application/json", body: claimConfirmReply(profileDir: dir))
        case ("GET", "/claim"):
            guard let dir = claims.profileDir(forNonce: request.query["nonce"] ?? "") else {
                let page = """
                <!doctype html><html><head><meta charset="utf-8"><title>Superbrowser</title></head>\
                <body style="font-family: -apple-system, sans-serif; margin: 3em;">\
                <h2>This link has expired.</h2>\
                <p>Use Link Profiles… in the Superbrowser menu to link this profile.</p>\
                </body></html>
                """
                return Self.reply(404, "text/html; charset=utf-8", page)
            }
            let name = profileName(dir) ?? dir
            let page = """
            <!doctype html><html><head><meta charset="utf-8"><title>Superbrowser</title></head>\
            <body style="font-family: -apple-system, sans-serif; margin: 3em;">\
            <h2>Linking \(Self.htmlEscape(name)) to Superbrowser…</h2>\
            <p>If this tab stays open, the Superbrowser Helper extension isn't installed in this profile.</p>\
            </body></html>
            """
            return Self.reply(200, "text/html; charset=utf-8", page)
        default:
            return Self.reply(404, "text/plain", "not found")
        }
    }

    /// Requests to the extension endpoints must be JSON (so a web page can't send them without a CORS
    /// preflight, which is refused) and, when the browser says where they come from, from an extension.
    nonisolated static func rejectNonExtensionJSON(_ request: HTTPRequest) -> Data? {
        guard request.headers["content-type"]?.lowercased().hasPrefix("application/json") == true else {
            return reply(415, "text/plain", "unsupported media type")
        }
        if let origin = request.headers["origin"], !origin.hasPrefix("chrome-extension://") {
            return reply(403, "text/plain", "forbidden")
        }
        return nil
    }

    nonisolated static func htmlEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }
}

/// One request per connection. All state is confined to `queue`.
private final class ConnectionHandler: @unchecked Sendable {
    private let connection: NWConnection
    private let queue: DispatchQueue
    private let handler: @Sendable (HTTPRequest) async -> Data
    private var buffer = Data()
    private var finished = false

    init(connection: NWConnection, queue: DispatchQueue, handler: @escaping @Sendable (HTTPRequest) async -> Data) {
        self.connection = connection; self.queue = queue; self.handler = handler
    }

    func start() {
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + ReportServer.requestTimeout) { [self] in
            if !finished { finished = true; connection.cancel() }
        }
        receive()
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [self] data, _, isComplete, error in
            if finished { return }
            if let data { buffer.append(data) }
            if buffer.count > ReportServer.maxRequestBytes {
                return respond(ReportServer.reply(413, "text/plain", "too large"))
            }
            if let request = parseHTTPRequest(buffer) {
                finished = true
                let handler = self.handler
                Task { [self] in
                    let response = await handler(request)
                    queue.async { self.send(response) }
                }
            } else if error != nil || isComplete {
                finished = true
                connection.cancel()
            } else {
                receive()
            }
        }
    }

    private func respond(_ data: Data) {
        finished = true
        send(data)
    }

    private func send(_ data: Data) {
        connection.send(content: data, completion: .contentProcessed { [self] _ in connection.cancel() })
    }
}
