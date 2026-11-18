import Testing
import Foundation
@testable import SuperbrowserCore

@Suite struct ChromeProfilesTests {
    @Test func argbToRGB() {
        #expect(RGB(argb: -16033840) == RGB(r: 11, g: 87, b: 208))
        #expect(RGB(argb: -21696) == RGB(r: 255, g: 171, b: 64))
    }

    @Test func parsesProfilesInChromeOrder() throws {
        let json = """
        {"profile":{"profiles_order":["Default","Profile 29",".chrome","Profile 37"],
        "info_cache":{
          "Default":{"name":"Linh","profile_color_seed":-16033840},
          "Profile 29":{"name":"Nguyễn Thị Thanh Nhã","profile_color_seed":-21696},
          ".chrome":{"name":"Phantom","profile_color_seed":-21696},
          "Profile 37":{"name":"Work","default_avatar_fill_color":-21696}
        }}}
        """
        let ps = try parseLocalState(Data(json.utf8), existingDirs: ["Default", "Profile 29", "Profile 37"])
        #expect(ps.map(\.dir) == ["Default", "Profile 29", "Profile 37"])
        #expect(ps[1].name == "Nguyễn Thị Thanh Nhã")
        #expect(ps[0].color == RGB(r: 11, g: 87, b: 208))
        #expect(ps[2].color == RGB(r: 255, g: 171, b: 64))
    }

    @Test func missingColorIsGray() throws {
        let json = #"{"profile":{"profiles_order":["Default"],"info_cache":{"Default":{"name":"A"}}}}"#
        let ps = try parseLocalState(Data(json.utf8), existingDirs: ["Default"])
        #expect(ps.first?.color == .fallbackGray)
    }
}
