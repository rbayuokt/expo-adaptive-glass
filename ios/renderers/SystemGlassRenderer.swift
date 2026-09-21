import UIKit

/// iOS 26+ system glass through the public UIGlassEffect API.
enum SystemGlassRenderer {
  static func makeEffect(tint: UIColor?, intensity: CGFloat, interactive: Bool) -> UIVisualEffect? {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *), GlassCapabilityDetector.supportsSystemGlass {
      let effect = UIGlassEffect(style: .regular)
      effect.tintColor = tint?.withAlphaComponent(0.15 + 0.45 * intensity)
      effect.isInteractive = interactive
      return effect
    }
    #endif
    return nil
  }

  static func applyCorners(_ view: UIVisualEffectView, radius: CGFloat) {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *), GlassCapabilityDetector.supportsSystemGlass {
      let r = UICornerRadius(floatLiteral: Double(radius))
      view.cornerConfiguration = .corners(
        topLeftRadius: r, topRightRadius: r, bottomLeftRadius: r, bottomRightRadius: r)
    }
    #endif
  }
}
