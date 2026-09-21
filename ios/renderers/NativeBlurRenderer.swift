import UIKit

/// UIBlurEffect materials for iOS < 26. System styles follow light/dark on their own.
enum NativeBlurRenderer {
  // immutable, so shared by every surface
  private static let ultraThin = UIBlurEffect(style: .systemUltraThinMaterial)
  private static let thin = UIBlurEffect(style: .systemThinMaterial)

  static func effect(blur: CGFloat, clear: Bool = false) -> UIVisualEffect {
    // higher tiers get the clearer material, tint and sheen layers do the rest
    blur >= 0.85 || clear ? ultraThin : thin
  }
}
