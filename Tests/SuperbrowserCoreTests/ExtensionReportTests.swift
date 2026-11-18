import Testing
import Foundation
import CoreGraphics
@testable import SuperbrowserCore

@Suite struct ExtensionReportTests {
    @Test func decodesReport() throws {
        let json = #"{"profileDir": "Profile 37", "extensionVersion": 1, "windows": [{"id": 123, "left": 0, "top": 25, "width": 1440, "height": 875, "focused": true, "state": "normal"}]}"#
        let r = try JSONDecoder().decode(ExtensionReport.self, from: Data(json.utf8))
        #expect(r.profileDir == "Profile 37")
        #expect(r.windows[0].id == 123)
        #expect(r.windows[0].bounds == CGRect(x: 0, y: 25, width: 1440, height: 875))
    }
}
