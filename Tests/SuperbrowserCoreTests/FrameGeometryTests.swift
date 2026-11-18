import Testing
import CoreGraphics
@testable import SuperbrowserCore

@Suite struct FrameGeometryTests {
    let f = CGRect(x: 0, y: 25, width: 1440, height: 875)

    @Test func splitTop() {
        let r = FrameLayout.split(frame: f, position: .top)
        #expect(r.bar == CGRect(x: 0, y: 25, width: 1440, height: 32))
        #expect(r.content == CGRect(x: 0, y: 57, width: 1440, height: 843))
    }

    @Test func splitLeftRightBottom() {
        let l = FrameLayout.split(frame: f, position: .left)
        #expect(l.bar == CGRect(x: 0, y: 25, width: 168, height: 875))
        #expect(l.content == CGRect(x: 168, y: 25, width: 1272, height: 875))
        let r = FrameLayout.split(frame: f, position: .right)
        #expect(r.bar == CGRect(x: 1272, y: 25, width: 168, height: 875))
        #expect(r.content == CGRect(x: 0, y: 25, width: 1272, height: 875))
        let b = FrameLayout.split(frame: f, position: .bottom)
        #expect(b.bar == CGRect(x: 0, y: 868, width: 1440, height: 32))
        #expect(b.content == CGRect(x: 0, y: 25, width: 1440, height: 843))
    }

    @Test func frameFromContentInvertsSplit() {
        for p in BarPosition.allCases {
            #expect(FrameLayout.frame(fromContent: FrameLayout.split(frame: f, position: p).content, position: p) == f)
        }
    }

    @Test func clampInsideUnchanged() {
        let r = CGRect(x: 10, y: 30, width: 400, height: 300)
        #expect(FrameLayout.clamp(r, into: [CGRect(x: 0, y: 25, width: 1440, height: 875)]) == r)
    }

    @Test func clampOffscreenMovesToMainScreen() {
        let r = FrameLayout.clamp(CGRect(x: 3000, y: 100, width: 800, height: 600),
                                  into: [CGRect(x: 0, y: 25, width: 1440, height: 875)])
        #expect(r == CGRect(x: 640, y: 100, width: 800, height: 600))
    }

    @Test func clampTooBigShrinks() {
        let r = FrameLayout.clamp(CGRect(x: 0, y: 0, width: 2000, height: 1200),
                                  into: [CGRect(x: 0, y: 25, width: 1440, height: 875)])
        #expect(r == CGRect(x: 0, y: 25, width: 1440, height: 875))
    }

    @Test func axCocoaRoundTrip() {
        let ax = CGRect(x: 10, y: 20, width: 300, height: 400)
        let c = FrameLayout.cocoaRect(fromAX: ax, primaryScreenHeight: 900)
        #expect(c == CGRect(x: 10, y: 480, width: 300, height: 400))
        #expect(FrameLayout.axRect(fromCocoa: c, primaryScreenHeight: 900) == ax)
    }
}
