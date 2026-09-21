import UIKit

/// Tint, sheen, hairline border and specular highlight, drawn over the blur or on their own.
/// Layers are built once, the border path only on size or radius changes.
final class AcrylicRenderer {
  enum Mode {
    case system, liveBlur, acrylic, opaque
  }

  struct Style: Equatable {
    var mode: Mode
    var dark: Bool
    var tint: UIColor?
    var intensity: CGFloat
    var minimal: Bool
  }

  let root = CALayer()
  private let fill = CALayer()
  private let sheen = CAGradientLayer()
  private let border = CAGradientLayer()
  private let borderMask = CAShapeLayer()
  private let specular = CAGradientLayer()
  private var laidOutSize = CGSize.zero
  private var laidOutRadius: CGFloat = -1
  private var style: Style?

  init() {
    root.masksToBounds = true
    if #available(iOS 13.0, *) { root.cornerCurve = .continuous }
    sheen.startPoint = CGPoint(x: 0.5, y: 0)
    sheen.endPoint = CGPoint(x: 0.5, y: 0.6)
    // lit from the top-left, same as the Android shader
    border.startPoint = CGPoint(x: 0, y: 0)
    border.endPoint = CGPoint(x: 1, y: 1)
    borderMask.fillColor = nil
    borderMask.strokeColor = UIColor.black.cgColor
    border.mask = borderMask
    specular.type = .radial
    specular.startPoint = CGPoint(x: 0.5, y: 0.5)
    specular.endPoint = CGPoint(x: 1, y: 1)
    specular.opacity = 0
    [fill, sheen, border, specular].forEach(root.addSublayer)
  }

  func layout(bounds: CGRect, radius: CGFloat, scale: CGFloat) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    root.frame = bounds
    root.cornerRadius = radius
    fill.frame = bounds
    sheen.frame = bounds
    border.frame = bounds
    if bounds.size != laidOutSize || radius != laidOutRadius {
      laidOutSize = bounds.size
      laidOutRadius = radius
      let width = max(1 / scale, 0.75)
      borderMask.lineWidth = width
      borderMask.path =
        UIBezierPath(
          roundedRect: bounds.insetBy(dx: width / 2, dy: width / 2),
          cornerRadius: max(0, radius - width / 2)
        ).cgPath
      let d = max(bounds.width, bounds.height) * 0.9
      specular.bounds = CGRect(x: 0, y: 0, width: d, height: d)
    }
    CATransaction.commit()
  }

  func apply(_ next: Style, animated: Bool) {
    guard next != style else { return }
    style = next
    CATransaction.begin()
    CATransaction.setDisableActions(!animated)
    CATransaction.setAnimationDuration(0.3)

    let i = next.intensity
    let neutral = next.dark ? UIColor(white: 0.12, alpha: 1) : UIColor(white: 0.97, alpha: 1)
    let base = next.tint ?? neutral
    let fillAlpha: CGFloat
    switch next.mode {
    case .system: fillAlpha = 0  // UIGlassEffect carries the tint itself
    case .liveBlur: fillAlpha = (next.dark ? 0.12 : 0.08) + 0.22 * i
    case .acrylic: fillAlpha = 0.62 + 0.28 * i
    case .opaque: fillAlpha = 0.97
    }
    fill.backgroundColor = base.withAlphaComponent(fillAlpha).cgColor

    // highlights lean toward the tint instead of pure white
    let light = Self.highlight(tint: next.tint, dark: next.dark)
    let showDecor = next.mode != .system && !next.minimal
    let sheenAlpha: CGFloat = showDecor ? (next.dark ? 0.12 : 0.32) * (0.5 + i) : 0
    sheen.colors = [light.withAlphaComponent(sheenAlpha).cgColor, light.withAlphaComponent(0).cgColor]

    let top: CGFloat = next.mode == .opaque ? 0.9 : (next.dark ? 0.3 : 0.75)
    let bottom: CGFloat = next.mode == .opaque ? 0.5 : (next.dark ? 0.06 : 0.22)
    border.colors = [light.withAlphaComponent(top).cgColor, light.withAlphaComponent(bottom).cgColor]
    border.opacity = next.mode == .system ? 0 : (next.minimal ? 0.6 : 1)

    specular.colors = [
      light.withAlphaComponent(next.dark ? 0.32 : 0.55).cgColor,
      light.withAlphaComponent(0).cgColor,
    ]
    CATransaction.commit()
  }

  func setHighlight(at point: CGPoint?, visible: Bool) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if let point { specular.position = point }
    CATransaction.commit()
    // opacity keeps its implicit fade
    specular.opacity = visible ? 1 : 0
  }

  private static func highlight(tint: UIColor?, dark: Bool) -> UIColor {
    guard let tint else { return .white }
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    guard tint.getRed(&r, green: &g, blue: &b, alpha: &a) else { return .white }
    let k: CGFloat = dark ? 0.6 : 0.75
    return UIColor(red: r + (1 - r) * k, green: g + (1 - g) * k, blue: b + (1 - b) * k, alpha: 1)
  }
}
