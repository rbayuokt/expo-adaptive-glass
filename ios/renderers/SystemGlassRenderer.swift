import UIKit

/// iOS 26+ system glass through the public UIGlassEffect API.
enum SystemGlassRenderer {
  static func makeEffect(tint: UIColor?, intensity: CGFloat, clear: Bool = false, interactive: Bool) -> UIVisualEffect? {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *), GlassCapabilityDetector.supportsSystemGlass {
      let effect = UIGlassEffect(style: clear ? .clear : .regular)
      // Apple's clear style lets more through, so a tint needs more weight to hold its colour
      effect.tintColor = tint?.withAlphaComponent(min(0.9, (0.15 + 0.45 * intensity) * (clear ? 1.5 : 1)))
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
