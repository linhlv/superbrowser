import Testing
import Foundation
@testable import SuperbrowserCore

@Suite struct HTTPMessageTests {
    @Test func httpParsesPostWithBody() {
        let raw = "POST /report HTTP/1.1\r\nHost: x\r\ncontent-length: 5\r\n\r\nhello"
        let r = parseHTTPRequest(Data(raw.utf8))
        #expect(r?.method == "POST")
        #expect(r?.path == "/report")
        #expect(r?.body == Data("hello".utf8))
    }

    @Test func httpIncompleteBodyIsNil() {
        #expect(parseHTTPRequest(Data("POST /r HTTP/1.1\r\nContent-Length: 5\r\n\r\nhe".utf8)) == nil)
        #expect(parseHTTPRequest(Data("POST /r HTTP/1.1\r\nContent-Le".utf8)) == nil)
    }

    @Test func httpParsesClaimQuery() {
        let r = parseHTTPRequest(Data("GET /claim?dir=Profile%2037 HTTP/1.1\r\n\r\n".utf8))
        #expect(r?.path == "/claim")
        #expect(r?.query["dir"] == "Profile 37")
        #expect(r?.body == Data())
    }

    @Test func responseFormat() {
        let s = String(decoding: httpResponse(status: 200, contentType: "text/plain", body: Data("ok".utf8)), as: UTF8.self)
        #expect(s.hasPrefix("HTTP/1.1 200 OK\r\n"))
        #expect(s.contains("Content-Length: 2\r\n"))
        #expect(s.hasSuffix("\r\n\r\nok"))
    }

    @Test func httpNegativeContentLengthIsNil() {
        #expect(parseHTTPRequest(Data("POST /r HTTP/1.1\r\nContent-Length: -1\r\n\r\nhello".utf8)) == nil)
    }

    @Test func httpNonNumericContentLengthIsNil() {
        #expect(parseHTTPRequest(Data("POST /r HTTP/1.1\r\nContent-Length: abc\r\n\r\nhello".utf8)) == nil)
    }
}
