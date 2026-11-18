import Foundation

public struct HTTPRequest: Equatable {
    public var method: String
    public var path: String
    public var query: [String: String]
    public var body: Data
    public init(method: String, path: String, query: [String: String], body: Data) {
        self.method = method; self.path = path; self.query = query; self.body = body
    }
}

/// Returns nil until the headers and Content-Length bytes of body are all present.
public func parseHTTPRequest(_ data: Data) -> HTTPRequest? {
    let sep = Data("\r\n\r\n".utf8)
    guard let range = data.range(of: sep) else { return nil }
    let head = String(decoding: data[data.startIndex..<range.lowerBound], as: UTF8.self)
    var lines = head.components(separatedBy: "\r\n")
    let requestLine = lines.removeFirst().split(separator: " ", omittingEmptySubsequences: true)
    guard requestLine.count >= 2 else { return nil }

    var contentLength = 0
    for line in lines {
        guard let colon = line.firstIndex(of: ":") else { continue }
        if line[..<colon].trimmingCharacters(in: .whitespaces).lowercased() == "content-length" {
            contentLength = Int(line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)) ?? 0
        }
    }
    let bodyStart = range.upperBound
    guard data.endIndex - bodyStart >= contentLength else { return nil }
    let body = Data(data[bodyStart..<(bodyStart + contentLength)])

    let target = String(requestLine[1])
    var path = target
    var query: [String: String] = [:]
    if let q = target.firstIndex(of: "?") {
        path = String(target[..<q])
        for pair in target[target.index(after: q)...].split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            let decode = { (s: Substring) -> String in
                let plus = s.replacingOccurrences(of: "+", with: " ")
                return plus.removingPercentEncoding ?? plus
            }
            query[decode(kv[0])] = kv.count > 1 ? decode(kv[1]) : ""
        }
    }
    return HTTPRequest(method: String(requestLine[0]), path: path, query: query, body: body)
}

public func httpResponse(status: Int, contentType: String, body: Data) -> Data {
    let reason = HTTPURLResponse.localizedString(forStatusCode: status).capitalized
    let head = "HTTP/1.1 \(status) \(status == 200 ? "OK" : reason)\r\nContent-Type: \(contentType)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
    return Data(head.utf8) + body
}
