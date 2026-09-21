import UIKit

enum GlassCapabilityDetector {
  private static var cached: [String: Any]?

  /// UIGlassEffect crashed on early iOS 26 betas, so the class is checked at runtime too.
  /// Apps opting out with `UIDesignRequiresCompatibility` get the blur renderer.
  static let supportsSystemGlass: Bool = {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      guard let cls = NSClassFromString("UIGlassEffect") as? NSObject.Type,
        cls.responds(to: NSSelectorFromString("effectWithStyle:"))
      else { return false }
      if let optOut = Bundle.main.object(forInfoDictionaryKey: "UIDesignRequiresCompatibility") as? Bool,
        optOut
      {
        return false
      }
      return true
    }
    #endif
    return false
  }()

  static func prewarm() {
    DispatchQueue.main.async { _ = deviceInfo() }
  }

  /// UIScreen is main thread only, the JS call can come from anywhere
  static func deviceInfo() -> [String: Any] {
    if let cached { return cached }
    if !Thread.isMainThread {
      return DispatchQueue.main.sync { deviceInfo() }
    }
    let screen = UIScreen.main
    let os = ProcessInfo.processInfo.operatingSystemVersion
    let info: [String: Any] = [
      "platform": "ios",
      "osVersion": UIDevice.current.systemVersion,
      "apiLevel": os.majorVersion,
      "totalMemoryMB": Int(ProcessInfo.processInfo.physicalMemory / 1_048_576),
      "lowRamDevice": false,
      "cpuCores": ProcessInfo.processInfo.activeProcessorCount,
      "performanceClass": 0,
      "screenWidth": Double(screen.bounds.width),
      "screenHeight": Double(screen.bounds.height),
      "screenScale": Double(screen.scale),
      "maxRefreshRate": screen.maximumFramesPerSecond,
      "supportsSystemGlass": supportsSystemGlass,
      "supportsLiveBlur": true,
      "supportsShader": false,
    ]
    cached = info
    return info
  }
}
