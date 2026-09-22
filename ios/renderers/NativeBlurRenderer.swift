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

/// A blur lighter than any system material. The effect change runs in a paused animator parked
/// part of the way, which is public API. UIKit can drop that state in the background, so it's
/// re-parked when the app comes back.
final class PartialBlur {
  private var animator: UIViewPropertyAnimator?
  private weak var view: UIVisualEffectView?
  private var effect: UIVisualEffect?
  private var amount: CGFloat = 1
  private var observer: NSObjectProtocol?

  init() {
    observer = NotificationCenter.default.addObserver(
      forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self, let view = self.view else { return }
      self.apply(self.effect, amount: self.amount, to: view)
    }
  }

  deinit {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    stop()
  }

  func apply(_ effect: UIVisualEffect?, amount: CGFloat, to view: UIVisualEffectView) {
    stop()
    self.view = view
    self.effect = effect
    self.amount = amount
    view.effect = nil
    guard let effect, amount < 0.99 else {
      view.effect = effect
      return
    }
    let a = UIViewPropertyAnimator(duration: 1, curve: .linear) { [weak view] in view?.effect = effect }
    a.pausesOnCompletion = true
    a.fractionComplete = max(0.05, amount)
    animator = a
  }

  // a paused animator must be stopped before it's released or UIKit throws
  func stop() {
    guard let a = animator else { return }
    animator = nil
    a.stopAnimation(true)
  }
}
